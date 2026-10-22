"""Uploaded menu files live only under settings.AI_TEMP_ROOT, between being saved by the view and
being read by the job (inline for AI_FAKE, or the run_ai_jobs worker otherwise) — never MEDIA_ROOT,
never kept. delete_temp_dir runs right after a job finishes or fails either way; sweep_old_temp_files
is the backstop for anything a crash left behind."""

import json
import shutil
import time
from pathlib import Path

from django.conf import settings

_EXTENSION_BY_MEDIA_TYPE = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
}

SWEEP_MAX_AGE_SECONDS = 3600


def _scan_dir(temp_dir: str) -> Path:
    return Path(settings.AI_TEMP_ROOT) / temp_dir


def save_temp_files(temp_dir: str, files_meta: list[dict]) -> None:
    path = _scan_dir(temp_dir)
    path.mkdir(parents=True, exist_ok=True)
    manifest = []
    for index, meta in enumerate(files_meta):
        extension = _EXTENSION_BY_MEDIA_TYPE[meta["media_type"]]
        filename = f"{index}{extension}"
        (path / filename).write_bytes(meta["data"])
        manifest.append({"media_type": meta["media_type"], "filename": filename})
    (path / "manifest.json").write_text(json.dumps(manifest))


def load_temp_files(temp_dir: str) -> list[dict]:
    path = _scan_dir(temp_dir)
    manifest = json.loads((path / "manifest.json").read_text())
    return [
        {"media_type": entry["media_type"], "data": (path / entry["filename"]).read_bytes()}
        for entry in manifest
    ]


def delete_temp_dir(temp_dir: str) -> None:
    shutil.rmtree(_scan_dir(temp_dir), ignore_errors=True)


def sweep_old_temp_files(max_age_seconds: int = SWEEP_MAX_AGE_SECONDS) -> None:
    root = Path(settings.AI_TEMP_ROOT)
    if not root.exists():
        return
    cutoff = time.time() - max_age_seconds
    for child in root.iterdir():
        if child.is_dir() and child.stat().st_mtime < cutoff:
            shutil.rmtree(child, ignore_errors=True)
