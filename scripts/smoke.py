#!/usr/bin/env python
"""Proves the frontend can actually talk to the backend.

Run with:  python scripts/smoke.py

Checks /api/v1/health/ for a 200 status, the exact JSON shape the mobile app expects, and that the
CORS header the browser needs is actually present for the mobile dev server's origin — a backend that
works from a server-to-server request but has no CORS header still looks broken from the browser.
"""

import json
import sys
import urllib.error
import urllib.request

API_URL = "http://127.0.0.1:8000/api/v1/health/"
ORIGIN = "http://localhost:8081"
EXPECTED_KEYS = {"status", "version", "database"}


def fail(message: str) -> None:
    print(f"FAIL: {message}")
    sys.exit(1)


def main() -> None:
    request = urllib.request.Request(API_URL, headers={"Origin": ORIGIN})
    try:
        response = urllib.request.urlopen(request, timeout=10)
    except urllib.error.URLError as exc:
        fail(f"could not reach {API_URL} — is the backend running? ({exc})")
        return

    if response.status != 200:
        fail(f"expected HTTP 200, got {response.status}")

    try:
        body = json.loads(response.read())
    except json.JSONDecodeError as exc:
        fail(f"response was not valid JSON ({exc})")
        return

    if set(body.keys()) != EXPECTED_KEYS:
        fail(f"unexpected JSON shape, expected keys {EXPECTED_KEYS}, got {body}")
    if body.get("status") != "ok" or body.get("database") != "ok":
        fail(f"health check reports a problem: {body}")

    cors_header = response.headers.get("Access-Control-Allow-Origin")
    if cors_header != ORIGIN:
        fail(
            f"missing or wrong CORS header for Origin {ORIGIN!r}: got {cors_header!r}. "
            "Check CORS_ALLOWED_ORIGINS in the backend's environment."
        )

    print(f"OK — {API_URL} reachable, response shape correct, CORS header present for {ORIGIN}.")


if __name__ == "__main__":
    main()
