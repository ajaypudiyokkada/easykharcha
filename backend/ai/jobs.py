"""Does the actual AI work for one MenuScan — called inline by the view when AI_FAKE (so dev/tests
never need a separate worker running) and by run_ai_jobs's poll loop otherwise. Always deletes the
scan's temp files when it's done, success or failure."""

from django.utils import timezone

from . import files as ai_files
from .ek_setup import build_dish_input, build_owner_result, save_cost_summary
from .exceptions import AiDailyLimitReached, AiUnavailable
from .extraction import run_menu_extraction
from .limits import monthly_cost_cap_exceeded, record_usage
from .matching import existing_dish_names, normalise
from .models import AiUsageKind, EkSetupRun, EkSetupRunStatus, MenuScan, MenuScanStatus
from .provider.errors import AiProviderCallError, AiSchemaError
from .recipe_composer import suggest_setup


def process_menu_scan(scan_id: int) -> None:
    scan = MenuScan.objects.select_related("business").get(id=scan_id)
    scan.status = MenuScanStatus.READING
    scan.started_at = timezone.now()
    scan.save(update_fields=["status", "started_at"])

    try:
        _run(scan)
    finally:
        ai_files.delete_temp_dir(scan.temp_dir)


def _run(scan: MenuScan) -> None:
    if monthly_cost_cap_exceeded():
        _fail(scan, "ai_unavailable")
        return

    file_inputs = ai_files.load_temp_files(scan.temp_dir)
    try:
        outcome = run_menu_extraction(file_inputs, scan.business.business_type)
    except AiProviderCallError:
        _fail(scan, "ai_provider_error")
        return
    except AiSchemaError:
        _fail(scan, "ai_schema_invalid")
        return

    for call in outcome.calls:
        record_usage(
            business=scan.business,
            kind=AiUsageKind.MENU_SCAN,
            model=call.model,
            input_tokens=call.input_tokens,
            output_tokens=call.output_tokens,
        )

    existing = existing_dish_names(scan.business)
    for section in outcome.merged["sections"]:
        for dish in section["dishes"]:
            dish["existing"] = normalise(dish["name"]) in existing

    scan.status = MenuScanStatus.DONE
    scan.result = {**outcome.merged, "incomplete": outcome.incomplete}
    scan.model_used = outcome.model_used
    scan.input_tokens = outcome.total_input_tokens
    scan.output_tokens = outcome.total_output_tokens
    scan.finished_at = timezone.now()
    scan.save(
        update_fields=[
            "status",
            "result",
            "model_used",
            "input_tokens",
            "output_tokens",
            "finished_at",
        ]
    )


def _fail(scan: MenuScan, error_code: str) -> None:
    scan.status = MenuScanStatus.FAILED
    scan.error_code = error_code
    scan.finished_at = timezone.now()
    scan.save(update_fields=["status", "error_code", "finished_at"])


def process_ek_setup_run(run_id: int) -> None:
    """Step EK-4a: base discovery + recipe_composer.suggest_setup over the business's own current
    sell items (ek_setup.build_dish_input — the owner's reviewed list, edits/deletions respected),
    called inline by the view when AI_FAKE and by run_ai_jobs's poll loop otherwise, same split as
    process_menu_scan. Never writes to StockItem/SellItem/Recipe/Base — suggest_setup's own
    contract, unchanged here. Step EK-4a2: `on_progress` refreshes `heartbeat` once per family
    recipe call (and after each other stage) — a real menu's worth of family calls can genuinely
    take longer than the worker's 10-minute stuck-job window, and a heartbeat set only once at the
    start made that look stuck when it wasn't."""
    run = EkSetupRun.objects.select_related("business").get(id=run_id)
    run.status = EkSetupRunStatus.RUNNING
    run.started_at = timezone.now()
    run.heartbeat = run.started_at
    run.save(update_fields=["status", "started_at", "heartbeat"])

    def _touch_heartbeat() -> None:
        EkSetupRun.objects.filter(id=run.id).update(heartbeat=timezone.now())

    try:
        dishes, dish_id_by_norm = build_dish_input(run.business)
        raw = suggest_setup(
            dishes, run.business.business_type, run.business, on_progress=_touch_heartbeat
        )
    except AiUnavailable:
        _fail_ek_setup(run, "ai_unavailable")
        return
    except AiDailyLimitReached:
        _fail_ek_setup(run, "ai_daily_limit_reached")
        return
    except (AiProviderCallError, AiSchemaError) as exc:
        _fail_ek_setup(run, "ai_provider_error", exc)
        return

    save_cost_summary(run, raw["cost_summary"])
    run.status = EkSetupRunStatus.DONE
    run.result = build_owner_result(raw, dish_id_by_norm, run.business)
    run.finished_at = timezone.now()
    run.save(
        update_fields=[
            "status",
            "result",
            "finished_at",
            "call_count",
            "input_tokens",
            "output_tokens",
            "est_cost_usd",
        ]
    )


def _fail_ek_setup(run: EkSetupRun, error_code: str, exc: Exception | None = None) -> None:
    run.status = EkSetupRunStatus.FAILED
    run.error = error_code
    if exc is not None:
        run.error_detail = f"{type(exc).__name__}: {str(exc)[:500]}"
    run.finished_at = timezone.now()
    run.save(update_fields=["status", "error", "error_detail", "finished_at"])
