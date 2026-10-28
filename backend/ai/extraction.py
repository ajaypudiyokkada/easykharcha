"""The one menu-extraction pipeline — chunk a PDF, call the model per chunk, retry an overflowing
chunk one page at a time, merge every chunk/page's dishes, and track usage. Used by both the real
job path (jobs.py, which also records AiUsage/limits) and the manual try-it script
(scripts/ai_try_menu.py), so the script exercises exactly the path a real scan takes instead of a
single unchunked call."""

import io
from dataclasses import dataclass, field

import pypdf

from . import provider
from .schemas import merge_group_results, merge_menu_results

PDF_PAGES_PER_CHUNK = 3


@dataclass
class ExtractionCall:
    """One real model call — either a page-chunk or a single-page retry."""

    label: str
    model: str
    input_tokens: int
    output_tokens: int
    truncated: bool


@dataclass
class MenuExtractionOutcome:
    merged: dict
    incomplete: bool
    model_used: str
    total_input_tokens: int
    total_output_tokens: int
    calls: list[ExtractionCall] = field(default_factory=list)
    # Step EK-2b: heading-plus-choices groups found by the dedicated second pass (see
    # run_group_extraction below) — [] when the menu had none, or wasn't a menu at all.
    groups: list[dict] = field(default_factory=list)


def _pdf_page_count(data: bytes) -> int:
    return len(pypdf.PdfReader(io.BytesIO(data)).pages)


def _write_pages(pages) -> bytes:
    writer = pypdf.PdfWriter()
    for page in pages:
        writer.add_page(page)
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


def _chunk_pdf(data: bytes) -> list[bytes]:
    pages = pypdf.PdfReader(io.BytesIO(data)).pages
    return [
        _write_pages(pages[start : start + PDF_PAGES_PER_CHUNK])
        for start in range(0, len(pages), PDF_PAGES_PER_CHUNK)
    ]


def _split_pdf_pages(data: bytes) -> list[bytes]:
    pages = pypdf.PdfReader(io.BytesIO(data)).pages
    return [_write_pages([page]) for page in pages]


def run_menu_extraction(
    files: list[dict], business_type: str, *, extract_fn=None, extract_groups_fn=None
) -> MenuExtractionOutcome:
    """extract_fn defaults to provider.extract_menu (AI_FAKE-aware dispatch, what the real job path
    wants); the script passes anthropic_provider.extract_menu directly to always hit the real API
    regardless of AI_FAKE. extract_groups_fn works the same way for provider.extract_menu_groups
    (Step EK-2b's dedicated group-finding pass, run after the main dish pass, over the same file(s))."""
    extract = extract_fn or provider.extract_menu
    extract_groups = extract_groups_fn or provider.extract_menu_groups

    if (
        len(files) == 1
        and files[0]["media_type"] == "application/pdf"
        and _pdf_page_count(files[0]["data"]) > PDF_PAGES_PER_CHUNK
    ):
        calls_plan = [
            [{"media_type": "application/pdf", "data": chunk}]
            for chunk in _chunk_pdf(files[0]["data"])
        ]
    else:
        calls_plan = [files]

    chunk_results: list[dict] = []
    calls: list[ExtractionCall] = []
    incomplete = False
    total_input_tokens = 0
    total_output_tokens = 0
    model_used = ""

    for index, call_files in enumerate(calls_plan, start=1):
        result = extract(call_files, business_type)
        calls.append(
            ExtractionCall(
                label=f"chunk {index}",
                model=result.model,
                input_tokens=result.input_tokens,
                output_tokens=result.output_tokens,
                truncated=result.truncated,
            )
        )
        total_input_tokens += result.input_tokens
        total_output_tokens += result.output_tokens
        model_used = result.model

        is_multi_page_pdf = (
            len(call_files) == 1
            and call_files[0]["media_type"] == "application/pdf"
            and _pdf_page_count(call_files[0]["data"]) > 1
        )
        if result.truncated and is_multi_page_pdf:
            page_outcome = _retry_pages_one_at_a_time(
                call_files[0]["data"], business_type, extract, chunk_label=f"chunk {index}"
            )
            chunk_results.extend(page_outcome[0])
            calls.extend(page_outcome[1])
            total_input_tokens += page_outcome[2]
            total_output_tokens += page_outcome[3]
            incomplete = incomplete or page_outcome[4]
            continue

        if result.truncated:
            incomplete = True
        chunk_results.append(result.data)

    merged, hit_cap = merge_menu_results(chunk_results)
    incomplete = incomplete or hit_cap

    groups: list[dict] = []
    if merged["is_menu"]:
        group_chunk_results = []
        for index, call_files in enumerate(calls_plan, start=1):
            gresult = extract_groups(call_files, business_type)
            calls.append(
                ExtractionCall(
                    label=f"chunk {index} groups",
                    model=gresult.model,
                    input_tokens=gresult.input_tokens,
                    output_tokens=gresult.output_tokens,
                    truncated=gresult.truncated,
                )
            )
            total_input_tokens += gresult.input_tokens
            total_output_tokens += gresult.output_tokens
            group_chunk_results.append(gresult.data)
        groups = merge_group_results(group_chunk_results)

    return MenuExtractionOutcome(
        merged=merged,
        incomplete=incomplete,
        model_used=model_used,
        total_input_tokens=total_input_tokens,
        total_output_tokens=total_output_tokens,
        calls=calls,
        groups=groups,
    )


def _retry_pages_one_at_a_time(
    pdf_data: bytes, business_type: str, extract, *, chunk_label: str
) -> tuple[list[dict], list[ExtractionCall], int, int, bool]:
    results = []
    calls = []
    incomplete = False
    total_input_tokens = 0
    total_output_tokens = 0

    for page_number, page_bytes in enumerate(_split_pdf_pages(pdf_data), start=1):
        result = extract([{"media_type": "application/pdf", "data": page_bytes}], business_type)
        calls.append(
            ExtractionCall(
                label=f"{chunk_label}, page {page_number} retry",
                model=result.model,
                input_tokens=result.input_tokens,
                output_tokens=result.output_tokens,
                truncated=result.truncated,
            )
        )
        total_input_tokens += result.input_tokens
        total_output_tokens += result.output_tokens
        if result.truncated:
            incomplete = True
        results.append(result.data)

    return results, calls, total_input_tokens, total_output_tokens, incomplete
