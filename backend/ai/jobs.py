"""Does the actual AI work for one MenuScan — called inline by the view when AI_FAKE (so dev/tests
never need a separate worker running) and by run_ai_jobs's poll loop otherwise. Always deletes the
scan's temp files when it's done, success or failure."""

from django.utils import timezone

from . import files as ai_files
from .limits import monthly_cost_cap_exceeded, record_usage
from .matching import existing_dish_names, normalise
from .models import AiUsageKind, MenuScan, MenuScanStatus
from .provider import extract_menu
from .provider.errors import AiProviderCallError, AiSchemaError


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

    try:
        file_inputs = ai_files.load_temp_files(scan.temp_dir)
        result = extract_menu(file_inputs, scan.business.business_type)
    except AiProviderCallError:
        _fail(scan, "ai_provider_error")
        return
    except AiSchemaError:
        _fail(scan, "ai_schema_invalid")
        return

    record_usage(
        business=scan.business,
        kind=AiUsageKind.MENU_SCAN,
        model=result.model,
        input_tokens=result.input_tokens,
        output_tokens=result.output_tokens,
    )

    existing = existing_dish_names(scan.business)
    for section in result.data["sections"]:
        for dish in section["dishes"]:
            dish["existing"] = normalise(dish["name"]) in existing

    scan.status = MenuScanStatus.DONE
    scan.result = result.data
    scan.model_used = result.model
    scan.input_tokens = result.input_tokens
    scan.output_tokens = result.output_tokens
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
