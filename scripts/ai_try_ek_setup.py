#!/usr/bin/env python
"""Try the real EK setup job (Step EK-4a) end to end over HTTP, against a running dev backend +
worker using the real ANTHROPIC_API_KEY from backend/.env (start them with AI_FAKE=false — this
script never sets it itself). Signs up a fresh owner, scans a real menu, confirms the dishes
through the API (sell-items/bulk, same as the mobile review screen), starts EK setup, and polls it
to done — printing status transitions, result size, counts, sample entries and any unmapped dish.

Usage (PowerShell, from the repo root, after starting the backend + worker with AI_FAKE=false):
    $env:AI_FAKE="False"; npm run dev            # one terminal
    $env:AI_FAKE="False"; python backend/manage.py run_ai_jobs   # another terminal
    python scripts/ai_try_ek_setup.py _private/menus/kavan.pdf --type restaurant_cafe

Costs real money (menu read + EK setup, roughly Rs 5-15 for a real menu) — local dev DB only.
"""

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

BASE_URL = "http://127.0.0.1:8000/api/v1"
ORIGIN = "http://localhost:8081"
POLL_SECONDS = 3
POLL_TIMEOUT_SECONDS = 240


def request(method: str, path: str, body=None, token=None, raw_body=None, content_type=None):
    data = raw_body if raw_body is not None else (json.dumps(body).encode() if body is not None else None)
    headers = {"Origin": ORIGIN, "Content-Type": content_type or "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(f"{BASE_URL}{path}", data=data, headers=headers, method=method)
    try:
        response = urllib.request.urlopen(req, timeout=30)
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read() or b"{}"), exc.headers
    raw = response.read()
    return response.status, json.loads(raw) if raw else {}, response.headers


def multipart_pdf(content: bytes):
    boundary = "EkSetupTryBoundary"
    body = (
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="pdf"; filename="menu.pdf"\r\n'
        "Content-Type: application/pdf\r\n\r\n"
    ).encode() + content + f"\r\n--{boundary}--\r\n".encode()
    return body, f"multipart/form-data; boundary={boundary}"


def die(message: str) -> None:
    print(f"FAILED: {message}", file=sys.stderr)
    sys.exit(1)


def poll(label: str, get_fn) -> tuple[dict, float]:
    t0 = time.time()
    last_status = None
    while True:
        elapsed = time.time() - t0
        if elapsed > POLL_TIMEOUT_SECONDS:
            die(f"{label}: timed out after {elapsed:.0f}s, last status {last_status}")
        status, body, _ = get_fn()
        if status != 200:
            die(f"{label}: GET expected 200, got {status} ({body})")
        if body["status"] != last_status:
            print(f"  [{elapsed:5.1f}s] {label} status -> {body['status']}")
            last_status = body["status"]
        if body["status"] in ("done", "failed"):
            return body, time.time() - t0
        time.sleep(POLL_SECONDS)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("menu_file", type=Path)
    parser.add_argument("--type", dest="business_type", default="restaurant_cafe")
    args = parser.parse_args()

    if not args.menu_file.exists():
        die(f"no such file: {args.menu_file}")

    import random

    mobile = random.choice("6789") + "".join(random.choices("0123456789", k=9))
    password = "EkSetupTry1234!"
    status, body, _ = request(
        "POST",
        "/auth/signup/",
        {
            "name": "EK Setup Try",
            "business_name": "EK Setup Try Biz",
            "mobile": mobile,
            "password": password,
            "consent": True,
        },
    )
    if status != 201:
        die(f"signup expected 201, got {status} ({body})")
    status, body, _ = request("POST", "/auth/login/", {"mobile": mobile, "secret": password})
    if status != 200:
        die(f"login expected 200, got {status} ({body})")
    access = body["access"]
    status, body, _ = request("GET", "/me/", token=access)
    business_id = body["businesses"][0]["id"]
    status, body, _ = request(
        "PATCH",
        f"/businesses/{business_id}/",
        {"business_type": args.business_type, "city": "Pune"},
        token=access,
    )
    if status != 200:
        die(f"set business type expected 200, got {status} ({body})")
    print(f"Business {business_id} ({args.business_type}) ready.")

    t_start = time.time()
    raw_body, content_type = multipart_pdf(args.menu_file.read_bytes())
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/ai/menu-scans/",
        raw_body=raw_body,
        content_type=content_type,
        token=access,
    )
    if status != 202:
        die(f"menu scan create expected 202, got {status} ({body})")
    scan_id = body["id"]
    print(f"Menu scan {scan_id} queued.")

    scan_result, scan_elapsed = poll(
        "menu scan",
        lambda: request("GET", f"/businesses/{business_id}/ai/menu-scans/{scan_id}/", token=access),
    )
    if scan_result["status"] != "done":
        die(f"menu scan failed: {scan_result.get('error_code')}")
    dishes = [
        {"name": d["name"], "group": section["name"], "selling_price": d.get("price") or "100"}
        for section in scan_result["sections"]
        for d in section["dishes"]
        if d.get("kind", "dish") != "addon" and not d.get("existing")
    ]
    print(f"Menu scan done in {scan_elapsed:.1f}s — {len(dishes)} dishes to confirm.")

    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/sell-items/bulk/",
        {"items": dishes, "skip_existing": True},
        token=access,
    )
    if status != 201:
        die(f"confirm dishes (sell-items/bulk) expected 201, got {status} ({body})")
    print(f"Confirmed {len(body)} dishes through the API.")

    status, body, _ = request(
        "POST", f"/businesses/{business_id}/ai/menu-scans/{scan_id}/ek-setup/", token=access
    )
    if status not in (200, 202):
        die(f"ek-setup create expected 200/202, got {status} ({body})")
    print(f"EK setup run {body['id']} started (status {body['status']}).")

    result, setup_elapsed = poll(
        "ek setup",
        lambda: request(
            "GET", f"/businesses/{business_id}/ai/menu-scans/{scan_id}/ek-setup/", token=access
        ),
    )
    total_elapsed = time.time() - t_start
    if result["status"] != "done":
        die(f"ek setup failed: {result.get('error_code')}")

    best_sellers = result["best_sellers"]
    bases = result["bases"]
    families = result["families"]
    ingredients = result["ingredients"]
    all_dish_refs = (
        [p for p in best_sellers]
        + [d for b in bases for d in b["dishes"]]
        + [m for f in families for m in f["members"]]
    )
    truly_unmapped = sorted({r["name"] for r in all_dish_refs if r["dish_id"] is None})

    print("\n--- RESULT ---")
    print(f"menu scan: {scan_elapsed:.1f}s, EK setup: {setup_elapsed:.1f}s, total: {total_elapsed:.1f}s")
    print(f"result size: {len(json.dumps(result))} bytes")
    print(
        f"counts: {len(best_sellers)} best sellers, {len(bases)} bases, {len(families)} families, "
        f"{len(ingredients)} ingredients"
    )
    print("\n2 sample base entries:")
    for base in bases[:2]:
        print(f"  {json.dumps(base, indent=2)}")
    print("\n1 sample family entry:")
    for family in families[:1]:
        print(f"  {json.dumps(family, indent=2)}")
    print(f"\ndishes with no dish_id mapping ({len(truly_unmapped)}): {truly_unmapped}")

    print("\nTARGETS:")
    misses = []
    if total_elapsed > 180:
        misses.append(f"finished in {total_elapsed:.0f}s, target under 3 minutes")
    if truly_unmapped:
        misses.append(f"{len(truly_unmapped)} dish(es) with no dish_id mapping, target 0")
    print("  - " + "\n  - ".join(misses) if misses else "All targets met.")


if __name__ == "__main__":
    main()
