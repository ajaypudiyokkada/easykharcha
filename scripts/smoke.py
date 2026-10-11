#!/usr/bin/env python
"""Proves the frontend can actually talk to the backend.

Run with:  python scripts/smoke.py

Checks /api/v1/health/ for a 200 status, the exact JSON shape the mobile app expects, and that the
CORS header the browser needs is actually present for the mobile dev server's origin — a backend that
works from a server-to-server request but has no CORS header still looks broken from the browser.

Then walks the Step 3 auth flow end to end against a freshly generated mobile number: signup -> login
-> /me -> refresh -> logout, and confirms a wrong password gets the generic error message.
"""

import json
import random
import sys
import urllib.error
import urllib.request

BASE_URL = "http://127.0.0.1:8000/api/v1"
ORIGIN = "http://localhost:8081"
EXPECTED_HEALTH_KEYS = {"status", "version", "database"}


def fail(message: str) -> None:
    print(f"FAIL: {message}")
    sys.exit(1)


def request(method: str, path: str, body: dict | None = None, token: str | None = None):
    """Returns (status, json_body, headers). Never raises for HTTP error statuses — the caller
    decides what's expected."""
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Origin": ORIGIN, "Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(f"{BASE_URL}{path}", data=data, headers=headers, method=method)
    try:
        response = urllib.request.urlopen(req, timeout=10)
    except urllib.error.HTTPError as exc:
        payload = json.loads(exc.read()) if exc.read else {}
        return exc.code, payload, exc.headers
    except urllib.error.URLError as exc:
        fail(f"could not reach {BASE_URL}{path} — is the backend running? ({exc})")
        return None, None, None
    payload = json.loads(response.read())
    return response.status, payload, response.headers


def check_health() -> None:
    status, body, headers = request("GET", "/health/")
    if status != 200:
        fail(f"health: expected HTTP 200, got {status}")
    if set(body.keys()) != EXPECTED_HEALTH_KEYS:
        fail(f"health: unexpected JSON shape, expected keys {EXPECTED_HEALTH_KEYS}, got {body}")
    if body.get("status") != "ok" or body.get("database") != "ok":
        fail(f"health: reports a problem: {body}")
    if headers.get("Access-Control-Allow-Origin") != ORIGIN:
        fail(f"health: missing or wrong CORS header for Origin {ORIGIN!r}")
    print(f"OK — {BASE_URL}/health/ reachable, response shape correct, CORS header present.")


def check_auth_flow() -> None:
    mobile = random.choice("6789") + "".join(random.choices("0123456789", k=9))
    name = "Smoke Test"
    password = f"Kharcha{random.randint(1000, 9999)}!"

    # signup
    status, body, headers = request(
        "POST",
        "/auth/signup/",
        {"name": name, "mobile": mobile, "password": password, "consent": True},
    )
    if status != 201:
        fail(f"signup: expected HTTP 201, got {status} ({body})")
    if body.get("mobile") != mobile or body.get("name") != name:
        fail(f"signup: unexpected response body {body}")
    if headers.get("Access-Control-Allow-Origin") != ORIGIN:
        fail("signup: missing or wrong CORS header")
    print(f"OK — signup created {mobile}.")

    # duplicate signup
    status, body, _ = request(
        "POST",
        "/auth/signup/",
        {"name": name, "mobile": mobile, "password": password, "consent": True},
    )
    if status != 409 or body.get("error", {}).get("code") != "DUPLICATE_MOBILE":
        fail(f"duplicate signup: expected 409 DUPLICATE_MOBILE, got {status} ({body})")
    print("OK — duplicate signup correctly rejected with DUPLICATE_MOBILE.")

    # honeypot
    honeypot_mobile = random.choice("6789") + "".join(random.choices("0123456789", k=9))
    status, body, _ = request(
        "POST",
        "/auth/signup/",
        {
            "name": "Bot",
            "mobile": honeypot_mobile,
            "password": "irrelevant",
            "consent": True,
            "website": "http://spam.example",
        },
    )
    if status != 201:
        fail(f"honeypot signup: expected a fake HTTP 201, got {status} ({body})")
    print("OK — honeypot signup returned a fake success.")

    # if the honeypot request had actually created a row, this real signup for the same mobile
    # would now fail with DUPLICATE_MOBILE instead of succeeding.
    status, body, _ = request(
        "POST",
        "/auth/signup/",
        {"name": "Not a bot", "mobile": honeypot_mobile, "password": password, "consent": True},
    )
    if status != 201:
        fail(f"honeypot signup created a real row: follow-up signup got {status} ({body})")
    print("OK — honeypot signup created nothing (confirmed via a follow-up real signup).")

    # wrong password
    status, body, _ = request("POST", "/auth/login/", {"mobile": mobile, "secret": "wrong-password"})
    expected_message = "Mobile number or password is not right."
    if status != 401 or body.get("error", {}).get("message") != expected_message:
        fail(f"wrong password: expected 401 with generic message, got {status} ({body})")
    print("OK — wrong password gives the generic error message.")

    # real login
    status, body, headers = request("POST", "/auth/login/", {"mobile": mobile, "secret": password})
    if status != 200 or "access" not in body or "refresh" not in body:
        fail(f"login: expected HTTP 200 with access+refresh, got {status} ({body})")
    if headers.get("Access-Control-Allow-Origin") != ORIGIN:
        fail("login: missing or wrong CORS header")
    access, refresh = body["access"], body["refresh"]
    print("OK — login returned access and refresh tokens.")

    # /me
    status, body, _ = request("GET", "/me/", token=access)
    if status != 200:
        fail(f"/me: expected HTTP 200, got {status} ({body})")
    if body.get("user", {}).get("mobile") != mobile or body.get("businesses") != []:
        fail(f"/me: unexpected response body {body}")
    print("OK — /me returned the signed-in user with an empty businesses list.")

    # refresh
    status, body, _ = request("POST", "/auth/refresh/", {"refresh": refresh})
    if status != 200 or "access" not in body or "refresh" not in body:
        fail(f"refresh: expected HTTP 200 with a rotated pair, got {status} ({body})")
    new_refresh = body["refresh"]
    if new_refresh == refresh:
        fail("refresh: expected a rotated (different) refresh token")
    print("OK — refresh rotated to a new access/refresh pair.")

    # old refresh token must now be blacklisted (rotation)
    status, body, _ = request("POST", "/auth/refresh/", {"refresh": refresh})
    if status == 200:
        fail("refresh: the pre-rotation refresh token should have been blacklisted")
    print("OK — the pre-rotation refresh token no longer works.")

    # logout
    status, body, _ = request("POST", "/auth/logout/", {"refresh": new_refresh})
    if status != 200:
        fail(f"logout: expected HTTP 200, got {status} ({body})")
    print("OK — logout succeeded.")

    # logged-out refresh token must now fail
    status, body, _ = request("POST", "/auth/refresh/", {"refresh": new_refresh})
    if status == 200:
        fail("logout: refresh token should be invalidated after logout")
    print("OK — refresh token no longer works after logout.")


def main() -> None:
    check_health()
    check_auth_flow()
    print("\nAll smoke checks passed.")


if __name__ == "__main__":
    main()
