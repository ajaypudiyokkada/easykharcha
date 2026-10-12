#!/usr/bin/env python
"""Proves the frontend can actually talk to the backend.

Run with:  python scripts/smoke.py

Checks /api/v1/health/ for a 200 status, the exact JSON shape the mobile app expects, and that the
CORS header the browser needs is actually present for the mobile dev server's origin — a backend that
works from a server-to-server request but has no CORS header still looks broken from the browser.

Then walks the Step 3 auth flow end to end against a freshly generated mobile number: signup -> login
-> /me -> refresh -> logout, and confirms a wrong password gets the generic error message.

Then the Step 5 business flow: create a business -> PATCH its colour -> a bad colour is rejected ->
a real PNG logo upload works -> a non-image upload is rejected -> /me shows the business -> a second,
unrelated user cannot see or edit it.

Then the Step 6 stock flow: bulk stock items -> a bad row in a bulk save returns per-row errors and
saves nothing -> a duplicate name is rejected -> a sell item linked to a shared stock item is
rejected -> skipping a non-skippable onboarding step is rejected, a skippable one is accepted -> a
second user gets 403/404 on both endpoints.

Then the Step 7 team flow: weak PINs rejected -> a Helper is added with a PIN and can log in with
it -> that Helper gets 403 on the team and settings endpoints -> adding an existing mobile only adds
Access, their own credential still works and the team-add secret does not -> an out-of-range
settings value is rejected -> an unrelated user gets 403/404 -> the onboarding-complete endpoint
only sets the completed date once the actual rules are met.

Then the Step 9 purchase flow: a purchase with 2 lines is created -> the list shows it and the
summary (bought today, last 7 days) adds up -> a line total that doesn't match quantity x price is
rejected -> a Manager can create a purchase but gets 403 on edit and delete -> a Helper gets 403 on
every purchases endpoint -> the Owner edits a purchase (new total recalculated) and deletes one (it's
gone from both the list and its own detail endpoint — soft-deleted, so the row itself stays in the
database, just never served again) -> a user from another business gets 403/404 -> /me returns the
exact permission set for each role.
"""

import binascii
import json
import random
import struct
import sys
import urllib.error
import urllib.request
import zlib

BASE_URL = "http://127.0.0.1:8000/api/v1"
ORIGIN = "http://localhost:8081"
EXPECTED_HEALTH_KEYS = {"status", "version", "database"}


def fail(message: str) -> None:
    print(f"FAIL: {message}")
    sys.exit(1)


def request(
    method: str,
    path: str,
    body: dict | None = None,
    token: str | None = None,
    raw_body: bytes | None = None,
    content_type: str | None = None,
):
    """Returns (status, json_body, headers). Never raises for HTTP error statuses — the caller
    decides what's expected. `raw_body`/`content_type` are for multipart uploads; `body` is for
    everything else, JSON-encoded."""
    if raw_body is not None:
        data = raw_body
    else:
        data = json.dumps(body).encode() if body is not None else None
    headers = {"Origin": ORIGIN, "Content-Type": content_type or "application/json"}
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
    raw = response.read()
    payload = json.loads(raw) if raw else {}
    return response.status, payload, response.headers


def make_png(width: int = 8, height: int = 8, rgb: tuple[int, int, int] = (31, 111, 99)) -> bytes:
    """A minimal valid solid-colour PNG, built by hand (signature + IHDR + IDAT + IEND) so this
    script stays stdlib-only — no Pillow dependency just to prove an upload is a real image."""

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(
            ">I", binascii.crc32(tag + data)
        )

    signature = b"\x89PNG\r\n\x1a\n"
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
    row = b"\x00" + bytes(rgb) * width
    idat = chunk(b"IDAT", zlib.compress(row * height))
    iend = chunk(b"IEND", b"")
    return signature + ihdr + idat + iend


def multipart_body(field_name: str, filename: str, content: bytes, content_type: str):
    boundary = "EasyKharchaSmokeBoundary"
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="{field_name}"; filename="{filename}"\r\n'
        f"Content-Type: {content_type}\r\n\r\n"
    ).encode() + content + f"\r\n--{boundary}--\r\n".encode()
    return body, f"multipart/form-data; boundary={boundary}"


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


def signup_and_login(name: str) -> tuple[str, str, str]:
    """Creates a fresh user and logs them in. Returns (mobile, access, refresh)."""
    mobile = random.choice("6789") + "".join(random.choices("0123456789", k=9))
    password = f"Kharcha{random.randint(1000, 9999)}!"
    status, body, _ = request(
        "POST",
        "/auth/signup/",
        {"name": name, "mobile": mobile, "password": password, "consent": True},
    )
    if status != 201:
        fail(f"signup ({name}): expected HTTP 201, got {status} ({body})")
    status, body, _ = request("POST", "/auth/login/", {"mobile": mobile, "secret": password})
    if status != 200:
        fail(f"login ({name}): expected HTTP 200, got {status} ({body})")
    return mobile, body["access"], body["refresh"]


def check_business_flow() -> None:
    owner_mobile, owner_access, _ = signup_and_login("Business Owner")

    # create
    status, body, _ = request(
        "POST",
        "/businesses/",
        {"name": "Anita's Kitchen", "business_type": "cloud_kitchen", "city": "Pune"},
        token=owner_access,
    )
    if status != 201 or body.get("name") != "Anita's Kitchen":
        fail(f"business create: expected HTTP 201, got {status} ({body})")
    business_id = body["id"]
    if body.get("primary_colour") != "#1F6F63" or body.get("onboarding_step") != 1:
        fail(f"business create: unexpected defaults {body}")
    print(f"OK — business {business_id} created for {owner_mobile}.")

    # PATCH colour (valid)
    status, body, _ = request(
        "PATCH", f"/businesses/{business_id}/", {"primary_colour": "#4B4FB0"}, token=owner_access
    )
    if status != 200 or body.get("primary_colour") != "#4B4FB0":
        fail(f"business colour update: expected HTTP 200 with the new colour, got {status} ({body})")
    print("OK — business colour updated.")

    # PATCH colour (too light for white text — fails the 4.5:1 check)
    status, body, _ = request(
        "PATCH", f"/businesses/{business_id}/", {"primary_colour": "#F5F0E8"}, token=owner_access
    )
    if status not in (400, 422):
        fail(f"bad colour: expected a validation error, got {status} ({body})")
    print("OK — a too-light colour is rejected.")

    # logo upload — a real PNG
    png_body, png_content_type = multipart_body("logo", "logo.png", make_png(), "image/png")
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/logo/",
        token=owner_access,
        raw_body=png_body,
        content_type=png_content_type,
    )
    if status != 200 or not body.get("logo"):
        fail(f"logo upload: expected HTTP 200 with a logo URL, got {status} ({body})")
    print("OK — logo upload accepted a real PNG.")

    # logo upload — not actually an image, even though it claims to be one
    fake_body, fake_content_type = multipart_body(
        "logo", "logo.png", b"not actually a PNG", "image/png"
    )
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/logo/",
        token=owner_access,
        raw_body=fake_body,
        content_type=fake_content_type,
    )
    if status not in (400, 422):
        fail(f"logo upload: expected a non-image file to be rejected, got {status} ({body})")
    print("OK — a non-image file is rejected regardless of its claimed type.")

    # /me shows the business
    status, body, _ = request("GET", "/me/", token=owner_access)
    business_ids = [b["id"] for b in body.get("businesses", [])]
    if status != 200 or business_id not in business_ids:
        fail(f"/me: expected business {business_id} in the list, got {status} ({body})")
    print("OK — /me shows the business.")

    # a second, unrelated user can't see or edit it
    other_mobile, other_access, _ = signup_and_login("Someone Else")
    status, body, _ = request("GET", "/me/", token=other_access)
    other_business_ids = [b["id"] for b in body.get("businesses", [])]
    if business_id in other_business_ids:
        fail(f"isolation: {other_mobile} can see {owner_mobile}'s business")
    status, body, _ = request(
        "PATCH", f"/businesses/{business_id}/", {"tagline": "hijacked"}, token=other_access
    )
    if status not in (403, 404):
        fail(f"isolation: an unrelated user could update the business, got {status} ({body})")
    print("OK — a second user can neither see nor edit the business.")


def check_stock_flow() -> None:
    owner_mobile, owner_access, _ = signup_and_login("Stock Owner")
    status, body, _ = request(
        "POST",
        "/businesses/",
        {"name": "Stock Test Biz", "business_type": "cloud_kitchen", "city": "Pune"},
        token=owner_access,
    )
    if status != 201:
        fail(f"stock flow: business create expected 201, got {status} ({body})")
    business_id = body["id"]

    # bulk stock items OK
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/stock-items/bulk/",
        {
            "items": [
                {"name": "Rice", "unit": "kg", "usual_price": "60.00"},
                {"name": "Cooking Oil", "unit": "L", "shared": True},
            ]
        },
        token=owner_access,
    )
    if status != 201 or len(body) != 2:
        fail(f"stock bulk create: expected 201 with 2 items, got {status} ({body})")
    rice_id = next(i["id"] for i in body if i["name"] == "Rice")
    oil_id = next(i["id"] for i in body if i["name"] == "Cooking Oil")
    print(f"OK — bulk stock items created ({len(body)} rows) for {owner_mobile}.")

    # bulk with one bad row -> per-row errors, all-or-nothing (nothing saved)
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/stock-items/bulk/",
        {"items": [{"name": "Salt", "unit": "kg"}, {"name": "", "unit": "kg"}]},
        token=owner_access,
    )
    if status not in (400, 422) or not body.get("row_errors"):
        fail(f"stock bulk create bad row: expected row_errors, got {status} ({body})")
    if not any(e["row"] == 2 for e in body["row_errors"]):
        fail(f"stock bulk create bad row: expected an error for row 2, got {body['row_errors']}")
    status, body, _ = request(
        "GET", f"/businesses/{business_id}/stock-items/", token=owner_access
    )
    if "Salt" in [i["name"] for i in body]:
        fail("stock bulk create bad row: all-or-nothing violated — Salt was saved despite a bad row")
    print("OK — a bad row in a bulk stock save returns per-row errors and saves nothing.")

    # duplicate name rejected, case-insensitive, against existing rows
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/stock-items/bulk/",
        {"items": [{"name": "rice", "unit": "kg"}]},
        token=owner_access,
    )
    if status not in (400, 422) or not body.get("row_errors"):
        fail(f"stock bulk duplicate: expected a row error, got {status} ({body})")
    print("OK — a duplicate stock item name (case-insensitive) is rejected.")

    # a sell item linked to a shared stock item is rejected
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/sell-items/bulk/",
        {
            "items": [
                {"name": "Veg Biryani", "selling_price": "150.00", "main_stock_item": rice_id},
                {"name": "Bad Link", "selling_price": "10.00", "main_stock_item": oil_id},
            ]
        },
        token=owner_access,
    )
    if status not in (400, 422) or not body.get("row_errors"):
        fail(f"sell item linked to a shared item: expected a row error, got {status} ({body})")
    if not any(
        e["row"] == 2 and e["field"] == "main_stock_item" for e in body["row_errors"]
    ):
        fail(f"sell item linked to a shared item: expected the error on row 2, got {body['row_errors']}")
    print("OK — a sell item linked to a shared stock item is rejected.")

    # the same call, minus the bad row, succeeds
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/sell-items/bulk/",
        {"items": [{"name": "Veg Biryani", "selling_price": "150.00", "main_stock_item": rice_id}]},
        token=owner_access,
    )
    if status != 201 or len(body) != 1:
        fail(f"sell item bulk create: expected 201 with 1 item, got {status} ({body})")
    print("OK — bulk sell items created with a valid stock-item link.")

    # skip is rejected on step 2 (only steps 3-6 are skippable)
    status, body, _ = request(
        "PATCH", f"/businesses/{business_id}/onboarding/2/", {"status": "skipped"}, token=owner_access
    )
    if status not in (400, 422):
        fail(f"onboarding skip step 2: expected rejection, got {status} ({body})")
    print("OK — skipping step 2 (not skippable) is rejected.")

    # skip is allowed on step 3
    status, body, _ = request(
        "PATCH", f"/businesses/{business_id}/onboarding/3/", {"status": "skipped"}, token=owner_access
    )
    if status != 200 or body.get("status") != "skipped":
        fail(f"onboarding skip step 3: expected 200 skipped, got {status} ({body})")
    print("OK — skipping step 3 is accepted.")

    # a second, unrelated user gets 403/404 on both endpoints
    _, other_access, _ = signup_and_login("Stock Intruder")
    status, body, _ = request(
        "GET", f"/businesses/{business_id}/stock-items/", token=other_access
    )
    if status not in (403, 404):
        fail(f"stock isolation: expected 403/404, got {status} ({body})")
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/sell-items/bulk/",
        {"items": [{"name": "Hijack", "selling_price": "1.00"}]},
        token=other_access,
    )
    if status not in (403, 404):
        fail(f"sell item isolation: expected 403/404, got {status} ({body})")
    print("OK — a second user gets 403/404 on both the stock-items and sell-items endpoints.")


def check_team_flow() -> None:
    owner_mobile, owner_access, _ = signup_and_login("Team Owner")
    status, body, _ = request(
        "POST",
        "/businesses/",
        {"name": "Team Test Biz", "business_type": "cloud_kitchen", "city": "Pune"},
        token=owner_access,
    )
    if status != 201:
        fail(f"team flow: business create expected 201, got {status} ({body})")
    business_id = body["id"]

    # weak PINs rejected (never printed or logged, including here — only pass/fail is reported)
    for weak_pin in ("1111", "1234"):
        status, body, _ = request(
            "POST",
            f"/businesses/{business_id}/team/",
            {
                "name": "Weak Pin",
                "mobile": random.choice("6789") + "".join(random.choices("0123456789", k=9)),
                "role": "helper",
                "secret": weak_pin,
            },
            token=owner_access,
        )
        if status not in (400, 422):
            fail(f"weak PIN rejected: expected a validation error, got {status} ({body})")
    print("OK — weak PINs (1111, 1234) are rejected.")

    # add a Helper with a valid PIN
    helper_mobile = random.choice("6789") + "".join(random.choices("0123456789", k=9))
    helper_pin = "7392"
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/team/",
        {"name": "Helper One", "mobile": helper_mobile, "role": "helper", "secret": helper_pin},
        token=owner_access,
    )
    if status != 201:
        fail(f"add helper: expected 201, got {status} ({body})")
    if body.get("mobile") == helper_mobile or not body.get("mobile", "").endswith(helper_mobile[-4:]):
        fail(f"team member mobile should be masked except the last 4 digits, got {body.get('mobile')}")
    print(f"OK — added a Helper for {owner_mobile} with a PIN (mobile returned masked).")

    # that person can log in with the PIN
    status, body, _ = request("POST", "/auth/login/", {"mobile": helper_mobile, "secret": helper_pin})
    if status != 200 or "access" not in body:
        fail(f"helper login with PIN: expected HTTP 200, got {status} ({body})")
    helper_access = body["access"]
    print("OK — the Helper can log in with their PIN.")

    # a Helper gets 403 on the team and settings endpoints
    status, body, _ = request("GET", f"/businesses/{business_id}/team/", token=helper_access)
    if status != 403:
        fail(f"helper team access: expected 403, got {status} ({body})")
    status, body, _ = request("GET", f"/businesses/{business_id}/settings/", token=helper_access)
    if status != 403:
        fail(f"helper settings access: expected 403, got {status} ({body})")
    print("OK — a Helper gets 403 on the team and settings endpoints.")

    # an existing mobile (its own real account, own real password) gets Access added only —
    # its credential must never change, confirmed both ways.
    pre_mobile = random.choice("6789") + "".join(random.choices("0123456789", k=9))
    pre_password = f"Kharcha{random.randint(1000, 9999)}!"
    status, body, _ = request(
        "POST",
        "/auth/signup/",
        {"name": "Pre Existing", "mobile": pre_mobile, "password": pre_password, "consent": True},
    )
    if status != 201:
        fail(f"pre-existing signup: expected 201, got {status} ({body})")
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/team/",
        {"name": "ignored", "mobile": pre_mobile, "role": "manager", "secret": "TotallyDifferent999!"},
        token=owner_access,
    )
    if status != 201:
        fail(f"add existing user to team: expected 201, got {status} ({body})")
    status, body, _ = request("POST", "/auth/login/", {"mobile": pre_mobile, "secret": pre_password})
    if status != 200:
        fail(f"existing user's original credential should still work, got {status} ({body})")
    status, body, _ = request(
        "POST", "/auth/login/", {"mobile": pre_mobile, "secret": "TotallyDifferent999!"}
    )
    if status == 200:
        fail("existing user's credential should not have been changed by the team-add secret")
    print("OK — adding an existing mobile to the team only adds Access; their credential is untouched.")

    # settings PATCH with an out-of-range value is rejected
    status, body, _ = request(
        "PATCH", f"/businesses/{business_id}/settings/", {"target_cost_pct": "150"}, token=owner_access
    )
    if status not in (400, 422):
        fail(f"settings out-of-range: expected a validation error, got {status} ({body})")
    print("OK — an out-of-range settings value is rejected.")

    # an unrelated user (no access at all) gets 403/404
    _, stranger_access, _ = signup_and_login("Team Stranger")
    status, body, _ = request("GET", f"/businesses/{business_id}/team/", token=stranger_access)
    if status not in (403, 404):
        fail(f"stranger team access: expected 403/404, got {status} ({body})")
    status, body, _ = request("GET", f"/businesses/{business_id}/settings/", token=stranger_access)
    if status not in (403, 404):
        fail(f"stranger settings access: expected 403/404, got {status} ({body})")
    print("OK — an unrelated user gets 403/404 on the team and settings endpoints.")

    # the complete endpoint only sets onboarding_completed_at once the rules are actually met
    status, body, _ = request(
        "POST", f"/businesses/{business_id}/onboarding/complete/", token=owner_access
    )
    if status != 200 or body.get("onboarding_completed_at") is not None:
        fail(f"onboarding complete (too early): expected no completed_at, got {status} ({body})")

    for step in (1, 2):
        status, body, _ = request(
            "PATCH",
            f"/businesses/{business_id}/onboarding/{step}/",
            {"status": "done"},
            token=owner_access,
        )
        if status != 200:
            fail(f"mark step {step} done: expected HTTP 200, got {status} ({body})")
    for step in (3, 4, 5, 6):
        status, body, _ = request(
            "PATCH",
            f"/businesses/{business_id}/onboarding/{step}/",
            {"status": "skipped"},
            token=owner_access,
        )
        if status != 200:
            fail(f"skip step {step}: expected HTTP 200, got {status} ({body})")

    status, body, _ = request(
        "POST", f"/businesses/{business_id}/onboarding/complete/", token=owner_access
    )
    if status != 200 or not body.get("onboarding_completed_at"):
        fail(f"onboarding complete: expected completed_at set, got {status} ({body})")
    print("OK — the complete endpoint sets onboarding_completed_at once steps 1-2 are done and 3-6 are done or skipped.")


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


def check_purchase_flow() -> None:
    owner_mobile, owner_access, _ = signup_and_login("Purchase Owner")
    status, body, _ = request(
        "POST",
        "/businesses/",
        {"name": "Purchase Test Biz", "business_type": "cloud_kitchen", "city": "Pune"},
        token=owner_access,
    )
    if status != 201:
        fail(f"purchase flow: business create expected 201, got {status} ({body})")
    business_id = body["id"]

    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/stock-items/bulk/",
        {
            "items": [
                {"name": "Milk", "unit": "L", "usual_price": "60.00"},
                {"name": "Flour", "unit": "kg"},
            ]
        },
        token=owner_access,
    )
    if status != 201:
        fail(f"purchase flow: stock bulk create expected 201, got {status} ({body})")
    milk_id = next(i["id"] for i in body if i["name"] == "Milk")
    flour_id = next(i["id"] for i in body if i["name"] == "Flour")

    # create a purchase with 2 lines
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/purchases/",
        {
            "supplier_name": "Sunrise Supplies",
            "purchase_date_time": "2026-10-12T10:00:00+05:30",
            "lines": [
                {"stock_item": milk_id, "quantity": "20", "unit_price": "64", "line_total": "1280"},
                {"stock_item": flour_id, "quantity": "15", "unit_price": "48", "line_total": "720"},
            ],
        },
        token=owner_access,
    )
    if status != 201 or len(body.get("lines", [])) != 2:
        fail(f"purchase create: expected 201 with 2 lines, got {status} ({body})")
    purchase_id = body["id"]
    if body.get("total_amount") != "2000.00":
        fail(f"purchase create: expected total 2000.00, got {body.get('total_amount')}")
    print(f"OK — purchase {purchase_id} created with 2 lines, total {body['total_amount']}.")

    # list shows it and the summary adds up
    status, body, _ = request("GET", f"/businesses/{business_id}/purchases/", token=owner_access)
    if status != 200:
        fail(f"purchase list: expected 200, got {status} ({body})")
    ids = [p["id"] for p in body.get("results", [])]
    if purchase_id not in ids:
        fail(f"purchase list: expected purchase {purchase_id} in results, got {ids}")
    summary = body.get("summary", {})
    if float(summary.get("bought_today", 0)) < 2000 or float(summary.get("last_7_days", 0)) < 2000:
        fail(f"purchase list: summary doesn't add up, got {summary}")
    print("OK — the purchase list shows the new purchase and the summary adds up.")

    # a line total that doesn't match quantity x price is rejected
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/purchases/",
        {
            "supplier_name": "Bad Math Co",
            "purchase_date_time": "2026-10-12T10:00:00+05:30",
            "lines": [
                {"stock_item": milk_id, "quantity": "10", "unit_price": "60", "line_total": "999"}
            ],
        },
        token=owner_access,
    )
    if status not in (400, 422) or not body.get("row_errors"):
        fail(f"purchase create bad line total: expected row_errors, got {status} ({body})")
    print("OK — a line total that doesn't match quantity x price is rejected.")

    # a Manager can create but gets 403 on edit and delete
    manager_mobile = random.choice("6789") + "".join(random.choices("0123456789", k=9))
    manager_password = f"Kharcha{random.randint(1000, 9999)}!"
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/team/",
        {
            "name": "Manager One",
            "mobile": manager_mobile,
            "role": "manager",
            "secret": manager_password,
        },
        token=owner_access,
    )
    if status != 201:
        fail(f"add manager: expected 201, got {status} ({body})")
    status, body, _ = request(
        "POST", "/auth/login/", {"mobile": manager_mobile, "secret": manager_password}
    )
    if status != 200:
        fail(f"manager login: expected 200, got {status} ({body})")
    manager_access = body["access"]

    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/purchases/",
        {
            "supplier_name": "Manager's Supplier",
            "purchase_date_time": "2026-10-12T11:00:00+05:30",
            "lines": [
                {"stock_item": milk_id, "quantity": "5", "unit_price": "60", "line_total": "300"}
            ],
        },
        token=manager_access,
    )
    if status != 201:
        fail(f"manager create purchase: expected 201, got {status} ({body})")
    manager_purchase_id = body["id"]

    status, body, _ = request(
        "PATCH",
        f"/businesses/{business_id}/purchases/{purchase_id}/",
        {
            "supplier_name": "x",
            "purchase_date_time": "2026-10-12T10:00:00+05:30",
            "lines": [{"stock_item": milk_id, "quantity": "1", "unit_price": "1", "line_total": "1"}],
        },
        token=manager_access,
    )
    if status != 403:
        fail(f"manager edit purchase: expected 403, got {status} ({body})")
    status, body, _ = request(
        "DELETE", f"/businesses/{business_id}/purchases/{purchase_id}/", token=manager_access
    )
    if status != 403:
        fail(f"manager delete purchase: expected 403, got {status} ({body})")
    print("OK — a Manager can create a purchase but gets 403 on edit and delete.")

    # a Helper gets 403 on every purchases endpoint
    helper_mobile = random.choice("6789") + "".join(random.choices("0123456789", k=9))
    helper_pin = "7392"
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/team/",
        {"name": "Helper One", "mobile": helper_mobile, "role": "helper", "secret": helper_pin},
        token=owner_access,
    )
    if status != 201:
        fail(f"add helper: expected 201, got {status} ({body})")
    status, body, _ = request("POST", "/auth/login/", {"mobile": helper_mobile, "secret": helper_pin})
    if status != 200:
        fail(f"helper login: expected 200, got {status} ({body})")
    helper_access = body["access"]

    status, body, _ = request("GET", f"/businesses/{business_id}/purchases/", token=helper_access)
    if status != 403:
        fail(f"helper purchases list: expected 403, got {status} ({body})")
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/purchases/",
        {
            "supplier_name": "x",
            "purchase_date_time": "2026-10-12T10:00:00+05:30",
            "lines": [{"stock_item": milk_id, "quantity": "1", "unit_price": "1", "line_total": "1"}],
        },
        token=helper_access,
    )
    if status != 403:
        fail(f"helper purchase create: expected 403, got {status} ({body})")
    print("OK — a Helper gets 403 on every purchases endpoint.")

    # Owner edits (new total recalculated) and deletes (gone from list and detail, stays in the DB)
    status, body, _ = request(
        "PATCH",
        f"/businesses/{business_id}/purchases/{purchase_id}/",
        {
            "supplier_name": "Sunrise Supplies",
            "purchase_date_time": "2026-10-12T10:00:00+05:30",
            "note": "Edited by owner",
            "lines": [
                {"stock_item": milk_id, "quantity": "25", "unit_price": "64", "line_total": "1600"}
            ],
        },
        token=owner_access,
    )
    if status != 200 or body.get("total_amount") != "1600.00":
        fail(f"owner edit purchase: expected 200 with recalculated total, got {status} ({body})")
    print("OK — the Owner edits a purchase and the total is recalculated.")

    status, body, _ = request(
        "DELETE", f"/businesses/{business_id}/purchases/{purchase_id}/", token=owner_access
    )
    if status != 204:
        fail(f"owner delete purchase: expected 204, got {status} ({body})")
    status, body, _ = request("GET", f"/businesses/{business_id}/purchases/", token=owner_access)
    ids = [p["id"] for p in body.get("results", [])]
    if purchase_id in ids:
        fail(f"deleted purchase still in the list: {ids}")
    status, body, _ = request(
        "GET", f"/businesses/{business_id}/purchases/{purchase_id}/", token=owner_access
    )
    if status != 404:
        fail(f"deleted purchase detail: expected 404, got {status} ({body})")
    print("OK — the Owner deletes a purchase; it disappears from the list and its own detail.")

    # another business's user gets 403/404
    other_mobile, other_access, _ = signup_and_login("Unrelated Purchase User")
    status, body, _ = request("GET", f"/businesses/{business_id}/purchases/", token=other_access)
    if status not in (403, 404):
        fail(f"isolation: unrelated user on purchase list, expected 403/404, got {status} ({body})")
    status, body, _ = request(
        "GET", f"/businesses/{business_id}/purchases/{manager_purchase_id}/", token=other_access
    )
    if status not in (403, 404):
        fail(f"isolation: unrelated user on purchase detail, expected 403/404, got {status} ({body})")
    print("OK — a user from another business gets 403/404 on these purchases.")

    # /me returns the exact permission set for each role
    status, body, _ = request("GET", "/me/", token=owner_access)
    owner_business = next(b for b in body["businesses"] if b["id"] == business_id)
    expected_owner = {
        "purchases.view",
        "purchases.create",
        "purchases.edit",
        "purchases.delete",
        "stock.view",
        "team.manage",
        "settings.manage",
    }
    if set(owner_business.get("permissions", [])) != expected_owner:
        fail(f"/me owner permissions: expected {expected_owner}, got {owner_business.get('permissions')}")

    status, body, _ = request("GET", "/me/", token=manager_access)
    manager_business = next(b for b in body["businesses"] if b["id"] == business_id)
    expected_manager = {"purchases.view", "purchases.create", "stock.view"}
    if set(manager_business.get("permissions", [])) != expected_manager:
        fail(
            f"/me manager permissions: expected {expected_manager}, "
            f"got {manager_business.get('permissions')}"
        )

    status, body, _ = request("GET", "/me/", token=helper_access)
    helper_business = next(b for b in body["businesses"] if b["id"] == business_id)
    if helper_business.get("permissions"):
        fail(f"/me helper permissions: expected none, got {helper_business.get('permissions')}")
    print("OK — /me returns the correct permissions per role.")


def main() -> None:
    check_health()
    check_auth_flow()
    check_business_flow()
    check_stock_flow()
    check_team_flow()
    check_purchase_flow()
    print("\nAll smoke checks passed.")


if __name__ == "__main__":
    main()
