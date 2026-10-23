"""Does the actual AI work for one MenuScan — called inline by the view when AI_FAKE (so dev/tests
never need a separate worker running) and by run_ai_jobs's poll loop otherwise. Always deletes the
scan's temp files when it's done, success or failure."""

import io

import pypdf
from django.utils import timezone

from . import files as ai_files
from .limits import monthly_cost_cap_exceeded, record_usage
from .matching import existing_dish_names, normalise
from .models import AiUsageKind, MenuScan, MenuScanStatus
from .provider import extract_menu
from .provider.errors import AiProviderCallError, AiSchemaError
from .schemas import merge_menu_results

# A long PDF is read a few pages at a time rather than as one call, so the model's answer for any
# one call stays well short of its max_tokens — see provider/anthropic_provider.py's _MAX_TOKENS_MENU
# comment. The page-count/size caps enforced at upload (ai/views.py) are unchanged; this only
# changes how an already-accepted PDF is sent to the model.
PDF_PAGES_PER_CHUNK = 3


def _chunk_pdf(data: bytes) -> list[bytes]:
    pages = pypdf.PdfReader(io.BytesIO(data)).pages
    chunks = []
    for start in range(0, len(pages), PDF_PAGES_PER_CHUNK):
        writer = pypdf.PdfWriter()
        for page in pages[start : start + PDF_PAGES_PER_CHUNK]:
            writer.add_page(page)
        buf = io.BytesIO()
        writer.write(buf)
        chunks.append(buf.getvalue())
    return chunks


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
    if (
        len(file_inputs) == 1
        and file_inputs[0]["media_type"] == "application/pdf"
        and scan.page_count > PDF_PAGES_PER_CHUNK
    ):
        calls = [
            [{"media_type": "application/pdf", "data": chunk}]
            for chunk in _chunk_pdf(file_inputs[0]["data"])
        ]
    else:
        calls = [file_inputs]

    chunk_results = []
    truncated = False
    total_input_tokens = 0
    total_output_tokens = 0
    model_used = ""
    for call_files in calls:
        try:
            result = extract_menu(call_files, scan.business.business_type)
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
        chunk_results.append(result.data)
        truncated = truncated or result.truncated
        total_input_tokens += result.input_tokens
        total_output_tokens += result.output_tokens
        model_used = result.model

    merged, hit_cap = merge_menu_results(chunk_results)
    incomplete = truncated or hit_cap

    existing = existing_dish_names(scan.business)
    for section in merged["sections"]:
        for dish in section["dishes"]:
            dish["existing"] = normalise(dish["name"]) in existing

    scan.status = MenuScanStatus.DONE
    scan.result = {**merged, "incomplete": incomplete}
    scan.model_used = model_used
    scan.input_tokens = total_input_tokens
    scan.output_tokens = total_output_tokens
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
