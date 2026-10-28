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

Then the Step 10 counts/wastage flow: the blind count form returns only id/name/unit (nothing else,
for any role) -> a Helper gets 403 on purchases, stock detail, and count review, and sees no rupee
value on their own wastage entries -> a Helper submits an opening count (201), a second opening count
for the same date is rejected -> an unusually high closing-count value is rejected with
needs_confirmation and no numbers, and succeeds once re-sent with confirm_ids -> with
closing_count_hour set to 0, that closing count is late -> count review lists both counts with the
right late flag, and the detail's used_since_last_count math checks out for a known case, with no
expected/gap field anywhere -> wastage: a Helper sees only their own entries, a Head chef sees every
entry with no values, a Manager sees values but gets 403 on create/delete, and the Owner soft-deletes
one -> another business's users get 403/404 on every new endpoint.

Then the Step 23b daily-counts flow: a closing before any opening, with neither deadline passed, is
rejected opening_required (counts/today/ agrees: closing locked, next_action opening) -> once both
deadlines are in the past with no opening done, counts/today/ flags missing_opening and the closing
now succeeds, flagged missing_opening on the saved row -> a duplicate closing is still rejected, and
a late opening after closing still succeeds -> day_starts_hour=3 shifts counts/today/'s business_date
by the same formula computed independently here -> a second business trips both opening_late and
closing_late at once, and checking one leaves the other open.

Then the Step 12 settings flow: renaming a stock item succeeds -> a case-insensitive duplicate name
is rejected -> changing its unit is refused once it has a purchase -> deactivating it is refused while
an active dish still has it as an ingredient -> deactivating that dish, then the stock item, both
succeed -> editing a dish's ingredients re-confirms its recipe -> a Manager gets 403 on every one of
these PATCHes -> audit rows exist for the stock and sell item updates.

Then the Step 13 team reset flow: a weak PIN is rejected on reset -> resetting a Helper's PIN
invalidates the old PIN and their old refresh token, and the new PIN works -> Helper <-> Head chef
role changes need no secret -> changing to Manager without a secret is rejected, and succeeds once
one is given -> removing a member drops their access to the business but their account still exists
-> the Owner can't reset or remove their own Owner access -> a Manager gets 403 on reset, role
change, and remove, but can still view the team list.

Then the Step 14 sales/stock-gap flow: an opening count (Milk, 12 L) -> a purchase (20 L at Rs 64)
and wastage (1.5 L) in between -> a closing count (8 L) -> used_since_last_count 22.5 -> a dish
("Tea pack", a confirmed recipe using 0.2 L milk) sells 100 units in the window -> count review shows
expected_used 20, gap_qty 2.5, gap_value Rs 160, status ok, flagged (12.5% over the 10% default) ->
a second, unrelated dish with no recipe at all (recipe_status=none, no ingredients — the
no-ingredients bulk endpoint) doesn't touch Milk's gap in any way -> deleting the window's only sale
makes it not_comparable/sales_missing with that date -> a Manager can record sales but gets 403 on
delete -> a Helper gets 403 on every sales endpoint -> a future-dated sale is rejected -> the Owner
deletes a sale and the summary updates -> Helper/Head chef count endpoints carry no expected/gap
field (enforced by the existing 403 on count review).

Then the Step 15 alerts flow: one business trips closing_late (closing_count_hour 0), price_rise (two
purchases at 60 then one at 70) and wastage_high (2 L wasted against 20 L bought) in a single GET,
with the right severities, numbers and next-action routes -> today/ carries the same alerts_count for
the Owner -> checking one alert hides it and the counts drop, and checking it again is rejected ->
a Helper gets 403 on both alerts endpoints and sees no alerts_count -> a Manager can view and check.
A second business reuses the Step 14 gap numbers to prove a flagged gap line surfaces as a danger
gap_flagged alert (closing_late and gap_flagged can't both appear in one business/day — a submitted
opening count is unavoidably needed as the gap's "previous" baseline, which leaves no count-type slot
free to be late that same day).

Then the Step 16 reports flow: its own business reuses the Step 14/15 Milk gap numbers (opening 12 L,
20 L bought at Rs 64, 1.5 L wasted, closing 8 L, 100 Tea packs sold) so money_went's gap_value and
biggest_gaps both show Milk at Rs 160, and sales_vs_cost's cost works out to (100 x 0.2 x 64) / 2000 =
64% of the Rs 2000 sale. A second item, Flour, gets two purchases (Rs 60 then Rs 70) with nothing else
pointing at it, so it's the only item with 2+ price points in the period and price_trend's default
picker (no ?item=) lands on it at +16.7% — Milk itself can't be reused for that: its gap_value has to
stay tied to its *last* purchase price (64, same rule alerts.gap_flagged already relies on), which a
60 -> 70 Milk history would have moved to 70 and broken the Rs 160 figure. Then a Helper gets 403, and
a brand-new business with no purchases/counts/sales at all returns every block present but empty, with
no 500.

Then the Step 21b pincode flow: 560034 resolves to Karnataka / Bengaluru with Koramangala among its
areas -> 999999 (well-formed but absent) is a 404 -> a badly-shaped code is a 400, not a 404 -> signed
out is a 401. Business create accepts a pincode whose district matches the given city (state filled in
automatically) -> rejects one whose city doesn't match any of the pincode's areas -> rejects an unknown
pincode outright -> accepts that same unknown pincode once manual_location is set, saving the typed
city/state as-is -> a later update giving a mismatched state for an existing pincode is rejected too.

Then the Step 22a dish-recipe flow: a dish can't be saved with zero ingredients -> a shared stock item
can't be picked as one -> the same stock item twice in one dish is rejected -> a 0.150 kg ingredient
amount (what the client already converted "150 g" down to) stores and reads back as exactly that ->
a valid 2-ingredient dish lands at recipe_status=confirmed -> editing it to a different ingredient set
replaces the rows and keeps it confirmed -> the no-ingredients bulk endpoint always creates
recipe_status=none, and skip_existing makes repeating the same bulk call a no-op instead of erroring
on the names it already created.
"""

import argparse
import binascii
import json
import os
import random
import sqlite3
import struct
import sys
import time
import urllib.error
import urllib.request
import zlib
from datetime import datetime, timedelta, timezone as dt_timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

BASE_URL = "http://127.0.0.1:8000/api/v1"
ORIGIN = "http://localhost:8081"
EXPECTED_HEALTH_KEYS = {"status", "version", "database"}
# There's no API for the audit log (it's never been queried by anything but a human so far) — reading
# the dev sqlite file directly, read-only, is the lightest way to prove a row actually landed without
# standing up a new endpoint just for this check.
DB_PATH = os.path.join(os.path.dirname(__file__), "..", "backend", "db.sqlite3")


def count_audit_rows(action: str, business_id: int) -> int:
    conn = sqlite3.connect(f"file:{os.path.abspath(DB_PATH)}?mode=ro", uri=True)
    try:
        cursor = conn.execute(
            "SELECT COUNT(*) FROM audit_auditlog WHERE action = ? AND business_id = ?",
            (action, business_id),
        )
        return cursor.fetchone()[0]
    finally:
        conn.close()


def fail(message: str) -> None:
    print(f"FAIL: {message}")
    sys.exit(1)


def _now_iso() -> str:
    return datetime.now(dt_timezone.utc).isoformat()


def _days_ago_iso(days: int) -> str:
    return (datetime.now(dt_timezone.utc) - timedelta(days=days)).isoformat()


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
    req = urllib.request.Request(
        f"{BASE_URL}{path}", data=data, headers=headers, method=method
    )
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


def make_png(
    width: int = 8,
    height: int = 8,
    rgb: tuple[int, int, int] = (31, 111, 99),
    marker: bytes | None = None,
) -> bytes:
    """A minimal valid solid-colour PNG, built by hand (signature + IHDR + IDAT + IEND) so this
    script stays stdlib-only — no Pillow dependency just to prove an upload is a real image. `marker`
    (the ai/ smoke checks' AI_FAKE trigger bytes) rides along in a harmless tEXt metadata chunk, which
    a real PNG decoder (Pillow included) just ignores — the file still decodes as a normal image."""

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", binascii.crc32(tag + data))
        )

    signature = b"\x89PNG\r\n\x1a\n"
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
    text = chunk(b"tEXt", b"Comment\x00" + marker) if marker else b""
    row = b"\x00" + bytes(rgb) * width
    idat = chunk(b"IDAT", zlib.compress(row * height))
    iend = chunk(b"IEND", b"")
    return signature + ihdr + text + idat + iend


def make_pdf(
    num_pages: int = 1,
    marker: bytes | None = None,
    page_markers: dict[int, bytes] | None = None,
) -> bytes:
    """A minimal valid PDF with `num_pages` blank pages, built by hand (same stdlib-only approach as
    make_png) — just enough structure (objects + a correct xref table) for pypdf to read %PDF- and
    count pages. `marker` is the ai/ smoke checks' AI_FAKE trigger bytes, tucked into an unreferenced
    comment object: present in the raw bytes of an unchunked/unsplit upload, but dropped by any pypdf
    rewrite (ai/extraction.py's page-chunking and page-split both go through pypdf), which is exactly
    what proves a chunk-level overflow retry actually re-sends smaller data rather than the same
    bytes. `page_markers` (1-indexed page number -> marker) instead attaches the marker as a custom
    Name entry directly on one page's own dict, which — unlike the free-floating `marker` object —
    pypdf DOES carry across both chunking and page-splitting, and only onto that one page's output,
    letting a smoke check target exactly one page of a multi-page PDF."""
    page_markers = page_markers or {}
    objects: list[bytes] = [b"<< /Type /Catalog /Pages 2 0 R >>"]
    page_ids = list(range(3, 3 + num_pages))
    kids = " ".join(f"{page_id} 0 R" for page_id in page_ids)
    objects.append(f"<< /Type /Pages /Kids [{kids}] /Count {num_pages} >>".encode())
    for page_number, _page_id in enumerate(page_ids, start=1):
        page_marker = page_markers.get(page_number)
        extra = f" /SmokeMarker /{page_marker.decode()}" if page_marker else ""
        objects.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72]{extra} >>".encode()
        )
    if marker:
        objects.append(b"<< /Type /SmokeMarker >>\n% " + marker)

    parts = [b"%PDF-1.4\n"]
    offsets = []
    for index, body in enumerate(objects, start=1):
        offsets.append(sum(len(part) for part in parts))
        parts.append(f"{index} 0 obj\n".encode() + body + b"\nendobj\n")

    xref_offset = sum(len(part) for part in parts)
    count = len(objects) + 1
    xref = [f"xref\n0 {count}\n".encode(), b"0000000000 65535 f \n"]
    xref.extend(f"{offset:010d} 00000 n \n".encode() for offset in offsets)
    trailer = f"trailer\n<< /Size {count} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF".encode()

    return b"".join(parts) + b"".join(xref) + trailer


def multipart_body(field_name: str, filename: str, content: bytes, content_type: str):
    boundary = "EasyKharchaSmokeBoundary"
    body = (
        (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="{field_name}"; filename="{filename}"\r\n'
            f"Content-Type: {content_type}\r\n\r\n"
        ).encode()
        + content
        + f"\r\n--{boundary}--\r\n".encode()
    )
    return body, f"multipart/form-data; boundary={boundary}"


def multipart_multi_body(files: list[tuple[str, str, bytes, str]]):
    """Like multipart_body but for more than one file under the same (or different) field name(s) —
    the ai/ menu-scan upload's `images` field, which can repeat 1-6 times in one request."""
    boundary = "EasyKharchaSmokeBoundaryMulti"
    parts = [
        (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="{field_name}"; filename="{filename}"\r\n'
            f"Content-Type: {content_type}\r\n\r\n"
        ).encode()
        + content
        + b"\r\n"
        for field_name, filename, content, content_type in files
    ]
    body = b"".join(parts) + f"--{boundary}--\r\n".encode()
    return body, f"multipart/form-data; boundary={boundary}"


def _create_dish(
    business_id: str,
    owner_access: str,
    name: str,
    price: str,
    ingredients: list[tuple[int, str]],
    group: str | None = None,
    portion_label: str | None = None,
) -> tuple[int, dict]:
    """POSTs sell-items/ — Step 22a's single dish create, the only way to attach ingredients. Always
    lands at recipe_status=confirmed; fails loudly on anything but 201. Returns (dish_id, body)."""
    payload: dict = {
        "name": name,
        "selling_price": price,
        "ingredients": [
            {"stock_item": sid, "quantity": qty} for sid, qty in ingredients
        ],
    }
    if group is not None:
        payload["group"] = group
    if portion_label is not None:
        payload["portion_label"] = portion_label
    status, body, _ = request(
        "POST", f"/businesses/{business_id}/sell-items/", payload, token=owner_access
    )
    if status != 201:
        fail(f"create dish ({name}): expected 201, got {status} ({body})")
    return body["id"], body


def check_health() -> None:
    status, body, headers = request("GET", "/health/")
    if status != 200:
        fail(f"health: expected HTTP 200, got {status}")
    if set(body.keys()) != EXPECTED_HEALTH_KEYS:
        fail(
            f"health: unexpected JSON shape, expected keys {EXPECTED_HEALTH_KEYS}, got {body}"
        )
    if body.get("status") != "ok" or body.get("database") != "ok":
        fail(f"health: reports a problem: {body}")
    if headers.get("Access-Control-Allow-Origin") != ORIGIN:
        fail(f"health: missing or wrong CORS header for Origin {ORIGIN!r}")
    print(
        f"OK — {BASE_URL}/health/ reachable, response shape correct, CORS header present."
    )


def check_permission_table() -> None:
    """Step 23a: imports backend/businesses/permissions.py directly (not through the API) and prints
    the role -> permission table for review. Fails if the Owner is ever missing a permission that
    exists for any other role — the real regression this guards against is someone going back to a
    hand-listed Owner set that silently drifts behind ALL_PERMISSIONS."""
    backend_dir = os.path.join(os.path.dirname(__file__), "..", "backend")
    sys.path.insert(0, os.path.abspath(backend_dir))
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
    import django

    django.setup()

    from businesses.models import AccessRole
    from businesses.permissions import ALL_PERMISSIONS, PERMISSIONS

    print("\nRole -> permission table:")
    for role in (AccessRole.OWNER, AccessRole.MANAGER, AccessRole.HEAD_CHEF, AccessRole.HELPER):
        perms = sorted(PERMISSIONS.get(role, frozenset()))
        print(f"  {role} ({len(perms)}): {perms}")

    owner_perms = PERMISSIONS[AccessRole.OWNER]
    missing = ALL_PERMISSIONS - owner_perms
    if missing:
        fail(f"permission table: Owner is missing {sorted(missing)} from ALL_PERMISSIONS")
    if owner_perms != ALL_PERMISSIONS:
        fail(
            "permission table: Owner carries permission(s) outside ALL_PERMISSIONS — "
            f"got {sorted(owner_perms)}"
        )
    print("OK — the Owner carries every permission in ALL_PERMISSIONS, and nothing extra.")


def signup_and_login(name: str) -> tuple[str, str, str]:
    """Creates a fresh user (and, Step F2, their one auto-created business) and logs them in.
    Returns (mobile, access, refresh)."""
    mobile = random.choice("6789") + "".join(random.choices("0123456789", k=9))
    password = f"Kharcha{random.randint(1000, 9999)}!"
    status, body, _ = request(
        "POST",
        "/auth/signup/",
        {
            "name": name,
            "business_name": f"{name}'s Business",
            "mobile": mobile,
            "password": password,
            "consent": True,
        },
    )
    if status != 201:
        fail(f"signup ({name}): expected HTTP 201, got {status} ({body})")
    status, body, _ = request(
        "POST", "/auth/login/", {"mobile": mobile, "secret": password}
    )
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
        "PATCH",
        f"/businesses/{business_id}/",
        {"primary_colour": "#4B4FB0"},
        token=owner_access,
    )
    if status != 200 or body.get("primary_colour") != "#4B4FB0":
        fail(
            f"business colour update: expected HTTP 200 with the new colour, got {status} ({body})"
        )
    print("OK — business colour updated.")

    # PATCH colour (too light for white text — fails the 4.5:1 check)
    status, body, _ = request(
        "PATCH",
        f"/businesses/{business_id}/",
        {"primary_colour": "#F5F0E8"},
        token=owner_access,
    )
    if status not in (400, 422):
        fail(f"bad colour: expected a validation error, got {status} ({body})")
    print("OK — a too-light colour is rejected.")

    # logo upload — a real PNG
    png_body, png_content_type = multipart_body(
        "logo", "logo.png", make_png(), "image/png"
    )
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
        fail(
            f"logo upload: expected a non-image file to be rejected, got {status} ({body})"
        )
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
        "PATCH",
        f"/businesses/{business_id}/",
        {"tagline": "hijacked"},
        token=other_access,
    )
    if status not in (403, 404):
        fail(
            f"isolation: an unrelated user could update the business, got {status} ({body})"
        )
    print("OK — a second user can neither see nor edit the business.")


def check_sector_change_flow() -> None:
    """Step 21d: changing business_type once stock/sell items exist needs an explicit keep-or-remove
    choice (409 items_decision_needed, then resubmit with items_action) — same shape as counts'
    needs_confirmation. "Remove" must never delete an item with history, or a stock item a surviving
    sell item still uses."""
    _, owner_access, _ = signup_and_login("Sector Change Owner")

    # No items yet -> the type changes straight away, no 409 at all.
    status, body, _ = request(
        "POST",
        "/businesses/",
        {"name": "Empty Sector Biz", "business_type": "cloud_kitchen", "city": "Pune"},
        token=owner_access,
    )
    if status != 201:
        fail(f"sector change flow: business create expected 201, got {status} ({body})")
    empty_business_id = body["id"]
    status, body, _ = request(
        "PATCH",
        f"/businesses/{empty_business_id}/",
        {"business_type": "homestay"},
        token=owner_access,
    )
    if status != 200 or body.get("business_type") != "homestay":
        fail(
            f"sector change flow: type change with no items expected 200, got {status} ({body})"
        )
    print("OK — a business with no items changes type with no sheet.")

    # A business with items: Milk (gets a purchase -> history), Flour (no history of its own, but
    # Cake's main stock item), Sugar (no history, not used by anything surviving). Cake gets a sale
    # (history); Smoothie doesn't.
    status, body, _ = request(
        "POST",
        "/businesses/",
        {"name": "Sector Change Biz", "business_type": "cloud_kitchen", "city": "Pune"},
        token=owner_access,
    )
    if status != 201:
        fail(f"sector change flow: business create expected 201, got {status} ({body})")
    business_id = body["id"]

    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/stock-items/bulk/",
        {
            "items": [
                {"name": "Milk", "unit": "L"},
                {"name": "Flour", "unit": "kg"},
                {"name": "Sugar", "unit": "kg"},
            ]
        },
        token=owner_access,
    )
    if status != 201:
        fail(
            f"sector change flow: stock bulk create expected 201, got {status} ({body})"
        )
    milk_id = next(i["id"] for i in body if i["name"] == "Milk")
    flour_id = next(i["id"] for i in body if i["name"] == "Flour")

    cake_id, _ = _create_dish(
        business_id, owner_access, "Cake", "150.00", [(flour_id, "0.200")]
    )
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/sell-items/bulk/",
        {"items": [{"name": "Smoothie", "selling_price": "60.00"}]},
        token=owner_access,
    )
    if status != 201:
        fail(
            f"sector change flow: sell bulk create expected 201, got {status} ({body})"
        )

    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/purchases/",
        {
            "supplier_name": "Dairy Co",
            "purchase_date_time": _now_iso(),
            "lines": [
                {
                    "stock_item": milk_id,
                    "quantity": "10",
                    "unit_price": "60",
                    "line_total": "600",
                }
            ],
        },
        token=owner_access,
    )
    if status != 201:
        fail(f"sector change flow: purchase expected 201, got {status} ({body})")

    business_date = _now_iso()[:10]
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/sales/",
        {
            "business_date": business_date,
            "lines": [{"sell_item": cake_id, "quantity": "5"}],
        },
        token=owner_access,
    )
    if status != 201:
        fail(f"sector change flow: sale expected 201, got {status} ({body})")
    print(
        "OK — Milk has a purchase, Flour backs Cake, Cake has a sale; Sugar and Smoothie have nothing."
    )

    # Changing the type without items_action -> 409 with every item's name and the total count.
    status, body, _ = request(
        "PATCH",
        f"/businesses/{business_id}/",
        {"business_type": "small_manufacturing"},
        token=owner_access,
    )
    summary = body.get("items_summary", {})
    if (
        status != 409
        or body.get("error", {}).get("code") != "items_decision_needed"
        or sorted(summary.get("stock_items", [])) != ["Flour", "Milk", "Sugar"]
        or sorted(summary.get("sell_items", [])) != ["Cake", "Smoothie"]
        or summary.get("total_count") != 5
    ):
        fail(
            f"sector change flow: expected 409 items_decision_needed with 5 items, got {status} ({body})"
        )
    print(
        "OK — changing the type with items and no decision returns 409 with names and counts."
    )

    before_sector_logs = count_audit_rows("business.sector_change", business_id)

    # "Keep my items" — the type changes, nothing is touched.
    status, body, _ = request(
        "PATCH",
        f"/businesses/{business_id}/",
        {"business_type": "small_manufacturing", "items_action": "keep"},
        token=owner_access,
    )
    if status != 200 or body.get("business_type") != "small_manufacturing":
        fail(
            f"sector change flow: keep expected 200 with the new type, got {status} ({body})"
        )
    status, stock_body, _ = request(
        "GET",
        f"/businesses/{business_id}/stock-items/?include_inactive=1",
        token=owner_access,
    )
    status2, sell_body, _ = request(
        "GET",
        f"/businesses/{business_id}/sell-items/?include_inactive=1",
        token=owner_access,
    )
    if status != 200 or status2 != 200 or len(stock_body) != 3 or len(sell_body) != 2:
        fail(
            f"sector change flow: keep expected all 5 items intact, got {stock_body} / {sell_body}"
        )
    if (
        count_audit_rows("business.sector_change", business_id)
        != before_sector_logs + 1
    ):
        fail(
            "sector change flow: expected one new business.sector_change audit row after keep"
        )
    print("OK — 'Keep my items': type changed, all 5 items intact, audit row logged.")

    # A failing request (an invalid colour alongside the type change) must change nothing at all.
    status, body, _ = request(
        "PATCH",
        f"/businesses/{business_id}/",
        {
            "business_type": "home_business",
            "items_action": "remove",
            "primary_colour": "#F5F0E8",
        },
        token=owner_access,
    )
    status_after, after_body, _ = request("GET", "/me/", token=owner_access)
    after_business = next(b for b in after_body["businesses"] if b["id"] == business_id)
    if (
        status not in (400, 422)
        or after_business.get("business_type") != "small_manufacturing"
    ):
        fail(
            f"sector change flow: a failing request should change nothing, got {status} ({body})"
        )
    print(
        "OK — a request that fails validation rolls back the whole thing, including the type."
    )

    # "Remove them and start fresh" — Sugar and Smoothie (no history, nothing surviving uses them)
    # are gone; Milk (purchase history), Flour (Cake still uses it) and Cake (sale history) remain.
    status, body, _ = request(
        "PATCH",
        f"/businesses/{business_id}/",
        {"business_type": "home_business", "items_action": "remove"},
        token=owner_access,
    )
    summary = body.get("items_summary", {})
    if (
        status != 200
        or body.get("business_type") != "home_business"
        or summary.get("stock_items_removed") != 1
        or summary.get("sell_items_removed") != 1
        or len(summary.get("stock_items_kept", [])) != 2
        or len(summary.get("sell_items_kept", [])) != 1
    ):
        fail(
            f"sector change flow: remove expected 1+1 removed, 2+1 kept, got {status} ({body})"
        )
    kept_stock_names = {row["name"] for row in summary["stock_items_kept"]}
    if kept_stock_names != {"Milk", "Flour"}:
        fail(
            f"sector change flow: expected Milk and Flour kept, got {kept_stock_names}"
        )
    print(
        "OK — 'Remove and start fresh': Sugar and Smoothie gone; Milk, Flour and Cake kept and reported."
    )

    status, stock_body, _ = request(
        "GET",
        f"/businesses/{business_id}/stock-items/?include_inactive=1",
        token=owner_access,
    )
    status2, sell_body, _ = request(
        "GET",
        f"/businesses/{business_id}/sell-items/?include_inactive=1",
        token=owner_access,
    )
    stock_names = {item["name"] for item in stock_body}
    sell_names = {item["name"] for item in sell_body}
    if (
        status != 200
        or status2 != 200
        or stock_names != {"Milk", "Flour"}
        or sell_names != {"Cake"}
    ):
        fail(
            "sector change flow: expected only Milk/Flour and Cake left, got "
            f"{stock_names} / {sell_names}"
        )
    if (
        count_audit_rows("business.sector_change", business_id)
        != before_sector_logs + 2
    ):
        fail(
            "sector change flow: expected 2 new business.sector_change audit rows (409 doesn't log)"
        )
    print(
        "OK — the surviving items match on a fresh read, and every sector change is audit-logged."
    )


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
        fail(
            f"stock bulk create bad row: expected an error for row 2, got {body['row_errors']}"
        )
    status, body, _ = request(
        "GET", f"/businesses/{business_id}/stock-items/", token=owner_access
    )
    if "Salt" in [i["name"] for i in body]:
        fail(
            "stock bulk create bad row: all-or-nothing violated — Salt was saved despite a bad row"
        )
    print(
        "OK — a bad row in a bulk stock save returns per-row errors and saves nothing."
    )

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

    # a dish can't pick a shared stock item as an ingredient
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/sell-items/",
        {
            "name": "Bad Link",
            "selling_price": "10.00",
            "ingredients": [{"stock_item": oil_id, "quantity": "0.010"}],
        },
        token=owner_access,
    )
    if status not in (400, 422):
        fail(
            f"dish with a shared ingredient: expected rejection, got {status} ({body})"
        )
    print("OK — a dish can't pick a shared stock item as an ingredient.")

    # the same shape, minus the shared item, succeeds
    _create_dish(
        business_id, owner_access, "Veg Biryani", "150.00", [(rice_id, "0.300")]
    )
    print("OK — a dish with a valid (non-shared) ingredient is created.")

    # skip is rejected on step 2 (only steps 3-6 are skippable)
    status, body, _ = request(
        "PATCH",
        f"/businesses/{business_id}/onboarding/2/",
        {"status": "skipped"},
        token=owner_access,
    )
    if status not in (400, 422):
        fail(f"onboarding skip step 2: expected rejection, got {status} ({body})")
    print("OK — skipping step 2 (not skippable) is rejected.")

    # skip is allowed on step 3
    status, body, _ = request(
        "PATCH",
        f"/businesses/{business_id}/onboarding/3/",
        {"status": "skipped"},
        token=owner_access,
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
    print(
        "OK — a second user gets 403/404 on both the stock-items and sell-items endpoints."
    )


def check_item_setup_flow() -> None:
    """Step 19: groups (and their case-insensitive canonicalisation) and the input-robustness
    fixes — goes_off needing a real shelf life, whitespace names, comma-decimals. Also Step 22a's
    dish-recipe rules: an ingredient amount needing a real positive value, >=1 ingredient required,
    no duplicate ingredient in one dish."""
    owner_mobile, owner_access, _ = signup_and_login("Item Setup Owner")
    status, body, _ = request(
        "POST",
        "/businesses/",
        {"name": "Item Setup Biz", "business_type": "cloud_kitchen", "city": "Pune"},
        token=owner_access,
    )
    if status != 201:
        fail(f"item setup flow: business create expected 201, got {status} ({body})")
    business_id = body["id"]

    # group canonicalisation: the second row's differently-cased "dairy" folds into the first
    # row's own "Dairy" — one heading, not two.
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/stock-items/bulk/",
        {
            "items": [
                {"name": "Milk", "unit": "L", "group": "Dairy"},
                {"name": "Paneer", "unit": "kg", "group": "dairy"},
            ]
        },
        token=owner_access,
    )
    if status != 201:
        fail(f"item setup flow: group bulk create expected 201, got {status} ({body})")
    milk = next(i for i in body if i["name"] == "Milk")
    paneer = next(i for i in body if i["name"] == "Paneer")
    if milk["group"] != "Dairy" or paneer["group"] != "Dairy":
        fail(
            f"item setup flow: expected both items under 'Dairy', got {milk['group']!r}/{paneer['group']!r}"
        )
    print(
        "OK — a differently-cased group typed later folds into the existing group's own casing."
    )

    # same canonicalisation on PATCH, excluding the item being edited from the match.
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/stock-items/bulk/",
        {"items": [{"name": "Butter", "unit": "kg", "group": "butter stuff"}]},
        token=owner_access,
    )
    butter_id = body[0]["id"]
    status, body, _ = request(
        "PATCH",
        f"/businesses/{business_id}/stock-items/{butter_id}/",
        {"group": "DAIRY"},
        token=owner_access,
    )
    if status != 200 or body.get("group") != "Dairy":
        fail(
            f"item setup flow: PATCH group canonicalisation expected 'Dairy', got {status} ({body})"
        )
    print("OK — editing an item's group canonicalises the same way.")

    # goes_off with no shelf_life_days is rejected, not silently saved as "never expires".
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/stock-items/bulk/",
        {"items": [{"name": "Fresh Cream", "unit": "L", "goes_off": True}]},
        token=owner_access,
    )
    if status not in (400, 422) or not body.get("row_errors"):
        fail(
            f"item setup flow: goes_off with no shelf life expected a row error, got {status} ({body})"
        )
    if "shelf life" not in body["row_errors"][0]["message"].lower():
        fail(
            f"item setup flow: expected a shelf-life message, got {body['row_errors']}"
        )
    print(
        'OK — "goes off" with no shelf life is rejected with a plain message, not silently saved.'
    )

    # a whitespace-only name is rejected the same as a blank one.
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/stock-items/bulk/",
        {"items": [{"name": "   ", "unit": "kg"}]},
        token=owner_access,
    )
    if status not in (400, 422) or not body.get("row_errors"):
        fail(
            f"item setup flow: whitespace-only name expected a row error, got {status} ({body})"
        )
    print("OK — a whitespace-only name is rejected the same as a blank one.")

    # a comma-decimal price doesn't crash or silently truncate — it's a clear 400, not a 500.
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/stock-items/bulk/",
        {"items": [{"name": "Ghee", "unit": "kg", "usual_price": "1,5"}]},
        token=owner_access,
    )
    if status not in (400, 422) or not body.get("row_errors"):
        fail(
            f"item setup flow: comma-decimal price expected a row error, got {status} ({body})"
        )
    print('OK — a comma-decimal price ("1,5") is a clear row error, not a crash.')

    # a dish can't be saved with zero ingredients
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/sell-items/",
        {"name": "Paneer Tikka", "selling_price": "150.00", "ingredients": []},
        token=owner_access,
    )
    if status not in (400, 422):
        fail(f"dish with zero ingredients: expected rejection, got {status} ({body})")
    print("OK — a dish can't be saved with zero ingredients.")

    # an ingredient amount of exactly 0 is rejected, not saved as a silent no-op
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/sell-items/",
        {
            "name": "Paneer Tikka",
            "selling_price": "150.00",
            "ingredients": [{"stock_item": paneer["id"], "quantity": "0"}],
        },
        token=owner_access,
    )
    if status not in (400, 422):
        fail(
            f"dish with a zero ingredient amount: expected rejection, got {status} ({body})"
        )
    print(
        "OK — an ingredient amount of exactly 0 is rejected, not saved as a silent no-op."
    )

    # the same stock item twice in one dish is rejected
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/sell-items/",
        {
            "name": "Paneer Tikka",
            "selling_price": "150.00",
            "ingredients": [
                {"stock_item": paneer["id"], "quantity": "0.100"},
                {"stock_item": paneer["id"], "quantity": "0.050"},
            ],
        },
        token=owner_access,
    )
    if status not in (400, 422):
        fail(
            f"dish with a duplicate ingredient: expected rejection, got {status} ({body})"
        )
    print("OK — the same stock item can't appear twice in one dish.")

    # 150 g of a kg-denominated item is what the client converts and sends before saving — stores
    # and reads back as exactly 0.150, the stock item's own unit (unitConversion.ts does the g->kg
    # conversion client-side; the server only ever sees the converted number).
    paneer_tikka_id, created = _create_dish(
        business_id, owner_access, "Paneer Tikka", "150.00", [(paneer["id"], "0.150")]
    )
    if (
        created["recipe_status"] != "confirmed"
        or created["ingredients"][0]["quantity"] != "0.150"
    ):
        fail(f"dish create: expected confirmed with quantity 0.150, got {created}")
    print(
        "OK — a 150 g amount (converted client-side) stores and reads back as 0.150 kg, confirmed."
    )

    # editing a dish's ingredient set replaces the rows and keeps it confirmed
    status, body, _ = request(
        "PATCH",
        f"/businesses/{business_id}/sell-items/{paneer_tikka_id}/",
        {"ingredients": [{"stock_item": milk["id"], "quantity": "0.050"}]},
        token=owner_access,
    )
    if (
        status != 200
        or body["recipe_status"] != "confirmed"
        or len(body["ingredients"]) != 1
        or body["ingredients"][0]["stock_item"] != milk["id"]
    ):
        fail(
            f"dish edit: expected the ingredient set replaced and still confirmed, got {status} ({body})"
        )
    print(
        "OK — editing a dish's ingredients replaces the set and keeps the recipe confirmed."
    )

    # sell items get their own group namespace, canonicalised the same way, separate from stock.
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/sell-items/bulk/",
        {
            "items": [
                {"name": "Lassi", "selling_price": "40.00", "group": "Starters"},
                {"name": "Chaas", "selling_price": "20.00", "group": "starters"},
            ]
        },
        token=owner_access,
    )
    if status != 201:
        fail(
            f"item setup flow: sell item group bulk create expected 201, got {status} ({body})"
        )
    if body[0]["group"] != "Starters" or body[1]["group"] != "Starters":
        fail(f"item setup flow: expected both sell items under 'Starters', got {body}")
    if body[0]["recipe_status"] != "none" or body[1]["recipe_status"] != "none":
        fail(
            f"item setup flow: expected both bulk-created sell items at recipe_status=none, got {body}"
        )
    print(
        "OK — sell-item groups canonicalise the same way, in their own namespace from stock groups."
    )

    # the no-ingredients bulk endpoint is idempotent on duplicate names with skip_existing — repeating
    # the same call (Lassi/Chaas already exist) quietly drops them instead of erroring the batch.
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/sell-items/bulk/",
        {
            "items": [
                {"name": "Lassi", "selling_price": "40.00"},
                {"name": "Mango Shake", "selling_price": "45.00"},
            ],
            "skip_existing": True,
        },
        token=owner_access,
    )
    if status != 201 or [i["name"] for i in body] != ["Mango Shake"]:
        fail(
            f"sell item bulk skip_existing: expected only Mango Shake created, got {status} ({body})"
        )
    print(
        "OK — sell-items/bulk/'s skip_existing drops already-there names instead of erroring."
    )


def check_starter_pack_flow() -> None:
    """Step 20: the grouped starter-stock catalogue and the bulk endpoint's skip_existing flag the
    new picker relies on to make "tick some, hit Continue" repeatable without erroring."""
    owner_mobile, owner_access, _ = signup_and_login("Starter Pack Owner")
    status, body, _ = request(
        "POST",
        "/businesses/",
        {
            "name": "Starter Pack Biz",
            "business_type": "restaurant_cafe",
            "city": "Pune",
        },
        token=owner_access,
    )
    if status != 201:
        fail(f"starter pack flow: business create expected 201, got {status} ({body})")
    business_id = body["id"]

    status, pack, _ = request(
        "GET", "/starter-packs/restaurant_cafe/", token=owner_access
    )
    if status != 200 or not pack.get("stock_items"):
        fail(
            f"starter pack flow: starter-packs GET expected 200 with items, got {status} ({pack})"
        )
    groups = {item["group"] for item in pack["stock_items"]}
    if len(groups) < 2:
        fail(f"starter pack flow: expected items across multiple groups, got {groups}")
    print("OK — the starter pack is grouped, not a flat list.")

    # Tick two items from two different groups, same shape the picker's Continue sends.
    first_group = next(iter(groups))
    second_group = next(g for g in groups if g != first_group)
    picked = [
        next(item for item in pack["stock_items"] if item["group"] == first_group),
        next(item for item in pack["stock_items"] if item["group"] == second_group),
    ]
    payload = {
        "items": [
            {
                "name": item["name"],
                "unit": item["unit"],
                "group": item["group"],
                "goes_off": item.get("goes_off", False),
                "shelf_life_days": item.get("shelf_life_days"),
            }
            for item in picked
        ],
        "skip_existing": True,
    }
    status, created, _ = request(
        "POST",
        f"/businesses/{business_id}/stock-items/bulk/",
        payload,
        token=owner_access,
    )
    if status != 201 or len(created) != 2:
        fail(
            f"starter pack flow: bulk save expected 201 with 2 items, got {status} ({created})"
        )
    print("OK — ticking items across two groups creates both in one bulk request.")

    status, items, _ = request(
        "GET", f"/businesses/{business_id}/stock-items/", token=owner_access
    )
    seen_groups = {item["group"] for item in items}
    if first_group not in seen_groups or second_group not in seen_groups:
        fail(
            f"starter pack flow: expected both groups in the stock list, got {seen_groups}"
        )
    print("OK — the saved items come back grouped under the same headings.")

    # Repeating the exact same bulk call (as the picker would if Continue is tapped twice, or the
    # owner reopens "Add from starter list") skips the duplicates instead of erroring.
    status, repeat_created, _ = request(
        "POST",
        f"/businesses/{business_id}/stock-items/bulk/",
        payload,
        token=owner_access,
    )
    if status != 201 or repeat_created != []:
        fail(
            f"starter pack flow: repeat bulk with skip_existing expected 201 with nothing new, "
            f"got {status} ({repeat_created})"
        )
    status, items_after, _ = request(
        "GET", f"/businesses/{business_id}/stock-items/", token=owner_access
    )
    if len(items_after) != len(items):
        fail(
            f"starter pack flow: repeat bulk created duplicates — had {len(items)}, "
            f"now {len(items_after)}"
        )
    print(
        "OK — repeating the same bulk save with skip_existing is a no-op, not a duplicate."
    )

    # Without skip_existing, the same repeat is still a clear row error — existing callers (the
    # inline add-your-own) keep their original behaviour.
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/stock-items/bulk/",
        {"items": payload["items"]},
        token=owner_access,
    )
    if status not in (400, 422) or not body.get("row_errors"):
        fail(
            f"starter pack flow: repeat without skip_existing expected a row error, got {status} ({body})"
        )
    print(
        "OK — without skip_existing, a duplicate name is still a row error as before."
    )


def check_low_stock_flow() -> None:
    """Step 41b1b3a (docs/BASES_PLAN.md sec 8.3): a high-turnover perishable item (category default
    1 day of cover) flags low_stock while a low-turnover dry-staples item (7 days) at the same
    counted quantity does not; checking the alert once hides it, a repeat check on the same day is
    rejected (no duplicate); a Manager can set thresholds but not rename the item on the same PATCH,
    a Helper can't reach the item at all, and a Head chef sees the alert and the low-stock list
    (quantities only, no money) but can't set thresholds."""
    owner_mobile, owner_access, _ = signup_and_login("Low Stock Owner")
    status, body, _ = request(
        "POST",
        "/businesses/",
        {"name": "Low Stock Test Biz", "business_type": "cloud_kitchen", "city": "Pune"},
        token=owner_access,
    )
    if status != 201:
        fail(f"low stock flow: business create expected 201, got {status} ({body})")
    business_id = body["id"]

    _, manager_access, _ = _add_team_member(business_id, owner_access, "Low Stock Manager", "manager")
    _, head_chef_access, _ = _add_team_member(business_id, owner_access, "Low Stock Head Chef", "head_chef")
    _, helper_access, _ = _add_team_member(business_id, owner_access, "Low Stock Helper", "helper")

    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/stock-items/bulk/",
        {
            "items": [
                {"name": "Milk", "unit": "L", "goes_off": True, "shelf_life_days": 2, "usual_price": "10"},
                {"name": "Rice", "unit": "kg"},
            ]
        },
        token=owner_access,
    )
    if status != 201:
        fail(f"low stock flow: stock bulk create expected 201, got {status} ({body})")
    milk_id = next(i["id"] for i in body if i["name"] == "Milk")
    rice_id = next(i["id"] for i in body if i["name"] == "Rice")
    if next(i["low_stock_category"] for i in body if i["name"] == "Milk") != "perishable":
        fail("low stock flow: expected Milk (goes_off) to default to the perishable category")
    if next(i["low_stock_category"] for i in body if i["name"] == "Rice") != "dry_staples":
        fail("low stock flow: expected Rice (not goes_off) to default to the dry_staples category")
    print("OK — a goes_off item defaults to the perishable low-stock category, a plain one to dry_staples.")

    # high daily usage relative to its count (perishable, 1 day of cover)
    tea_id, _ = _create_dish(business_id, owner_access, "Tea", "20.00", [(milk_id, "1.000")])
    # low daily usage relative to its count (dry staples, 7 days of cover)
    rice_bowl_id, _ = _create_dish(business_id, owner_access, "Rice Bowl", "60.00", [(rice_id, "0.005")])

    today = _now_iso()[:10]
    for sell_item_id, qty in ((tea_id, 14), (rice_bowl_id, 14)):
        status, body, _ = request(
            "POST",
            f"/businesses/{business_id}/sales/",
            {"business_date": today, "lines": [{"sell_item": sell_item_id, "quantity": qty}]},
            token=owner_access,
        )
        if status != 201:
            fail(f"low stock flow: sale for sell item {sell_item_id} expected 201, got {status} ({body})")

    # same counted quantity for both items — Milk's much higher usage-per-portion makes it the one
    # that's actually running low; Rice's tiny usage-per-portion keeps it comfortably covered even
    # at its smaller (7-day) category default.
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/counts/",
        {
            "type": "opening",
            "lines": [
                {"stock_item": milk_id, "state": "counted", "counted_qty": "0.500"},
                {"stock_item": rice_id, "state": "counted", "counted_qty": "0.500"},
            ],
        },
        token=owner_access,
    )
    if status != 201:
        fail(f"low stock flow: opening count expected 201, got {status} ({body})")

    status, body, _ = request("GET", f"/businesses/{business_id}/alerts/", token=owner_access)
    if status != 200:
        fail(f"low stock flow: alerts list expected 200, got {status} ({body})")
    low_stock_alerts = [a for a in body["results"] if a["type"] == "low_stock"]
    if len(low_stock_alerts) != 1 or "Milk" not in low_stock_alerts[0]["title"]:
        fail(f"low stock flow: expected exactly one low_stock alert, for Milk, got {low_stock_alerts}")
    if "₹" in low_stock_alerts[0]["detail"] or "value" in low_stock_alerts[0]["numbers"]:
        fail(f"low stock flow: the alert text must carry no money, got {low_stock_alerts[0]}")
    milk_key = low_stock_alerts[0]["key"]
    print("OK — the high-turnover perishable item alone trips low_stock; the alert carries no money.")

    # checking it once hides it; checking the same (already-checked) key again is rejected — no
    # duplicate alert appears on a second GET either.
    status, body, _ = request(
        "POST", f"/businesses/{business_id}/alerts/check/", {"key": milk_key}, token=owner_access
    )
    if status != 204:
        fail(f"low stock flow: alert check expected 204, got {status} ({body})")
    status, body, _ = request(
        "POST", f"/businesses/{business_id}/alerts/check/", {"key": milk_key}, token=owner_access
    )
    if status not in (400, 422):
        fail(f"low stock flow: re-checking the same key expected a rejection, got {status} ({body})")
    status, body, _ = request("GET", f"/businesses/{business_id}/alerts/", token=owner_access)
    if any(a["type"] == "low_stock" for a in body["results"]):
        fail("low stock flow: a checked low_stock alert should no longer be open")
    print("OK — checking the alert hides it, and re-checking the same day's key is rejected.")

    # Manager can set thresholds (a narrower permission than stockitems.manage) ...
    status, body, _ = request(
        "PATCH",
        f"/businesses/{business_id}/stock-items/{rice_id}/",
        {"low_stock_fixed_qty": "2.000"},
        token=manager_access,
    )
    if status != 200 or str(body.get("low_stock_fixed_qty")) != "2.000":
        fail(f"low stock flow: manager setting a threshold expected 200, got {status} ({body})")
    # ... but not rename the item in the same request, or any request at all.
    status, body, _ = request(
        "PATCH",
        f"/businesses/{business_id}/stock-items/{rice_id}/",
        {"name": "Renamed Rice"},
        token=manager_access,
    )
    if status not in (403, 404):
        fail(f"low stock flow: manager renaming an item expected 403/404, got {status} ({body})")
    print("OK — a Manager can set thresholds but can't rename the item.")

    # a Helper can't reach the stock item at all (no stock.view), so no threshold field either way.
    status, body, _ = request(
        "GET", f"/businesses/{business_id}/stock-items/{rice_id}/", token=helper_access
    )
    if status not in (403, 404):
        fail(f"low stock flow: helper read expected 403/404, got {status} ({body})")
    status, body, _ = request(
        "PATCH",
        f"/businesses/{business_id}/stock-items/{rice_id}/",
        {"low_stock_fixed_qty": "9.000"},
        token=helper_access,
    )
    if status not in (403, 404):
        fail(f"low stock flow: helper setting a threshold expected 403/404, got {status} ({body})")
    print("OK — a Helper can't see or set thresholds.")

    # a Head chef sees alerts (stock.low_stock_view's sibling, alerts.view is not needed — the
    # count_late check above already proves Head chef reaches alerts via its own permission) but
    # can't set thresholds.
    status, body, _ = request(
        "PATCH",
        f"/businesses/{business_id}/stock-items/{rice_id}/",
        {"low_stock_fixed_qty": "9.000"},
        token=head_chef_access,
    )
    if status not in (403, 404):
        fail(f"low stock flow: head chef setting a threshold expected 403/404, got {status} ({body})")
    print("OK — a Head chef sees alerts but can't set thresholds.")

    # low-stock/shopping-list: Owner (money) and Head chef (no money) read the same computed rows.
    status, body, _ = request(
        "GET", f"/businesses/{business_id}/stock/low-stock/", token=owner_access
    )
    if status != 200:
        fail(f"low stock flow: low-stock list (owner) expected 200, got {status} ({body})")
    owner_rice_row = next(r for r in body["results"] if r["stock_item"] == rice_id)
    if "shortfall_value" not in owner_rice_row:
        fail(f"low stock flow: owner's low-stock row should carry shortfall_value, got {owner_rice_row}")

    status, body, _ = request(
        "GET", f"/businesses/{business_id}/stock/low-stock/", token=head_chef_access
    )
    if status != 200:
        fail(f"low stock flow: low-stock list (head chef) expected 200, got {status} ({body})")
    head_chef_rice_row = next(r for r in body["results"] if r["stock_item"] == rice_id)
    if "shortfall_value" in head_chef_rice_row:
        fail(f"low stock flow: head chef's low-stock row must carry no money, got {head_chef_rice_row}")
    if not any(row["name"] == "Rice" for row in body.get("grouped", {}).get("Ungrouped", [])):
        fail(f"low stock flow: expected Rice grouped under 'Ungrouped', got {body.get('grouped')}")
    print("OK — the low-stock/shopping-list endpoint hides shortfall_value from a Head chef.")

    status, body, _ = request(
        "GET", f"/businesses/{business_id}/stock/low-stock/", token=helper_access
    )
    if status not in (403, 404):
        fail(f"low stock flow: helper low-stock list expected 403/404, got {status} ({body})")
    print("OK — a Helper can't reach the low-stock list either.")

    # Step 43b1c2a: estimated_stock_now must subtract an UNCONFIRMED (suggested, not yet reviewed)
    # recipe's usage too, not confirmed-only, and flag (not hide) that it did. There's no API path
    # to recipe_status=unconfirmed yet (Step C2b's guided-ingredients flow isn't built) — same
    # direct-DB-write pattern _ai_sql_write uses elsewhere in this file for states the API can't
    # reach.
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/stock-items/bulk/",
        {"items": [{"name": "Sugar", "unit": "kg"}]},
        token=owner_access,
    )
    if status != 201:
        fail(f"low stock flow: Sugar stock item create expected 201, got {status} ({body})")
    sugar_id = body[0]["id"]
    status, body, _ = request(
        "PATCH",
        f"/businesses/{business_id}/stock-items/{sugar_id}/",
        {"low_stock_fixed_qty": "100.000"},
        token=owner_access,
    )
    if status != 200:
        fail(f"low stock flow: setting Sugar's fixed threshold expected 200, got {status} ({body})")

    dessert_id, _ = _create_dish(business_id, owner_access, "Dessert", "50.00", [(sugar_id, "0.200")])
    _ai_sql_write(
        "UPDATE stock_sellitem SET recipe_status = 'unconfirmed' WHERE id = ?", (dessert_id,)
    )

    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/sales/",
        {"business_date": today, "lines": [{"sell_item": dessert_id, "quantity": 10}]},
        token=owner_access,
    )
    if status != 201:
        fail(f"low stock flow: dessert sale expected 201, got {status} ({body})")

    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/counts/",
        {
            "type": "closing",
            "lines": [
                {"stock_item": sugar_id, "state": "counted", "counted_qty": "10.000"},
                {"stock_item": milk_id, "state": "skipped"},
                {"stock_item": rice_id, "state": "skipped"},
            ],
        },
        token=owner_access,
    )
    if status != 201:
        fail(f"low stock flow: Sugar closing count expected 201, got {status} ({body})")

    status, body, _ = request(
        "GET", f"/businesses/{business_id}/stock/low-stock/", token=owner_access
    )
    if status != 200:
        fail(f"low stock flow: low-stock list expected 200, got {status} ({body})")
    sugar_row = next((r for r in body["results"] if r["stock_item"] == sugar_id), None)
    if sugar_row is None:
        fail(f"low stock flow: expected Sugar below its 100kg fixed threshold, got {body['results']}")
    # 10 counted - (10 sold x 0.200 kg/portion from the UNCONFIRMED dish) = 8.000 kg. Ignoring the
    # unconfirmed recipe (the pre-fix behaviour) would have left the estimate at 10.000 instead.
    if float(sugar_row["estimated_stock_now"]) != 8 or not sugar_row["partly_unconfirmed"]:
        fail(
            "low stock flow: estimated_stock_now must subtract an unconfirmed recipe's usage too, "
            f"and flag partly_unconfirmed rather than hide it, got {sugar_row}"
        )
    print(
        "OK — estimated_stock_now subtracts an unconfirmed (suggested) recipe's usage too, and "
        "flags partly_unconfirmed rather than hiding it."
    )


def check_bases_flow() -> None:
    """Step 42b1c1 (docs/BASES_PLAN.md secs 1-2, 5, 8.4): base CRUD, linking a base to a dish
    alongside a direct ingredient, and the Chicken Curry example end to end through a real count —
    proves stock/base_expansion.py's one-level expansion through the real API, not just gap.py's
    own unit tests. Also: a base used by 3 dishes at different grams each, deleting an in-use base
    is refused then succeeds with confirm_unlink (unlinking it everywhere), and a Manager/Helper
    get 403 on every bases endpoint (Owner-only, same as sellitems.manage)."""
    owner_mobile, owner_access, _ = signup_and_login("Bases Owner")
    status, body, _ = request(
        "POST",
        "/businesses/",
        {"name": "Bases Test Biz", "business_type": "cloud_kitchen", "city": "Pune"},
        token=owner_access,
    )
    if status != 201:
        fail(f"bases flow: business create expected 201, got {status} ({body})")
    business_id = body["id"]
    _, manager_access, _ = _add_team_member(business_id, owner_access, "Bases Manager", "manager")
    _, helper_access, _ = _add_team_member(business_id, owner_access, "Bases Helper", "helper")

    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/stock-items/bulk/",
        {
            "items": [
                {"name": "Chicken", "unit": "kg"},
                {"name": "Onion", "unit": "kg"},
                {"name": "Tomato", "unit": "kg"},
                {"name": "Oil", "unit": "L"},
                {"name": "Cashew", "unit": "kg"},
                {"name": "Spices", "unit": "kg"},
            ]
        },
        token=owner_access,
    )
    if status != 201:
        fail(f"bases flow: stock bulk create expected 201, got {status} ({body})")
    ids = {i["name"]: i["id"] for i in body}
    for name in ("Chicken", "Onion", "Tomato", "Cashew", "Spices"):
        if next(i["unit"] for i in body if i["name"] == name) != "g":
            fail(f"bases flow: expected {name} (entered in kg) to store its base unit g")
    if next(i["unit"] for i in body if i["name"] == "Oil") != "ml":
        fail("bases flow: expected Oil (entered in L) to store its base unit ml")
    print("OK — stock items entered in kg/L store their base units (g/ml).")

    # a Helper/Manager can't reach any bases endpoint (Owner-only, same as sellitems.manage)
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/bases/",
        {"name": "x", "unit_family": "weight", "ingredients": [{"stock_item": ids["Onion"], "quantity": "1"}]},
        token=manager_access,
    )
    if status not in (403, 404):
        fail(f"bases flow: manager create base expected 403/404, got {status} ({body})")
    status, body, _ = request("GET", f"/businesses/{business_id}/bases/", token=helper_access)
    if status not in (403, 404):
        fail(f"bases flow: helper list bases expected 403/404, got {status} ({body})")
    print("OK — a Manager/Helper can't reach the bases endpoints (Owner-only).")

    # the Chicken Curry base: 1,000 g batch (default yield) — onion 450, tomato 400, oil 90 ml,
    # cashew 40, spices 20
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/bases/",
        {
            "name": "Onion-tomato masala",
            "unit_family": "weight",
            "ingredients": [
                {"stock_item": ids["Onion"], "quantity": "450"},
                {"stock_item": ids["Tomato"], "quantity": "400"},
                {"stock_item": ids["Oil"], "quantity": "90"},
                {"stock_item": ids["Cashew"], "quantity": "40"},
                {"stock_item": ids["Spices"], "quantity": "20"},
            ],
        },
        token=owner_access,
    )
    if status != 201:
        fail(f"bases flow: create base expected 201, got {status} ({body})")
    base_id = body["id"]
    if body["batch_yield_qty"] != "1000.000" or body["unit"] != "g" or len(body["ingredients"]) != 5:
        fail(f"bases flow: unexpected base shape, got {body}")
    print("OK — the Chicken Curry base (1,000 g batch, 5 ingredients) is created.")

    # duplicate name rejected, case-insensitive
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/bases/",
        {
            "name": "onion-tomato masala",
            "unit_family": "weight",
            "ingredients": [{"stock_item": ids["Onion"], "quantity": "1"}],
        },
        token=owner_access,
    )
    if status not in (400, 422):
        fail(f"bases flow: duplicate base name expected rejection, got {status} ({body})")
    print("OK — a duplicate base name (case-insensitive) is rejected.")

    # Chicken Curry dish: chicken 180 g direct + 200 g of the base, per portion
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/sell-items/",
        {
            "name": "Chicken Curry",
            "selling_price": "220.00",
            "ingredients": [{"stock_item": ids["Chicken"], "quantity": "180"}],
            "bases": [{"base": base_id, "quantity": "200"}],
        },
        token=owner_access,
    )
    if status != 201:
        fail(f"bases flow: create dish with a base expected 201, got {status} ({body})")
    curry_id = body["id"]
    if body["recipe_status"] != "confirmed" or len(body["bases"]) != 1 or body["bases"][0]["base"] != base_id:
        fail(f"bases flow: unexpected dish shape, got {body}")
    print("OK — a dish can mix a direct ingredient with a base, and lands confirmed.")

    # a dish with only a base (no direct ingredients) is also valid — "at least one line" rule
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/sell-items/",
        {
            "name": "Masala Rice",
            "selling_price": "120.00",
            "bases": [{"base": base_id, "quantity": "100"}],
        },
        token=owner_access,
    )
    if status != 201 or body["recipe_status"] != "confirmed":
        fail(f"bases flow: dish with only a base expected 201/confirmed, got {status} ({body})")
    masala_rice_id = body["id"]
    print("OK — a dish with only a base (no direct ingredients) is still valid.")

    # a third dish uses the same base at a different gram amount
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/sell-items/",
        {
            "name": "Masala Wrap",
            "selling_price": "80.00",
            "bases": [{"base": base_id, "quantity": "50"}],
        },
        token=owner_access,
    )
    if status != 201:
        fail(f"bases flow: third dish using the base expected 201, got {status} ({body})")
    status, body, _ = request(
        "GET", f"/businesses/{business_id}/bases/{base_id}/", token=owner_access
    )
    if status != 200 or len(body["used_in"]) != 3:
        fail(f"bases flow: expected the base used by 3 dishes, got {status} ({body})")
    grams_used = sorted(Decimal(link["quantity"]) for link in body["used_in"])
    if grams_used != [Decimal("50.000"), Decimal("100.000"), Decimal("200.000")]:
        fail(f"bases flow: expected 3 different gram amounts, got {grams_used}")
    print("OK — a base used by 3 dishes at 3 different gram amounts shows all 3 in 'used_in'.")

    # end to end: 10 Chicken Curry portions sold -> onion 900 g, tomato 800 g, oil 180 ml,
    # cashew 80 g, spices 40 g expected (the one-level base expansion), proven via a real count.
    # Masala Rice/Wrap need no stock items of their own (base-only dishes) — only Onion's gap is
    # checked below, so the other 5 stock items are simply skipped in both counts.
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/counts/",
        {
            "type": "opening",
            "lines": [
                {"stock_item": ids["Onion"], "state": "counted", "counted_qty": "1000"},
                {"stock_item": ids["Chicken"], "state": "skipped"},
                {"stock_item": ids["Tomato"], "state": "skipped"},
                {"stock_item": ids["Oil"], "state": "skipped"},
                {"stock_item": ids["Cashew"], "state": "skipped"},
                {"stock_item": ids["Spices"], "state": "skipped"},
            ],
        },
        token=owner_access,
    )
    if status != 201:
        fail(f"bases flow: opening count expected 201, got {status} ({body})")
    business_date = body["business_date"]

    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/sales/",
        {"business_date": business_date, "lines": [{"sell_item": curry_id, "quantity": 10}]},
        token=owner_access,
    )
    if status != 201:
        fail(f"bases flow: 10 Chicken Curry sale expected 201, got {status} ({body})")

    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/counts/",
        {
            "type": "closing",
            "lines": [
                {"stock_item": ids["Onion"], "state": "counted", "counted_qty": "100"},
                {"stock_item": ids["Chicken"], "state": "skipped"},
                {"stock_item": ids["Tomato"], "state": "skipped"},
                {"stock_item": ids["Oil"], "state": "skipped"},
                {"stock_item": ids["Cashew"], "state": "skipped"},
                {"stock_item": ids["Spices"], "state": "skipped"},
            ],
        },
        token=owner_access,
    )
    if status != 201:
        fail(f"bases flow: closing count expected 201, got {status} ({body})")
    closing_id = body["id"]

    status, body, _ = request(
        "GET", f"/businesses/{business_id}/counts/{closing_id}/", token=owner_access
    )
    if status != 200:
        fail(f"bases flow: count detail expected 200, got {status} ({body})")
    onion_line = next(line for line in body["lines"] if line["stock_item"] == ids["Onion"])
    if Decimal(onion_line["expected_used"]) != Decimal("900.000"):
        fail(
            f"bases flow: expected Onion's expected_used via the base to be 900 g "
            f"(10 curries x 200 g base x 450/1000), got {onion_line['expected_used']}"
        )
    if onion_line["gap_status"] != "ok" or onion_line["flagged"]:
        fail(f"bases flow: expected Onion's gap to match exactly (not flagged), got {onion_line}")
    print(
        "OK — 10 Chicken Curry sales expand through the base to Onion's expected 900 g used, "
        "gap matches exactly."
    )

    # editing a dish's bases via PATCH (full replace, like ingredients)
    status, body, _ = request(
        "PATCH",
        f"/businesses/{business_id}/sell-items/{masala_rice_id}/",
        {"bases": [{"base": base_id, "quantity": "150"}]},
        token=owner_access,
    )
    if status != 200 or body["bases"][0]["quantity"] != "150.000":
        fail(f"bases flow: editing a dish's bases expected 200 with 150.000, got {status} ({body})")
    print("OK — editing a dish's bases (PATCH) fully replaces the row, like ingredients.")

    # deleting a base in use is refused, naming the dishes, then succeeds with confirm_unlink
    status, body, _ = request(
        "DELETE", f"/businesses/{business_id}/bases/{base_id}/", token=owner_access
    )
    if status != 409 or "Chicken Curry" not in ", ".join(body.get("used_in_names", [])):
        fail(f"bases flow: deleting an in-use base expected 409 naming dishes, got {status} ({body})")
    status, body, _ = request(
        "DELETE",
        f"/businesses/{business_id}/bases/{base_id}/",
        {"confirm_unlink": True},
        token=owner_access,
    )
    if status != 204:
        fail(f"bases flow: deleting with confirm_unlink expected 204, got {status} ({body})")
    status, body, _ = request(
        "GET", f"/businesses/{business_id}/sell-items/?include_inactive=1", token=owner_access
    )
    masala_rice = next(i for i in body if i["id"] == masala_rice_id)
    if masala_rice["bases"]:
        fail(f"bases flow: expected Masala Rice unlinked from the deleted base, got {masala_rice}")
    print("OK — deleting an in-use base is refused, then unlinks it from every dish with confirm_unlink.")


def check_sector_units_flow() -> None:
    """Sector-aware copy/units step: a non-food business type can save a stock item in one of the
    new unit choices (not just kg/g/L/ml/piece/pack), and the starter pack for a non-food type
    carries no food-flavoured grouping (the client-side guard is scripts/check_sector_copy.py; this
    just proves the unit actually round-trips through the real API)."""
    owner_mobile, owner_access, _ = signup_and_login("Sector Units Owner")
    status, body, _ = request(
        "POST",
        "/businesses/",
        {"name": "Steel Works", "business_type": "small_manufacturing", "city": "Pune"},
        token=owner_access,
    )
    if status != 201:
        fail(f"sector units flow: business create expected 201, got {status} ({body})")
    business_id = body["id"]

    status, created, _ = request(
        "POST",
        f"/businesses/{business_id}/stock-items/bulk/",
        {"items": [{"name": "Steel sheet", "unit": "sheet", "group": "Raw materials"}]},
        token=owner_access,
    )
    if status != 201 or created[0]["unit"] != "sheet":
        fail(
            f"sector units flow: bulk save of a 'sheet' unit expected 201, got {status} ({created})"
        )
    print("OK — a small_manufacturing stock item saves with the new 'sheet' unit.")

    status, items, _ = request(
        "GET", f"/businesses/{business_id}/stock-items/", token=owner_access
    )
    saved = next((item for item in items if item["name"] == "Steel sheet"), None)
    if saved is None or saved["unit"] != "sheet" or saved["group"] != "Raw materials":
        fail(
            f"sector units flow: expected 'Steel sheet' saved as sheet/Raw materials, got {saved}"
        )
    print(
        "OK — it comes back from GET with the same unit and group, not silently dropped."
    )

    status, pack, _ = request("GET", "/starter-packs/homestay/", token=owner_access)
    if status != 200:
        fail(
            f"sector units flow: homestay starter-packs GET expected 200, got {status} ({pack})"
        )
    groups = {item["group"] for item in pack.get("stock_items", [])}
    if any("kitchen" in group.lower() for group in groups):
        fail(
            f"sector units flow: homestay starter pack still has a 'kitchen' group — {groups}"
        )
    print("OK — the homestay starter pack has no 'kitchen' wording left in its groups.")


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
                "mobile": random.choice("6789")
                + "".join(random.choices("0123456789", k=9)),
                "role": "helper",
                "secret": weak_pin,
            },
            token=owner_access,
        )
        if status not in (400, 422):
            fail(
                f"weak PIN rejected: expected a validation error, got {status} ({body})"
            )
    print("OK — weak PINs (1111, 1234) are rejected.")

    # add a Helper with a valid PIN
    helper_mobile = random.choice("6789") + "".join(random.choices("0123456789", k=9))
    helper_pin = "7392"
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/team/",
        {
            "name": "Helper One",
            "mobile": helper_mobile,
            "role": "helper",
            "secret": helper_pin,
        },
        token=owner_access,
    )
    if status != 201:
        fail(f"add helper: expected 201, got {status} ({body})")
    if body.get("mobile") == helper_mobile or not body.get("mobile", "").endswith(
        helper_mobile[-4:]
    ):
        fail(
            f"team member mobile should be masked except the last 4 digits, got {body.get('mobile')}"
        )
    print(
        f"OK — added a Helper for {owner_mobile} with a PIN (mobile returned masked)."
    )

    # that person can log in with the PIN
    status, body, _ = request(
        "POST", "/auth/login/", {"mobile": helper_mobile, "secret": helper_pin}
    )
    if status != 200 or "access" not in body:
        fail(f"helper login with PIN: expected HTTP 200, got {status} ({body})")
    helper_access = body["access"]
    print("OK — the Helper can log in with their PIN.")

    # a Helper gets 403 on the team and settings endpoints
    status, body, _ = request(
        "GET", f"/businesses/{business_id}/team/", token=helper_access
    )
    if status != 403:
        fail(f"helper team access: expected 403, got {status} ({body})")
    status, body, _ = request(
        "GET", f"/businesses/{business_id}/settings/", token=helper_access
    )
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
        {
            "name": "Pre Existing",
            "business_name": "Pre Existing's Business",
            "mobile": pre_mobile,
            "password": pre_password,
            "consent": True,
        },
    )
    if status != 201:
        fail(f"pre-existing signup: expected 201, got {status} ({body})")
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/team/",
        {
            "name": "ignored",
            "mobile": pre_mobile,
            "role": "manager",
            "secret": "TotallyDifferent999!",
        },
        token=owner_access,
    )
    if status != 201:
        fail(f"add existing user to team: expected 201, got {status} ({body})")
    status, body, _ = request(
        "POST", "/auth/login/", {"mobile": pre_mobile, "secret": pre_password}
    )
    if status != 200:
        fail(
            f"existing user's original credential should still work, got {status} ({body})"
        )
    status, body, _ = request(
        "POST", "/auth/login/", {"mobile": pre_mobile, "secret": "TotallyDifferent999!"}
    )
    if status == 200:
        fail(
            "existing user's credential should not have been changed by the team-add secret"
        )
    print(
        "OK — adding an existing mobile to the team only adds Access; their credential is untouched."
    )

    # settings PATCH with an out-of-range value is rejected
    status, body, _ = request(
        "PATCH",
        f"/businesses/{business_id}/settings/",
        {"target_cost_pct": "150"},
        token=owner_access,
    )
    if status not in (400, 422):
        fail(
            f"settings out-of-range: expected a validation error, got {status} ({body})"
        )
    print("OK — an out-of-range settings value is rejected.")

    # an unrelated user (no access at all) gets 403/404
    _, stranger_access, _ = signup_and_login("Team Stranger")
    status, body, _ = request(
        "GET", f"/businesses/{business_id}/team/", token=stranger_access
    )
    if status not in (403, 404):
        fail(f"stranger team access: expected 403/404, got {status} ({body})")
    status, body, _ = request(
        "GET", f"/businesses/{business_id}/settings/", token=stranger_access
    )
    if status not in (403, 404):
        fail(f"stranger settings access: expected 403/404, got {status} ({body})")
    print("OK — an unrelated user gets 403/404 on the team and settings endpoints.")

    # the complete endpoint only sets onboarding_completed_at once the rules are actually met
    status, body, _ = request(
        "POST", f"/businesses/{business_id}/onboarding/complete/", token=owner_access
    )
    if status != 200 or body.get("onboarding_completed_at") is not None:
        fail(
            f"onboarding complete (too early): expected no completed_at, got {status} ({body})"
        )

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
    print(
        "OK — the complete endpoint sets onboarding_completed_at once steps 1-2 are done and 3-6 are done or skipped."
    )


def check_team_reset_flow() -> None:
    _, owner_access, _ = signup_and_login("Reset Owner")
    status, body, _ = request(
        "POST",
        "/businesses/",
        {"name": "Reset Test Biz", "business_type": "cloud_kitchen", "city": "Pune"},
        token=owner_access,
    )
    if status != 201:
        fail(f"team reset flow: business create expected 201, got {status} ({body})")
    business_id = body["id"]

    status, body, _ = request(
        "GET", f"/businesses/{business_id}/team/", token=owner_access
    )
    if status != 200:
        fail(f"team reset flow: list expected 200, got {status} ({body})")
    owner_access_id = next(row["id"] for row in body if row["role"] == "owner")

    # a Helper with a PIN
    helper_mobile = random.choice("6789") + "".join(random.choices("0123456789", k=9))
    helper_pin = "7392"
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/team/",
        {
            "name": "Reset Helper",
            "mobile": helper_mobile,
            "role": "helper",
            "secret": helper_pin,
        },
        token=owner_access,
    )
    if status != 201:
        fail(f"team reset flow: add helper expected 201, got {status} ({body})")
    helper_access_id = body["id"]

    status, body, _ = request(
        "POST", "/auth/login/", {"mobile": helper_mobile, "secret": helper_pin}
    )
    if status != 200:
        fail(f"team reset flow: helper login expected 200, got {status} ({body})")
    helper_refresh = body["refresh"]

    # weak PIN rejected on reset
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/team/{helper_access_id}/reset-secret/",
        {"secret": "1111"},
        token=owner_access,
    )
    if status not in (400, 422):
        fail(
            f"team reset flow: weak PIN reset expected a validation error, got {status} ({body})"
        )
    print("OK — a weak PIN is rejected on reset.")

    # reset the Helper's PIN
    new_pin = "5810"
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/team/{helper_access_id}/reset-secret/",
        {"secret": new_pin},
        token=owner_access,
    )
    if status != 200:
        fail(f"team reset flow: reset PIN expected 200, got {status} ({body})")

    status, body, _ = request(
        "POST", "/auth/login/", {"mobile": helper_mobile, "secret": helper_pin}
    )
    if status == 200:
        fail("team reset flow: old PIN should no longer work after reset")
    status, body, _ = request(
        "POST", "/auth/login/", {"mobile": helper_mobile, "secret": new_pin}
    )
    if status != 200:
        fail(f"team reset flow: new PIN should work, got {status} ({body})")
    status, body, _ = request("POST", "/auth/refresh/", {"refresh": helper_refresh})
    if status == 200:
        fail(
            "team reset flow: the Helper's old refresh token should be rejected after reset"
        )
    print(
        "OK — resetting a PIN invalidates the old PIN and the old refresh token, and the new PIN works."
    )

    # Helper <-> Head chef role changes freely, no secret needed
    status, body, _ = request(
        "PATCH",
        f"/businesses/{business_id}/team/{helper_access_id}/",
        {"role": "head_chef"},
        token=owner_access,
    )
    if status != 200 or body.get("role") != "head_chef":
        fail(
            f"team reset flow: Helper -> Head chef expected 200, got {status} ({body})"
        )
    print("OK — changing Helper to Head chef needs no secret.")

    # crossing into Manager without a secret is rejected
    status, body, _ = request(
        "PATCH",
        f"/businesses/{business_id}/team/{helper_access_id}/",
        {"role": "manager"},
        token=owner_access,
    )
    if status not in (400, 422):
        fail(
            f"team reset flow: role change to Manager without secret expected a validation error, got {status} ({body})"
        )

    # ... but succeeds with a password
    manager_password = f"Kharcha{random.randint(1000, 9999)}!"
    status, body, _ = request(
        "PATCH",
        f"/businesses/{business_id}/team/{helper_access_id}/",
        {"role": "manager", "secret": manager_password},
        token=owner_access,
    )
    if status != 200 or body.get("role") != "manager":
        fail(
            f"team reset flow: role change to Manager with a password expected 200, got {status} ({body})"
        )
    print(
        "OK — changing to Manager without a secret is rejected, and succeeds once one is given."
    )

    # remove the member: their login to this business fails, but the user account still exists
    status, body, _ = request(
        "DELETE",
        f"/businesses/{business_id}/team/{helper_access_id}/",
        token=owner_access,
    )
    if status != 204:
        fail(f"team reset flow: remove member expected 204, got {status} ({body})")
    status, body, _ = request(
        "POST", "/auth/login/", {"mobile": helper_mobile, "secret": manager_password}
    )
    if status != 200:
        fail(
            f"team reset flow: removed member's account should still exist, got {status} ({body})"
        )
    removed_access = body["access"]
    status, body, _ = request(
        "GET", f"/businesses/{business_id}/team/", token=removed_access
    )
    if status not in (403, 404):
        fail(
            f"team reset flow: removed member's access to the business expected 403/404, got {status} ({body})"
        )
    print(
        "OK — removing a member drops their access to this business, but their account still exists."
    )

    # the Owner cannot reset or remove their own Owner access
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/team/{owner_access_id}/reset-secret/",
        {"secret": "whatever"},
        token=owner_access,
    )
    if status not in (400, 422):
        fail(
            f"team reset flow: Owner reset-self expected a validation error, got {status} ({body})"
        )
    status, body, _ = request(
        "DELETE",
        f"/businesses/{business_id}/team/{owner_access_id}/",
        token=owner_access,
    )
    if status not in (400, 422):
        fail(
            f"team reset flow: Owner remove-self expected a validation error, got {status} ({body})"
        )
    print("OK — the Owner cannot reset or remove their own Owner access.")

    # a Manager gets 403 on reset, role change, and remove
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/team/",
        {
            "name": "Reset Head Chef",
            "mobile": random.choice("6789")
            + "".join(random.choices("0123456789", k=9)),
            "role": "head_chef",
            "secret": "6204",
        },
        token=owner_access,
    )
    if status != 201:
        fail(
            f"team reset flow: add second head chef expected 201, got {status} ({body})"
        )
    target_access_id = body["id"]

    manager_mobile = random.choice("6789") + "".join(random.choices("0123456789", k=9))
    manager_password2 = f"Kharcha{random.randint(1000, 9999)}!"
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/team/",
        {
            "name": "Reset Manager",
            "mobile": manager_mobile,
            "role": "manager",
            "secret": manager_password2,
        },
        token=owner_access,
    )
    if status != 201:
        fail(f"team reset flow: add manager expected 201, got {status} ({body})")
    status, body, _ = request(
        "POST", "/auth/login/", {"mobile": manager_mobile, "secret": manager_password2}
    )
    if status != 200:
        fail(f"team reset flow: manager login expected 200, got {status} ({body})")
    manager_access = body["access"]

    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/team/{target_access_id}/reset-secret/",
        {"secret": "9183"},
        token=manager_access,
    )
    if status != 403:
        fail(
            f"team reset flow: manager reset-secret expected 403, got {status} ({body})"
        )
    status, body, _ = request(
        "PATCH",
        f"/businesses/{business_id}/team/{target_access_id}/",
        {"role": "helper"},
        token=manager_access,
    )
    if status != 403:
        fail(
            f"team reset flow: manager role change expected 403, got {status} ({body})"
        )
    status, body, _ = request(
        "DELETE",
        f"/businesses/{business_id}/team/{target_access_id}/",
        token=manager_access,
    )
    if status != 403:
        fail(f"team reset flow: manager remove expected 403, got {status} ({body})")
    print("OK — a Manager gets 403 on reset, role change, and remove.")

    # but a Manager can still see the team list (team.view)
    status, body, _ = request(
        "GET", f"/businesses/{business_id}/team/", token=manager_access
    )
    if status != 200:
        fail(f"team reset flow: manager list view expected 200, got {status} ({body})")
    print("OK — a Manager can still view the team list.")


def check_auth_flow() -> None:
    mobile = random.choice("6789") + "".join(random.choices("0123456789", k=9))
    name = "Smoke Test"
    business_name = "Smoke Test Biz"
    password = f"Kharcha{random.randint(1000, 9999)}!"

    # signup
    status, body, headers = request(
        "POST",
        "/auth/signup/",
        {
            "name": name,
            "business_name": business_name,
            "mobile": mobile,
            "password": password,
            "consent": True,
        },
    )
    if status != 201:
        fail(f"signup: expected HTTP 201, got {status} ({body})")
    if body.get("mobile") != mobile or body.get("name") != name:
        fail(f"signup: unexpected response body {body}")
    if headers.get("Access-Control-Allow-Origin") != ORIGIN:
        fail("signup: missing or wrong CORS header")
    print(f"OK — signup created {mobile}.")

    # Step F2: business_name is required — signup is the only place it's ever asked for.
    missing_name_mobile = random.choice("6789") + "".join(random.choices("0123456789", k=9))
    status, body, _ = request(
        "POST",
        "/auth/signup/",
        {
            "name": "No Biz Name",
            "mobile": missing_name_mobile,
            "password": password,
            "consent": True,
        },
    )
    if status != 400 or "business_name" not in body.get("error", {}).get("message", ""):
        fail(f"signup without business_name: expected 400, got {status} ({body})")
    print("OK — signup without a business name is rejected.")

    # duplicate signup
    status, body, _ = request(
        "POST",
        "/auth/signup/",
        {
            "name": name,
            "business_name": business_name,
            "mobile": mobile,
            "password": password,
            "consent": True,
        },
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
        {
            "name": "Not a bot",
            "business_name": "Not a Bot's Business",
            "mobile": honeypot_mobile,
            "password": password,
            "consent": True,
        },
    )
    if status != 201:
        fail(
            f"honeypot signup created a real row: follow-up signup got {status} ({body})"
        )
    print(
        "OK — honeypot signup created nothing (confirmed via a follow-up real signup)."
    )

    # wrong password
    status, body, _ = request(
        "POST", "/auth/login/", {"mobile": mobile, "secret": "wrong-password"}
    )
    expected_message = "Mobile number or password is not right."
    if status != 401 or body.get("error", {}).get("message") != expected_message:
        fail(
            f"wrong password: expected 401 with generic message, got {status} ({body})"
        )
    print("OK — wrong password gives the generic error message.")

    # real login
    status, body, headers = request(
        "POST", "/auth/login/", {"mobile": mobile, "secret": password}
    )
    if status != 200 or "access" not in body or "refresh" not in body:
        fail(f"login: expected HTTP 200 with access+refresh, got {status} ({body})")
    if headers.get("Access-Control-Allow-Origin") != ORIGIN:
        fail("login: missing or wrong CORS header")
    access, refresh = body["access"], body["refresh"]
    print("OK — login returned access and refresh tokens.")

    # /me — Step F2: signup already created the one business, named from business_name
    status, body, _ = request("GET", "/me/", token=access)
    if status != 200:
        fail(f"/me: expected HTTP 200, got {status} ({body})")
    me_businesses = body.get("businesses", [])
    if (
        body.get("user", {}).get("mobile") != mobile
        or len(me_businesses) != 1
        or me_businesses[0].get("name") != business_name
    ):
        fail(f"/me: unexpected response body {body}")
    print("OK — /me returned the signed-in user with the one business created at signup.")

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
            "purchase_date_time": _now_iso(),
            "lines": [
                {
                    "stock_item": milk_id,
                    "quantity": "20",
                    "unit_price": "64",
                    "line_total": "1280",
                },
                {
                    "stock_item": flour_id,
                    "quantity": "15",
                    "unit_price": "48",
                    "line_total": "720",
                },
            ],
        },
        token=owner_access,
    )
    if status != 201 or len(body.get("lines", [])) != 2:
        fail(f"purchase create: expected 201 with 2 lines, got {status} ({body})")
    purchase_id = body["id"]
    if body.get("total_amount") != "2000.00":
        fail(f"purchase create: expected total 2000.00, got {body.get('total_amount')}")
    print(
        f"OK — purchase {purchase_id} created with 2 lines, total {body['total_amount']}."
    )

    # list shows it and the summary adds up
    status, body, _ = request(
        "GET", f"/businesses/{business_id}/purchases/", token=owner_access
    )
    if status != 200:
        fail(f"purchase list: expected 200, got {status} ({body})")
    ids = [p["id"] for p in body.get("results", [])]
    if purchase_id not in ids:
        fail(f"purchase list: expected purchase {purchase_id} in results, got {ids}")
    summary = body.get("summary", {})
    if (
        float(summary.get("bought_today", 0)) < 2000
        or float(summary.get("last_7_days", 0)) < 2000
    ):
        fail(f"purchase list: summary doesn't add up, got {summary}")
    print("OK — the purchase list shows the new purchase and the summary adds up.")

    # a line total that doesn't match quantity x price is rejected
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/purchases/",
        {
            "supplier_name": "Bad Math Co",
            "purchase_date_time": _now_iso(),
            "lines": [
                {
                    "stock_item": milk_id,
                    "quantity": "10",
                    "unit_price": "60",
                    "line_total": "999",
                }
            ],
        },
        token=owner_access,
    )
    if status not in (400, 422) or not body.get("row_errors"):
        fail(
            f"purchase create bad line total: expected row_errors, got {status} ({body})"
        )
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
            "purchase_date_time": _now_iso(),
            "lines": [
                {
                    "stock_item": milk_id,
                    "quantity": "5",
                    "unit_price": "60",
                    "line_total": "300",
                }
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
            "purchase_date_time": _now_iso(),
            "lines": [
                {
                    "stock_item": milk_id,
                    "quantity": "1",
                    "unit_price": "1",
                    "line_total": "1",
                }
            ],
        },
        token=manager_access,
    )
    if status != 403:
        fail(f"manager edit purchase: expected 403, got {status} ({body})")
    status, body, _ = request(
        "DELETE",
        f"/businesses/{business_id}/purchases/{purchase_id}/",
        token=manager_access,
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
        {
            "name": "Helper One",
            "mobile": helper_mobile,
            "role": "helper",
            "secret": helper_pin,
        },
        token=owner_access,
    )
    if status != 201:
        fail(f"add helper: expected 201, got {status} ({body})")
    status, body, _ = request(
        "POST", "/auth/login/", {"mobile": helper_mobile, "secret": helper_pin}
    )
    if status != 200:
        fail(f"helper login: expected 200, got {status} ({body})")
    helper_access = body["access"]

    status, body, _ = request(
        "GET", f"/businesses/{business_id}/purchases/", token=helper_access
    )
    if status != 403:
        fail(f"helper purchases list: expected 403, got {status} ({body})")
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/purchases/",
        {
            "supplier_name": "x",
            "purchase_date_time": _now_iso(),
            "lines": [
                {
                    "stock_item": milk_id,
                    "quantity": "1",
                    "unit_price": "1",
                    "line_total": "1",
                }
            ],
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
            "purchase_date_time": _now_iso(),
            "note": "Edited by owner",
            "lines": [
                {
                    "stock_item": milk_id,
                    "quantity": "25",
                    "unit_price": "64",
                    "line_total": "1600",
                }
            ],
        },
        token=owner_access,
    )
    if status != 200 or body.get("total_amount") != "1600.00":
        fail(
            f"owner edit purchase: expected 200 with recalculated total, got {status} ({body})"
        )
    print("OK — the Owner edits a purchase and the total is recalculated.")

    status, body, _ = request(
        "DELETE",
        f"/businesses/{business_id}/purchases/{purchase_id}/",
        token=owner_access,
    )
    if status != 204:
        fail(f"owner delete purchase: expected 204, got {status} ({body})")
    status, body, _ = request(
        "GET", f"/businesses/{business_id}/purchases/", token=owner_access
    )
    ids = [p["id"] for p in body.get("results", [])]
    if purchase_id in ids:
        fail(f"deleted purchase still in the list: {ids}")
    status, body, _ = request(
        "GET", f"/businesses/{business_id}/purchases/{purchase_id}/", token=owner_access
    )
    if status != 404:
        fail(f"deleted purchase detail: expected 404, got {status} ({body})")
    print(
        "OK — the Owner deletes a purchase; it disappears from the list and its own detail."
    )

    # another business's user gets 403/404
    other_mobile, other_access, _ = signup_and_login("Unrelated Purchase User")
    status, body, _ = request(
        "GET", f"/businesses/{business_id}/purchases/", token=other_access
    )
    if status not in (403, 404):
        fail(
            f"isolation: unrelated user on purchase list, expected 403/404, got {status} ({body})"
        )
    status, body, _ = request(
        "GET",
        f"/businesses/{business_id}/purchases/{manager_purchase_id}/",
        token=other_access,
    )
    if status not in (403, 404):
        fail(
            f"isolation: unrelated user on purchase detail, expected 403/404, got {status} ({body})"
        )
    print("OK — a user from another business gets 403/404 on these purchases.")

    # /me returns the exact permission set for each role (Step 9 subset only — the full table,
    # including counts/wastage, is asserted in check_count_and_wastage_flow). Step 23a: the Owner's
    # set is every permission that exists anywhere (ALL_PERMISSIONS in businesses/permissions.py),
    # not a hand-picked subset — see check_permission_table for the registry-level version of this.
    status, body, _ = request("GET", "/me/", token=owner_access)
    owner_business = next(b for b in body["businesses"] if b["id"] == business_id)
    expected_owner = {
        "purchases.view",
        "purchases.create",
        "purchases.edit",
        "purchases.delete",
        "stock.view",
        "stockitems.manage",
        "stockitems.thresholds_manage",
        "stock.low_stock_view",
        "sellitems.manage",
        "business.manage",
        "settings.manage",
        "team.manage",
        "team.view",
        "counts.create",
        "counts.review",
        "counts.status",
        "wastage.create",
        "wastage.view_all",
        "wastage.view_own",
        "wastage.view_value",
        "wastage.delete",
        "sales.view",
        "sales.create",
        "sales.delete",
        "alerts.view",
        "alerts.check",
        "reports.view",
    }
    if set(owner_business.get("permissions", [])) != expected_owner:
        fail(
            f"/me owner permissions: expected {expected_owner}, got {owner_business.get('permissions')}"
        )

    status, body, _ = request("GET", "/me/", token=manager_access)
    manager_business = next(b for b in body["businesses"] if b["id"] == business_id)
    expected_manager = {
        "purchases.view",
        "purchases.create",
        "stock.view",
        "stockitems.thresholds_manage",
        "counts.review",
        "wastage.view_all",
        "wastage.view_value",
        "team.view",
        "sales.view",
        "sales.create",
        "alerts.view",
        "alerts.check",
        "reports.view",
    }
    if set(manager_business.get("permissions", [])) != expected_manager:
        fail(
            f"/me manager permissions: expected {expected_manager}, "
            f"got {manager_business.get('permissions')}"
        )

    status, body, _ = request("GET", "/me/", token=helper_access)
    helper_business = next(b for b in body["businesses"] if b["id"] == business_id)
    expected_helper = {"counts.create", "wastage.create", "wastage.view_own"}
    if set(helper_business.get("permissions", [])) != expected_helper:
        fail(
            f"/me helper permissions: expected {expected_helper}, "
            f"got {helper_business.get('permissions')}"
        )
    print("OK — /me returns the correct permissions per role.")


def _add_team_member(
    business_id: str, owner_access: str, name: str, role: str
) -> tuple[str, str, int]:
    """Returns (mobile, access, user_id)."""
    mobile = random.choice("6789") + "".join(random.choices("0123456789", k=9))
    secret = (
        "7392"
        if role in ("head_chef", "helper")
        else f"Kharcha{random.randint(1000, 9999)}!"
    )
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/team/",
        {"name": name, "mobile": mobile, "role": role, "secret": secret},
        token=owner_access,
    )
    if status != 201:
        fail(f"add {role} ({name}): expected 201, got {status} ({body})")
    status, login_body, _ = request(
        "POST", "/auth/login/", {"mobile": mobile, "secret": secret}
    )
    if status != 200:
        fail(f"{role} login ({name}): expected 200, got {status} ({login_body})")
    return mobile, login_body["access"], body["user_id"]


def check_count_and_wastage_flow() -> None:
    _, owner_access, _ = signup_and_login("Count Owner")
    status, body, _ = request(
        "POST",
        "/businesses/",
        {"name": "Count Test Biz", "business_type": "cloud_kitchen", "city": "Pune"},
        token=owner_access,
    )
    if status != 201:
        fail(f"count flow: business create expected 201, got {status} ({body})")
    business_id = body["id"]

    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/stock-items/bulk/",
        {
            "items": [
                {"name": "Milk", "unit": "L", "usual_price": "60.00"},
                {"name": "Flour", "unit": "kg", "usual_price": "48.00"},
            ]
        },
        token=owner_access,
    )
    if status != 201:
        fail(f"count flow: stock bulk create expected 201, got {status} ({body})")
    milk_id = next(i["id"] for i in body if i["name"] == "Milk")
    flour_id = next(i["id"] for i in body if i["name"] == "Flour")

    _, helper_access, helper_user_id = _add_team_member(
        business_id, owner_access, "Count Helper", "helper"
    )
    _, headchef_access, _ = _add_team_member(
        business_id, owner_access, "Count Head Chef", "head_chef"
    )
    _, manager_access, _ = _add_team_member(
        business_id, owner_access, "Count Manager", "manager"
    )

    # the blind form returns only id/name/unit plus the unit-conversion fields QuantityInput needs
    # (unit_family, pack_size_base_qty) — no last count, no expected, no prices, no usual
    status, body, _ = request(
        "GET",
        f"/businesses/{business_id}/counts/form/?type=opening",
        token=helper_access,
    )
    if status != 200:
        fail(f"counts form: expected 200, got {status} ({body})")
    items = body.get("items", [])
    if len(items) != 2:
        fail(f"counts form: expected 2 items, got {items}")
    expected_keys = {"id", "name", "unit", "unit_family", "pack_size_base_qty"}
    for item in items:
        if set(item.keys()) != expected_keys:
            fail(f"counts form: expected only {expected_keys}, got keys {set(item.keys())}")
    print("OK — the blind count form returns only id, name, unit and unit-conversion fields.")

    # a Helper gets 403 on purchases and stock detail
    status, _, _ = request(
        "GET", f"/businesses/{business_id}/purchases/", token=helper_access
    )
    if status != 403:
        fail(f"helper purchases: expected 403, got {status}")
    status, _, _ = request(
        "GET", f"/businesses/{business_id}/stock-items/{milk_id}/", token=helper_access
    )
    if status != 403:
        fail(f"helper stock detail: expected 403, got {status}")
    print("OK — a Helper gets 403 on purchases and stock detail.")

    # opening count (Helper): normal values
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/counts/",
        {
            "type": "opening",
            "lines": [
                {"stock_item": milk_id, "state": "counted", "counted_qty": "10"},
                {"stock_item": flour_id, "state": "counted", "counted_qty": "5"},
            ],
        },
        token=helper_access,
    )
    if status != 201:
        fail(f"opening count: expected 201, got {status} ({body})")
    opening_count_id = body["id"]
    business_date = body["business_date"]
    print("OK — a Helper submits an opening count.")

    # a second opening count for the same date is rejected
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/counts/",
        {
            "type": "opening",
            "lines": [
                {"stock_item": milk_id, "state": "counted", "counted_qty": "11"},
                {"stock_item": flour_id, "state": "counted", "counted_qty": "6"},
            ],
        },
        token=helper_access,
    )
    if status != 409:
        fail(f"duplicate opening count: expected 409, got {status} ({body})")
    print("OK — a second opening count for the same date is rejected.")

    # a Helper gets 403 on count review
    status, _, _ = request(
        "GET",
        f"/businesses/{business_id}/counts/{opening_count_id}/",
        token=helper_access,
    )
    if status != 403:
        fail(f"helper count review: expected 403, got {status}")
    print("OK — a Helper gets 403 on count review.")

    # a purchase, then a wastage entry, between the two counts — the known case for
    # used_since_last_count below (previous 10, bought 5, wasted 2, counted 35 -> -22)
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/purchases/",
        {
            "supplier_name": "Between Counts Co",
            "purchase_date_time": _now_iso(),
            "lines": [
                {
                    "stock_item": milk_id,
                    "quantity": "5",
                    "unit_price": "60",
                    "line_total": "300",
                }
            ],
        },
        token=owner_access,
    )
    if status != 201:
        fail(f"count flow: purchase between counts expected 201, got {status} ({body})")

    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/wastage/",
        {"stock_item": milk_id, "quantity": "2", "reason": "spillage"},
        token=helper_access,
    )
    if status != 201:
        fail(f"helper wastage create: expected 201, got {status} ({body})")
    helper_wastage_id = body["id"]
    if "value" in body:
        fail(f"helper wastage create: value should be omitted for Helper, got {body}")
    print("OK — a Helper records a wastage entry; no rupee value is shown to them.")

    # closing_count_hour -> 0, so the closing count about to be submitted is late
    status, body, _ = request(
        "PATCH",
        f"/businesses/{business_id}/settings/",
        {"closing_count_hour": 0},
        token=owner_access,
    )
    if status != 200:
        fail(f"set closing_count_hour: expected 200, got {status} ({body})")

    # closing count: Milk is far above 3x its only earlier count (10) -> needs_confirmation
    closing_lines = [
        {"stock_item": milk_id, "state": "counted", "counted_qty": "35"},
        {"stock_item": flour_id, "state": "counted", "counted_qty": "4"},
    ]
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/counts/",
        {"type": "closing", "lines": closing_lines},
        token=helper_access,
    )
    if status != 409 or body.get("error", {}).get("code") != "needs_confirmation":
        fail(
            f"unusual closing count: expected 409 needs_confirmation, got {status} ({body})"
        )
    if body.get("item_ids") != [milk_id]:
        fail(
            f"unusual closing count: expected item_ids [{milk_id}], got {body.get('item_ids')}"
        )
    if set(body.keys()) - {"error", "item_ids"}:
        fail(
            f"unusual closing count: response should carry no numbers, got extra keys {body}"
        )
    print(
        "OK — a very high value returns 409 needs_confirmation with item ids and no numbers."
    )

    # re-sent with confirm_ids -> succeeds, and is late
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/counts/",
        {"type": "closing", "confirm_ids": [milk_id], "lines": closing_lines},
        token=helper_access,
    )
    if status != 201:
        fail(f"confirmed closing count: expected 201, got {status} ({body})")
    closing_count_id = body["id"]
    if not body.get("is_late") or not body.get("minutes_late", 0) > 0:
        fail(f"confirmed closing count: expected is_late/minutes_late set, got {body}")
    if body.get("missing_opening") is not False:
        fail(
            f"confirmed closing count: expected missing_opening False (opening was done), got {body}"
        )
    print(
        "OK — re-sending with confirm_ids succeeds, and the late deadline is recorded."
    )

    # count review (Owner): list for the date
    status, body, _ = request(
        "GET",
        f"/businesses/{business_id}/counts/?date={business_date}",
        token=owner_access,
    )
    if status != 200:
        fail(f"count review list: expected 200, got {status} ({body})")
    ids = {c["id"] for c in body}
    if {opening_count_id, closing_count_id} - ids:
        fail(f"count review list: missing counts, got {body}")
    closing_entry = next(c for c in body if c["id"] == closing_count_id)
    if not closing_entry["is_late"] or closing_entry["minutes_late"] <= 0:
        fail(
            f"count review list: expected the closing count marked late, got {closing_entry}"
        )
    print(
        "OK — count review lists both counts with who, when, late/on-time and item counts."
    )

    # count review (Owner): detail — the known used_since_last_count case, flagged item first
    status, body, _ = request(
        "GET",
        f"/businesses/{business_id}/counts/{closing_count_id}/",
        token=owner_access,
    )
    if status != 200:
        fail(f"count review detail: expected 200, got {status} ({body})")
    if body["lines"][0]["stock_item"] != milk_id:
        fail(
            f"count review detail: expected the flagged item (Milk) first, got {body['lines'][0]}"
        )
    milk_line = next(line_ for line_ in body["lines"] if line_["stock_item"] == milk_id)
    if Decimal(milk_line["previous_counted_qty"]) != Decimal("10"):
        fail(f"count review detail: expected previous_counted_qty 10, got {milk_line}")
    if Decimal(milk_line["quantity_bought_since"]) != Decimal("5"):
        fail(f"count review detail: expected quantity_bought_since 5, got {milk_line}")
    if Decimal(milk_line["quantity_wasted_since"]) != Decimal("2"):
        fail(f"count review detail: expected quantity_wasted_since 2, got {milk_line}")
    if Decimal(milk_line["used_since_last_count"]) != Decimal("-22"):
        fail(
            f"count review detail: expected used_since_last_count -22, got {milk_line}"
        )
    print(
        "OK — count review detail's used_since_last_count is correct for a known case."
    )

    # Step 14: this business has no sell item linking to Milk, so its gap is not_comparable
    # (not_sold) rather than computed — and a Helper/Head chef still can't reach this endpoint at
    # all (403, already asserted above), so they never see a gap field either.
    if (
        milk_line.get("gap_status") != "not_comparable"
        or milk_line.get("gap_reason", {}).get("code") != "not_sold"
    ):
        fail(
            f"count review detail: expected Milk's gap not_comparable/not_sold, got {milk_line}"
        )
    if (
        milk_line.get("expected_used") is not None
        or milk_line.get("gap_qty") is not None
    ):
        fail(
            f"count review detail: not_comparable lines should have null gap fields, got {milk_line}"
        )
    print(
        "OK — a stock item with no linked sell item shows a not_comparable gap (not_sold)."
    )

    # Manager also has count review access
    status, _, _ = request(
        "GET",
        f"/businesses/{business_id}/counts/{closing_count_id}/",
        token=manager_access,
    )
    if status != 200:
        fail(f"manager count review: expected 200, got {status}")

    # a second wastage entry, from the Head chef
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/wastage/",
        {"stock_item": flour_id, "quantity": "1", "reason": "spoiled"},
        token=headchef_access,
    )
    if status != 201:
        fail(f"head chef wastage create: expected 201, got {status} ({body})")
    headchef_wastage_id = body["id"]
    if "value" in body:
        fail(f"head chef wastage create: value should be omitted, got {body}")

    # Helper sees only their own entry
    status, body, _ = request(
        "GET", f"/businesses/{business_id}/wastage/", token=helper_access
    )
    if status != 200:
        fail(f"helper wastage list: expected 200, got {status} ({body})")
    result_ids = {e["id"] for e in body["results"]}
    if result_ids != {helper_wastage_id}:
        fail(f"helper wastage list: expected only their own entry, got {result_ids}")
    if any("value" in e for e in body["results"]) or "summary" in body:
        fail(f"helper wastage list: value/summary should never appear, got {body}")
    print(
        "OK — a Helper sees only their own wastage entries, with no values or summary."
    )

    # Head chef sees every entry, without values
    status, body, _ = request(
        "GET", f"/businesses/{business_id}/wastage/", token=headchef_access
    )
    if status != 200:
        fail(f"head chef wastage list: expected 200, got {status} ({body})")
    result_ids = {e["id"] for e in body["results"]}
    if {helper_wastage_id, headchef_wastage_id} - result_ids:
        fail(f"head chef wastage list: expected to see every entry, got {result_ids}")
    if any("value" in e for e in body["results"]):
        fail(f"head chef wastage list: value should never appear, got {body}")
    print("OK — a Head chef sees every entry today, with no values.")

    # Manager sees values and a summary, but gets 403 on create and delete
    status, body, _ = request(
        "GET", f"/businesses/{business_id}/wastage/", token=manager_access
    )
    if status != 200:
        fail(f"manager wastage list: expected 200, got {status} ({body})")
    if not body["results"] or not all("value" in e for e in body["results"]):
        fail(
            f"manager wastage list: expected a value on every entry, got {body['results']}"
        )
    if "summary" not in body:
        fail(f"manager wastage list: expected a summary, got {body}")
    status, _, _ = request(
        "POST",
        f"/businesses/{business_id}/wastage/",
        {"stock_item": milk_id, "quantity": "1", "reason": "other"},
        token=manager_access,
    )
    if status != 403:
        fail(f"manager wastage create: expected 403, got {status}")
    status, _, _ = request(
        "DELETE",
        f"/businesses/{business_id}/wastage/{helper_wastage_id}/",
        token=manager_access,
    )
    if status != 403:
        fail(f"manager wastage delete: expected 403, got {status}")
    print("OK — a Manager sees values but gets 403 on create and delete.")

    # Step 23a: Manager still has no counts.create — reviewing is the only count job it does
    status, _, _ = request(
        "POST",
        f"/businesses/{business_id}/counts/",
        {
            "type": "opening",
            "lines": [{"stock_item": milk_id, "state": "counted", "counted_qty": "1"}],
        },
        token=manager_access,
    )
    if status != 403:
        fail(f"manager count create: expected 403, got {status}")
    print("OK — a Manager still cannot count stock or record wastage.")

    # today/: both counts already submitted, so both show "done" (is_late is a separate, historical
    # fact recorded on the StockCount itself, checked above via count review) -> team_progress for
    # Head chef and (Step 23a: counts.status is in ALL_PERMISSIONS, so the Owner carries it too) Owner,
    # never for Helper or Manager
    status, body, _ = request(
        "GET", f"/businesses/{business_id}/today/", token=owner_access
    )
    if status != 200:
        fail(f"today (owner): expected 200, got {status} ({body})")
    if body["opening"]["state"] != "done" or body["closing"]["state"] != "done":
        fail(f"today (owner): expected both counts done, got {body}")
    if body.get("wastage_entries_today") != 2:
        fail(f"today (owner): expected 2 wastage entries today, got {body}")
    if body.get("team_progress", {}).get("total") != 2:
        fail(f"today (owner): expected team_progress for 2 items, got {body}")

    status, body, _ = request(
        "GET", f"/businesses/{business_id}/today/", token=headchef_access
    )
    if status != 200:
        fail(f"today (head chef): expected 200, got {status} ({body})")
    if body.get("team_progress", {}).get("total") != 2:
        fail(f"today (head chef): expected team_progress for 2 items, got {body}")

    status, body, _ = request(
        "GET", f"/businesses/{business_id}/today/", token=manager_access
    )
    if status != 200:
        fail(f"today (manager): expected 200, got {status} ({body})")
    if "team_progress" in body:
        fail(f"today (manager): team_progress should not appear for Manager, got {body}")

    status, body, _ = request(
        "GET", f"/businesses/{business_id}/today/", token=helper_access
    )
    if status != 200:
        fail(f"today (helper): expected 200, got {status} ({body})")
    if "team_progress" in body:
        fail(f"today (helper): team_progress should not appear for Helper, got {body}")
    print(
        "OK — today/ reflects count state per role, with team progress for Owner and Head chef only."
    )

    # late-count reminder: Owner only
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/counts/remind/",
        {"type": "closing", "user_id": helper_user_id},
        token=owner_access,
    )
    if status != 200 or "wa_link" not in body or "wa.me" not in body["wa_link"]:
        fail(f"remind: expected 200 with a wa.me link, got {status} ({body})")
    if "mobile" in body:
        fail(f"remind: the mobile number should not be returned separately, got {body}")
    status, _, _ = request(
        "POST",
        f"/businesses/{business_id}/counts/remind/",
        {"type": "closing", "user_id": helper_user_id},
        token=manager_access,
    )
    if status != 403:
        fail(f"manager remind: expected 403, got {status}")
    print("OK — the late-count reminder (Owner only) returns a prepared wa.me link.")

    # Owner soft-deletes a wastage entry — it leaves the list
    status, _, _ = request(
        "DELETE",
        f"/businesses/{business_id}/wastage/{helper_wastage_id}/",
        token=owner_access,
    )
    if status != 204:
        fail(f"owner wastage delete: expected 204, got {status}")
    status, body, _ = request(
        "GET", f"/businesses/{business_id}/wastage/", token=owner_access
    )
    result_ids = {e["id"] for e in body["results"]}
    if helper_wastage_id in result_ids:
        fail(f"deleted wastage entry still in the list: {result_ids}")
    print("OK — the Owner deletes a wastage entry; it disappears from the list.")

    # another business's users get 403/404 on every new endpoint
    _, stranger_access, _ = signup_and_login("Count Stranger")
    probes = [
        ("GET", f"/businesses/{business_id}/counts/form/?type=opening", None),
        ("GET", f"/businesses/{business_id}/counts/?date={business_date}", None),
        (
            "POST",
            f"/businesses/{business_id}/counts/",
            {"type": "opening", "lines": []},
        ),
        ("GET", f"/businesses/{business_id}/counts/{opening_count_id}/", None),
        (
            "POST",
            f"/businesses/{business_id}/counts/remind/",
            {"type": "closing", "user_id": helper_user_id},
        ),
        ("GET", f"/businesses/{business_id}/wastage/", None),
        (
            "POST",
            f"/businesses/{business_id}/wastage/",
            {"stock_item": milk_id, "quantity": "1", "reason": "other"},
        ),
        ("DELETE", f"/businesses/{business_id}/wastage/{headchef_wastage_id}/", None),
        ("GET", f"/businesses/{business_id}/today/", None),
    ]
    for method, path, probe_body in probes:
        status, resp_body, _ = request(method, path, probe_body, token=stranger_access)
        if status not in (403, 404):
            fail(
                f"isolation: {method} {path} expected 403/404, got {status} ({resp_body})"
            )
    print("OK — another business's users get 403/404 on every new endpoint.")


def check_daily_counts_flow() -> None:
    # Scenario A: a closing attempted before any opening, with neither deadline passed yet, is
    # rejected with opening_required. day_starts_hour: 0 first, so business_date is the plain
    # calendar date (no midnight-shift ambiguity) — then pushing both hours to 23 keeps the
    # opening "not missed" regardless of what time of day this script happens to run (mirrors the
    # closing_count_hour: 0 "always late" trick below, just aimed the other way). Without pinning
    # day_starts_hour first, a run between 23:00 and the (shifted) day's start would see
    # yesterday's 23:00 deadline as already passed.
    _, owner_access, _ = signup_and_login("Daily Counts Owner")
    status, body, _ = request(
        "POST",
        "/businesses/",
        {"name": "Daily Counts Test Biz", "business_type": "cloud_kitchen", "city": "Pune"},
        token=owner_access,
    )
    if status != 201:
        fail(f"daily counts flow: business create expected 201, got {status} ({body})")
    business_id = body["id"]

    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/stock-items/bulk/",
        {"items": [{"name": "Tea Leaves", "unit": "kg"}]},
        token=owner_access,
    )
    if status != 201:
        fail(f"daily counts flow: stock bulk create expected 201, got {status} ({body})")

    status, body, _ = request(
        "PATCH",
        f"/businesses/{business_id}/settings/",
        {"day_starts_hour": 0, "count_deadline_hour": 23, "closing_count_hour": 23},
        token=owner_access,
    )
    if status != 200:
        fail(f"daily counts flow: settings patch expected 200, got {status} ({body})")

    status, body, _ = request(
        "GET", f"/businesses/{business_id}/stock-items/", token=owner_access
    )
    tea_id = body[0]["id"]

    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/counts/",
        {"type": "closing", "lines": [{"stock_item": tea_id, "state": "skipped"}]},
        token=owner_access,
    )
    if status != 409 or body.get("error", {}).get("code") != "opening_required":
        fail(
            f"daily counts flow: closing before opening expected 409 opening_required, got {status} ({body})"
        )
    print("OK — a closing count before any opening, and before the deadline, is rejected.")

    # the Today status agrees: closing is locked, next_action is opening.
    status, body, _ = request(
        "GET", f"/businesses/{business_id}/counts/today/", token=owner_access
    )
    if status != 200 or body["closing"]["state"] != "locked" or body["next_action"] != "opening":
        fail(f"daily counts flow: expected closing locked/next_action opening, got {status} ({body})")
    print("OK — counts/today/ reports closing locked and next_action opening.")

    # Scenario B: both deadlines already passed (hour 0, always in the past for "today"), no
    # opening done — Step 23d: this business has never counted anything, so its first count can
    # only ever be an opening; "opening missed" never applies to it, so the closing stays rejected
    # no matter how late in the day it is. (Before Step 23d, this closing would have been let
    # through as the business's first count, flagged missing_opening — that shortcut no longer
    # applies to a first count at all; see counts/business_day.py's has_any_count.)
    status, body, _ = request(
        "PATCH",
        f"/businesses/{business_id}/settings/",
        {"count_deadline_hour": 0, "closing_count_hour": 0},
        token=owner_access,
    )
    if status != 200:
        fail(f"daily counts flow: settings patch expected 200, got {status} ({body})")

    status, body, _ = request(
        "GET", f"/businesses/{business_id}/counts/today/", token=owner_access
    )
    if status != 200 or body["closing"]["state"] != "locked" or body["closing"]["missing_opening"]:
        fail(
            f"daily counts flow: expected closing still locked, missing_opening False, got {status} ({body})"
        )
    print("OK — counts/today/ keeps closing locked for a first-ever count, deadline or not.")

    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/counts/",
        {"type": "closing", "lines": [{"stock_item": tea_id, "state": "skipped"}]},
        token=owner_access,
    )
    if status != 409 or body.get("error", {}).get("code") != "opening_required":
        fail(
            f"daily counts flow: closing as a first count expected 409 opening_required, got {status} ({body})"
        )
    print("OK — a closing still can't be a business's first-ever count, however late.")

    # the first count itself: an opening, saved un-late despite the deadline having passed.
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/counts/",
        {"type": "opening", "lines": [{"stock_item": tea_id, "state": "skipped"}]},
        token=owner_access,
    )
    if status != 201 or body["is_late"] is not False:
        fail(
            f"daily counts flow: first-ever opening expected 201 and is_late False, got {status} ({body})"
        )

    # a duplicate opening for the same date is rejected, unchanged.
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/counts/",
        {"type": "opening", "lines": [{"stock_item": tea_id, "state": "skipped"}]},
        token=owner_access,
    )
    if status != 409:
        fail(f"daily counts flow: duplicate opening expected 409, got {status} ({body})")

    # the closing now goes through normally — opening is done for today, and this is no longer a
    # first count, so the deadline applies for real.
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/counts/",
        {"type": "closing", "lines": [{"stock_item": tea_id, "state": "skipped"}]},
        token=owner_access,
    )
    if status != 201 or body["missing_opening"] is not False or body["is_late"] is not True:
        fail(
            "daily counts flow: second closing expected 201, missing_opening False, is_late True, "
            f"got {status} ({body})"
        )
    print("OK — a duplicate opening is rejected; the closing then saves normally, genuinely late.")

    # Scenario C: day_starts_hour shifts the business date — verified against the same formula,
    # since there's no way to control the wall clock from here.
    status, body, _ = request(
        "PATCH",
        f"/businesses/{business_id}/settings/",
        {"day_starts_hour": 3},
        token=owner_access,
    )
    if status != 200:
        fail(f"daily counts flow: settings patch expected 200, got {status} ({body})")
    status, body, _ = request(
        "GET", f"/businesses/{business_id}/counts/today/", token=owner_access
    )
    if status != 200:
        fail(f"daily counts flow: counts/today/ expected 200, got {status} ({body})")
    now_ist = datetime.now(ZoneInfo("Asia/Kolkata"))
    expected_business_date = (now_ist - timedelta(hours=3)).date().isoformat()
    if body["business_date"] != expected_business_date:
        fail(
            f"daily counts flow: expected business_date {expected_business_date} for "
            f"day_starts_hour=3, got {body['business_date']}"
        )
    print("OK — day_starts_hour shifts the business date per the same formula.")

    # Scenario D: a brand-new business gets no late alerts before its first count; once that first
    # (opening) count is in, the normal closing_late rule resumes and dismisses like any other alert.
    _, owner2_access, _ = signup_and_login("Daily Counts Alerts Owner")
    status, body, _ = request(
        "POST",
        "/businesses/",
        {"name": "Daily Counts Alerts Biz", "business_type": "cloud_kitchen", "city": "Pune"},
        token=owner2_access,
    )
    if status != 201:
        fail(f"daily counts flow: second business create expected 201, got {status} ({body})")
    business2_id = body["id"]
    status, body, _ = request(
        "POST",
        f"/businesses/{business2_id}/stock-items/bulk/",
        {"items": [{"name": "Coffee", "unit": "kg"}]},
        token=owner2_access,
    )
    if status != 201:
        fail(f"daily counts flow: second stock bulk create expected 201, got {status} ({body})")
    coffee_id = body[0]["id"]
    status, body, _ = request(
        "PATCH",
        f"/businesses/{business2_id}/settings/",
        {"count_deadline_hour": 0, "closing_count_hour": 0},
        token=owner2_access,
    )
    if status != 200:
        fail(f"daily counts flow: second settings patch expected 200, got {status} ({body})")

    # both deadlines are already passed, but this business has never counted anything — Step 23d:
    # no opening_late/closing_late before a first count, no matter how late in the day it is.
    status, body, _ = request(
        "GET", f"/businesses/{business2_id}/counts/today/", token=owner2_access
    )
    if status != 200 or body["is_first_count"] is not True or body["opening"]["state"] == "late":
        fail(f"daily counts flow: expected is_first_count True and opening not late, got {body}")
    status, body, _ = request(
        "GET", f"/businesses/{business2_id}/alerts/", token=owner2_access
    )
    if status != 200 or set(a["type"] for a in body["results"]) & {"opening_late", "closing_late"}:
        fail(
            f"daily counts flow: expected no late alerts before a first count, got {status} ({body})"
        )
    print("OK — no opening_late/closing_late before the business's first count, however late.")

    status, body, _ = request(
        "POST",
        f"/businesses/{business2_id}/counts/",
        {"type": "opening", "lines": [{"stock_item": coffee_id, "state": "skipped"}]},
        token=owner2_access,
    )
    if status != 201 or body["is_late"] is not False:
        fail(f"daily counts flow: first count expected 201 and is_late False, got {status} ({body})")
    print("OK — the first count itself saves as a normal, on-time opening count.")

    # today's opening is now done, so only closing_late — the normal, second-count-onward rule —
    # can fire; it dismisses the same way any other alert does.
    status, body, _ = request(
        "GET", f"/businesses/{business2_id}/alerts/", token=owner2_access
    )
    if status != 200 or set(a["type"] for a in body["results"]) != {"closing_late"}:
        fail(
            f"daily counts flow: expected only closing_late once the first count is in, got {status} ({body})"
        )
    closing_late_key = body["results"][0]["key"]
    status, _, _ = request(
        "POST",
        f"/businesses/{business2_id}/alerts/check/",
        {"key": closing_late_key},
        token=owner2_access,
    )
    if status != 204:
        fail(f"daily counts flow: check closing_late expected 204, got {status}")
    status, body, _ = request(
        "GET", f"/businesses/{business2_id}/alerts/", token=owner2_access
    )
    if any(a["type"] == "closing_late" for a in body["results"]):
        fail(f"daily counts flow: expected closing_late gone after check, got {body['results']}")
    print("OK — closing_late fires normally after the first count, and dismisses.")


def check_first_count_flow() -> None:
    # Step 23d: the very first count a business ever submits can save with only some items
    # counted (the rest skipped), and is never late no matter how far past the deadline it is —
    # the second count onward goes back to the normal, every-item, on-time-or-late rules.
    _, owner_access, _ = signup_and_login("First Count Owner")
    status, body, _ = request(
        "POST",
        "/businesses/",
        {"name": "First Count Biz", "business_type": "cloud_kitchen", "city": "Pune"},
        token=owner_access,
    )
    if status != 201:
        fail(f"first count flow: business create expected 201, got {status} ({body})")
    business_id = body["id"]

    # both deadlines already passed for "today" — proves the first count ignores them entirely.
    status, body, _ = request(
        "PATCH",
        f"/businesses/{business_id}/settings/",
        {"day_starts_hour": 0, "count_deadline_hour": 0, "closing_count_hour": 0},
        token=owner_access,
    )
    if status != 200:
        fail(f"first count flow: settings patch expected 200, got {status} ({body})")

    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/stock-items/bulk/",
        {"items": [{"name": n, "unit": "kg"} for n in ("A", "B", "C", "D", "E")]},
        token=owner_access,
    )
    if status != 201:
        fail(f"first count flow: stock bulk create expected 201, got {status} ({body})")
    ids_by_name = {item["name"]: item["id"] for item in body}

    status, body, _ = request(
        "GET", f"/businesses/{business_id}/counts/today/", token=owner_access
    )
    if status != 200 or body["is_first_count"] is not True or body["opening"]["state"] == "late":
        fail(f"first count flow: expected is_first_count True and opening not late, got {body}")
    print("OK — counts/today/ reports is_first_count True and opening not late, deadline or not.")

    # 2 of 5 items counted, the rest explicitly skipped — the server's "every item addressed" rule
    # is unchanged (skip counts as addressed); the Save-button leniency itself is a frontend-only
    # affordance, not a backend one.
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/counts/",
        {
            "type": "opening",
            "lines": [
                {"stock_item": ids_by_name["A"], "state": "counted", "counted_qty": "4"},
                {"stock_item": ids_by_name["B"], "state": "counted", "counted_qty": "2"},
                {"stock_item": ids_by_name["C"], "state": "skipped"},
                {"stock_item": ids_by_name["D"], "state": "skipped"},
                {"stock_item": ids_by_name["E"], "state": "skipped"},
            ],
        },
        token=owner_access,
    )
    if status != 201:
        fail(f"first count flow: first count (2 of 5) expected 201, got {status} ({body})")
    if body["is_late"] is not False or body["missing_opening"] is not False:
        fail(f"first count flow: expected is_late False and missing_opening False, got {body}")
    print("OK — the first count saves with 2 of 5 items counted, and is never late.")

    status, body, _ = request(
        "GET", f"/businesses/{business_id}/stock-items/", token=owner_access
    )
    if status != 200:
        fail(f"first count flow: stock items list expected 200, got {status} ({body})")
    by_id = {item["id"]: item for item in body}
    for name in ("A", "B"):
        if by_id[ids_by_name[name]]["last_counted_qty"] is None:
            fail(f"first count flow: expected {name} to show a last_counted_qty, got {body}")
    for name in ("C", "D", "E"):
        if by_id[ids_by_name[name]]["last_counted_qty"] is not None:
            fail(
                f"first count flow: expected {name} to still show 'not counted yet', got "
                f"{by_id[ids_by_name[name]]}"
            )
    print("OK — Stock shows the 2 counted items and 'not counted yet' for the 3 skipped ones.")

    # the second count (today's closing) is no longer exempt — every item must still be addressed,
    # and it's genuinely late now that it's not the business's first count.
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/counts/",
        {
            "type": "closing",
            "lines": [{"stock_item": ids_by_name[n], "state": "skipped"} for n in "ABCDE"],
        },
        token=owner_access,
    )
    if status != 201:
        fail(f"first count flow: second count expected 201, got {status} ({body})")
    if body["is_late"] is not True or body["missing_opening"] is not False:
        fail(f"first count flow: expected second count is_late True, missing_opening False, got {body}")
    print("OK — the second count follows the normal daily rules, including being late.")


def check_settings_flow() -> None:
    _, owner_access, _ = signup_and_login("Settings Owner")
    status, body, _ = request(
        "POST",
        "/businesses/",
        {"name": "Settings Test Biz", "business_type": "cloud_kitchen", "city": "Pune"},
        token=owner_access,
    )
    if status != 201:
        fail(f"settings flow: business create expected 201, got {status} ({body})")
    business_id = body["id"]

    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/stock-items/bulk/",
        {
            "items": [
                {"name": "Rice", "unit": "kg", "usual_price": "60.00"},
                {"name": "Sugar", "unit": "kg"},
            ]
        },
        token=owner_access,
    )
    if status != 201:
        fail(f"settings flow: stock bulk create expected 201, got {status} ({body})")
    rice_id = next(i["id"] for i in body if i["name"] == "Rice")
    sugar_id = next(i["id"] for i in body if i["name"] == "Sugar")

    # rename
    status, body, _ = request(
        "PATCH",
        f"/businesses/{business_id}/stock-items/{rice_id}/",
        {"name": "Basmati Rice"},
        token=owner_access,
    )
    if status != 200 or body.get("name") != "Basmati Rice":
        fail(
            f"rename stock item: expected 200 with the new name, got {status} ({body})"
        )
    print("OK — renamed a stock item.")

    # duplicate name, case-insensitive
    status, body, _ = request(
        "PATCH",
        f"/businesses/{business_id}/stock-items/{sugar_id}/",
        {"name": "basmati rice"},
        token=owner_access,
    )
    if status not in (400, 422):
        fail(f"rename stock item duplicate: expected rejection, got {status} ({body})")
    print("OK — a case-insensitive duplicate name is rejected.")

    # a purchase gives Basmati Rice history, so its unit can no longer change
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/purchases/",
        {
            "supplier_name": "Settings Supplies",
            "purchase_date_time": _now_iso(),
            "lines": [
                {
                    "stock_item": rice_id,
                    "quantity": "5",
                    "unit_price": "60",
                    "line_total": "300",
                }
            ],
        },
        token=owner_access,
    )
    if status != 201:
        fail(f"settings flow: purchase create expected 201, got {status} ({body})")

    # Step U1b-2: re-picking "kg" is a no-op now (it resolves to the same weight family/g base
    # this item already stores as) — the real lock is on the *family*, so this now has to attempt
    # an actual family change (weight -> count) to prove the lock still holds.
    status, body, _ = request(
        "PATCH",
        f"/businesses/{business_id}/stock-items/{rice_id}/",
        {"unit": "piece"},
        token=owner_access,
    )
    if (
        status not in (400, 422)
        or body.get("error", {}).get("code") != "STOCK_ITEM_UNIT_LOCKED"
    ):
        fail(
            f"unit change after purchase: expected STOCK_ITEM_UNIT_LOCKED, got {status} ({body})"
        )
    print("OK — changing a stock item's unit family is refused once it has a purchase.")

    # a dish has Basmati Rice as an ingredient
    rice_bowl_id, _ = _create_dish(
        business_id, owner_access, "Rice Bowl", "99.00", [(rice_id, "0.200")]
    )

    # deactivating the stock item is refused while that sell item is still active
    status, body, _ = request(
        "PATCH",
        f"/businesses/{business_id}/stock-items/{rice_id}/",
        {"active": False},
        token=owner_access,
    )
    if (
        status not in (400, 422)
        or body.get("error", {}).get("code") != "STOCK_ITEM_IN_USE"
    ):
        fail(
            f"deactivate stock item in use: expected STOCK_ITEM_IN_USE, got {status} ({body})"
        )
    if "Rice Bowl" not in body.get("error", {}).get("message", ""):
        fail(
            f"deactivate stock item in use: expected the sell item named in the message, got {body}"
        )
    print(
        "OK — deactivating a stock item in use is refused, naming the sell item in the message."
    )

    # deactivating the sell item first, then the stock item, both succeed
    status, body, _ = request(
        "PATCH",
        f"/businesses/{business_id}/sell-items/{rice_bowl_id}/",
        {"active": False},
        token=owner_access,
    )
    if status != 200 or body.get("active") is not False:
        fail(f"deactivate sell item: expected 200 inactive, got {status} ({body})")
    status, body, _ = request(
        "PATCH",
        f"/businesses/{business_id}/stock-items/{rice_id}/",
        {"active": False},
        token=owner_access,
    )
    if status != 200 or body.get("active") is not False:
        fail(f"deactivate stock item: expected 200 inactive, got {status} ({body})")
    print("OK — deactivating the sell item, then the stock item it used, both succeed.")

    # a second pair of items to exercise editing a dish's ingredients
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/stock-items/bulk/",
        {"items": [{"name": "Flour", "unit": "kg"}]},
        token=owner_access,
    )
    if status != 201:
        fail(
            f"settings flow: second stock item create expected 201, got {status} ({body})"
        )
    flour_id = body[0]["id"]

    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/sell-items/bulk/",
        {"items": [{"name": "Bread", "selling_price": "40.00"}]},
        token=owner_access,
    )
    if status != 201:
        fail(
            f"settings flow: second sell item create expected 201, got {status} ({body})"
        )
    bread_id = body[0]["id"]
    if body[0]["recipe_status"] != "none":
        fail(
            f"settings flow: expected Bread at recipe_status=none fresh off bulk create, got {body}"
        )

    # PATCHing a dish's ingredients down to zero is rejected the same as on create
    status, body, _ = request(
        "PATCH",
        f"/businesses/{business_id}/sell-items/{bread_id}/",
        {"ingredients": []},
        token=owner_access,
    )
    if status not in (400, 422):
        fail(
            f"dish edit with zero ingredients: expected rejection, got {status} ({body})"
        )
    print(
        "OK — editing a dish's ingredients down to zero is rejected, same as on create."
    )

    # setting a real ingredient confirms the recipe
    status, body, _ = request(
        "PATCH",
        f"/businesses/{business_id}/sell-items/{bread_id}/",
        {"ingredients": [{"stock_item": flour_id, "quantity": "0.300"}]},
        token=owner_access,
    )
    if (
        status != 200
        or body.get("recipe_status") != "confirmed"
        or body["ingredients"][0]["quantity"] != "0.300"
    ):
        fail(
            f"dish edit with a real ingredient: expected 200 confirmed 0.300, got {status} ({body})"
        )
    print("OK — setting a dish's ingredients via PATCH confirms its recipe.")

    # a Manager gets 403 on every one of these PATCHes
    manager_mobile = random.choice("6789") + "".join(random.choices("0123456789", k=9))
    manager_password = f"Kharcha{random.randint(1000, 9999)}!"
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/team/",
        {
            "name": "Settings Manager",
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

    probes = [
        ("PATCH", f"/businesses/{business_id}/stock-items/{flour_id}/", {"name": "x"}),
        ("PATCH", f"/businesses/{business_id}/sell-items/{bread_id}/", {"name": "x"}),
        ("PATCH", f"/businesses/{business_id}/", {"tagline": "x"}),
        ("PATCH", f"/businesses/{business_id}/settings/", {"target_cost_pct": "40"}),
    ]
    for method, path, probe_body in probes:
        status, body, _ = request(method, path, probe_body, token=manager_access)
        if status != 403:
            fail(f"manager settings PATCH {path}: expected 403, got {status} ({body})")
    print("OK — a Manager gets 403 on every Settings PATCH endpoint.")

    # audit rows exist for the stock and sell item updates above
    if count_audit_rows("stock_item.update", business_id) < 1:
        fail("audit: expected at least one stock_item.update row for this business")
    if count_audit_rows("sell_item.update", business_id) < 1:
        fail("audit: expected at least one sell_item.update row for this business")
    print("OK — audit rows exist for the stock and sell item updates.")


def check_sales_and_gap_flow() -> None:
    _, owner_access, _ = signup_and_login("Sales Owner")
    status, body, _ = request(
        "POST",
        "/businesses/",
        {"name": "Sales Test Biz", "business_type": "cloud_kitchen", "city": "Pune"},
        token=owner_access,
    )
    if status != 201:
        fail(f"sales flow: business create expected 201, got {status} ({body})")
    business_id = body["id"]

    # Step 23b: day_starts_hour: 0 keeps this business's business_date the plain calendar date —
    # this test reuses the opening count's business_date to date a sale below, then checks that
    # sale against the sales summary's own "today" (sales/views.py's own, unshifted notion of
    # "today" — out of this step's scope to touch). Those two would only ever disagree during the
    # 0 -> day_starts_hour window with the real default (5), so pinning it to 0 here removes that
    # window entirely rather than leaving this test occasionally flaky overnight.
    status, body, _ = request(
        "PATCH",
        f"/businesses/{business_id}/settings/",
        {"day_starts_hour": 0},
        token=owner_access,
    )
    if status != 200:
        fail(f"sales flow: settings patch expected 200, got {status} ({body})")

    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/stock-items/bulk/",
        {"items": [{"name": "Milk", "unit": "L"}]},
        token=owner_access,
    )
    if status != 201:
        fail(f"sales flow: stock bulk create expected 201, got {status} ({body})")
    milk_id = body[0]["id"]

    tea_pack_id, _ = _create_dish(
        business_id, owner_access, "Tea pack", "20.00", [(milk_id, "0.200")]
    )

    # opening count: Milk 12 L (the "previous" count the gap window starts from)
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/counts/",
        {
            "type": "opening",
            "lines": [{"stock_item": milk_id, "state": "counted", "counted_qty": "12"}],
        },
        token=owner_access,
    )
    if status != 201:
        fail(f"sales flow: opening count expected 201, got {status} ({body})")
    business_date = body["business_date"]

    # bought 20 L at Rs 64/L (sets the last purchase price used for gap_value) and wasted 1.5 L,
    # both between the opening and closing counts
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/purchases/",
        {
            "supplier_name": "Dairy Co",
            "purchase_date_time": _now_iso(),
            "lines": [
                {
                    "stock_item": milk_id,
                    "quantity": "20",
                    "unit_price": "64",
                    "line_total": "1280",
                }
            ],
        },
        token=owner_access,
    )
    if status != 201:
        fail(f"sales flow: purchase expected 201, got {status} ({body})")
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/wastage/",
        {"stock_item": milk_id, "quantity": "1.5", "reason": "spillage"},
        token=owner_access,
    )
    if status != 201:
        fail(f"sales flow: wastage expected 201, got {status} ({body})")

    # closing count: Milk 8 L -> used_since_last_count = 12 + 20 - 1.5 - 8 = 22.5
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/counts/",
        {
            "type": "closing",
            "lines": [{"stock_item": milk_id, "state": "counted", "counted_qty": "8"}],
        },
        token=owner_access,
    )
    if status != 201:
        fail(f"sales flow: closing count expected 201, got {status} ({body})")
    closing_count_id = body["id"]
    print(
        "OK — opening count (12 L), a purchase (20 L) and wastage (1.5 L), then a closing count (8 L)."
    )

    # 100 Tea packs sold today (the window's only date) -> expected_used 20, gap_qty 2.5
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/sales/",
        {
            "business_date": business_date,
            "lines": [{"sell_item": tea_pack_id, "quantity": "100"}],
        },
        token=owner_access,
    )
    if status != 201 or len(body) != 1:
        fail(f"sales create: expected 201 with 1 line, got {status} ({body})")
    sale_id = body[0]["id"]
    if Decimal(body[0]["amount"]) != Decimal("2000.00"):
        fail(
            f"sales create: expected amount to default to quantity x price (2000.00), got {body[0]}"
        )
    print(
        "OK — recorded 100 Tea packs sold; amount defaulted to quantity x selling price."
    )

    status, body, _ = request(
        "GET",
        f"/businesses/{business_id}/counts/{closing_count_id}/",
        token=owner_access,
    )
    if status != 200:
        fail(f"sales flow: count review detail expected 200, got {status} ({body})")
    milk_line = next(line_ for line_ in body["lines"] if line_["stock_item"] == milk_id)
    if Decimal(milk_line["used_since_last_count"]) != Decimal("22.5"):
        fail(f"sales flow: expected used_since_last_count 22.5, got {milk_line}")
    if Decimal(milk_line["expected_used"]) != Decimal("20"):
        fail(f"sales flow: expected expected_used 20, got {milk_line}")
    if Decimal(milk_line["gap_qty"]) != Decimal("2.5"):
        fail(f"sales flow: expected gap_qty 2.5, got {milk_line}")
    if Decimal(milk_line["gap_value"]) != Decimal("160.00"):
        fail(f"sales flow: expected gap_value 160.00, got {milk_line}")
    if milk_line["gap_status"] != "ok" or milk_line["flagged"] is not True:
        fail(
            f"sales flow: expected gap_status ok and flagged true (12.5% > 10%), got {milk_line}"
        )
    print(
        "OK — count review shows expected_used 20, gap_qty 2.5, gap_value Rs 160, ok, flagged."
    )

    # a second, unrelated dish with no recipe at all (bulk create, no ingredients) doesn't touch
    # Milk's gap in any way — recipe_status=none only matters for stock items it actually names as
    # an ingredient, and this one names none.
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/sell-items/bulk/",
        {"items": [{"name": "Milk Shake", "selling_price": "40.00"}]},
        token=owner_access,
    )
    if status != 201 or body[0]["recipe_status"] != "none":
        fail(
            f"sales flow: second sell item create expected 201 recipe_status=none, got {status} ({body})"
        )

    status, body, _ = request(
        "GET",
        f"/businesses/{business_id}/counts/{closing_count_id}/",
        token=owner_access,
    )
    milk_line = next(line_ for line_ in body["lines"] if line_["stock_item"] == milk_id)
    if milk_line["gap_status"] != "ok" or Decimal(milk_line["gap_qty"]) != Decimal(
        "2.5"
    ):
        fail(
            f"sales flow: expected Milk's gap unaffected by an unlinked dish, got {milk_line}"
        )
    print(
        "OK — a second dish with no recipe at all doesn't affect an unrelated stock item's gap."
    )

    # delete the window's only sale -> not_comparable / sales_missing
    status, body, _ = request(
        "DELETE", f"/businesses/{business_id}/sales/{sale_id}/", token=owner_access
    )
    if status != 204:
        fail(f"sales flow: delete sale expected 204, got {status} ({body})")

    status, body, _ = request(
        "GET",
        f"/businesses/{business_id}/counts/{closing_count_id}/",
        token=owner_access,
    )
    milk_line = next(line_ for line_ in body["lines"] if line_["stock_item"] == milk_id)
    if (
        milk_line["gap_status"] != "not_comparable"
        or milk_line["gap_reason"]["code"] != "sales_missing"
    ):
        fail(f"sales flow: expected not_comparable/sales_missing, got {milk_line}")
    if milk_line["gap_reason"].get("dates") != [business_date]:
        fail(
            f"sales flow: expected sales_missing dates [{business_date}], got {milk_line['gap_reason']}"
        )
    print(
        "OK — deleting the window's only sale makes the gap not_comparable (sales_missing), with the date."
    )

    # a Manager can record sales but gets 403 on delete; a Helper gets 403 on every sales endpoint
    _, manager_access, _ = _add_team_member(
        business_id, owner_access, "Sales Manager", "manager"
    )
    _, helper_access, _ = _add_team_member(
        business_id, owner_access, "Sales Helper", "helper"
    )

    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/sales/",
        {
            "business_date": business_date,
            "lines": [{"sell_item": tea_pack_id, "quantity": "3"}],
        },
        token=manager_access,
    )
    if status != 201:
        fail(f"sales flow: manager create expected 201, got {status} ({body})")
    manager_sale_id = body[0]["id"]
    status, _, _ = request(
        "DELETE",
        f"/businesses/{business_id}/sales/{manager_sale_id}/",
        token=manager_access,
    )
    if status != 403:
        fail(f"sales flow: manager delete expected 403, got {status}")
    print("OK — a Manager can record sales but gets 403 on delete.")

    status, _, _ = request(
        "GET", f"/businesses/{business_id}/sales/", token=helper_access
    )
    if status != 403:
        fail(f"sales flow: helper list expected 403, got {status}")
    status, _, _ = request(
        "POST",
        f"/businesses/{business_id}/sales/",
        {
            "business_date": business_date,
            "lines": [{"sell_item": tea_pack_id, "quantity": "1"}],
        },
        token=helper_access,
    )
    if status != 403:
        fail(f"sales flow: helper create expected 403, got {status}")
    print("OK — a Helper gets 403 on every sales endpoint.")

    # a future-dated sale is rejected
    # +2 days, not +1 — a safety margin against UTC/IST date-boundary skew right at midnight.
    future_date = (datetime.now(dt_timezone.utc) + timedelta(days=2)).date().isoformat()
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/sales/",
        {
            "business_date": future_date,
            "lines": [{"sell_item": tea_pack_id, "quantity": "1"}],
        },
        token=owner_access,
    )
    if status not in (400, 422):
        fail(f"sales flow: future-dated sale expected rejection, got {status} ({body})")
    print("OK — a future-dated sale is rejected.")

    # the Owner deletes the Manager's sale and the summary updates
    status, body, _ = request(
        "GET", f"/businesses/{business_id}/sales/", token=owner_access
    )
    if status != 200:
        fail(f"sales flow: list expected 200, got {status} ({body})")
    before_items = Decimal(body["summary"]["items_sold_today"])
    status, _, _ = request(
        "DELETE",
        f"/businesses/{business_id}/sales/{manager_sale_id}/",
        token=owner_access,
    )
    if status != 204:
        fail(f"sales flow: owner delete expected 204, got {status}")
    status, body, _ = request(
        "GET", f"/businesses/{business_id}/sales/", token=owner_access
    )
    after_items = Decimal(body["summary"]["items_sold_today"])
    if after_items != before_items - Decimal("3"):
        fail(
            f"sales flow: summary should drop by 3 items after delete, {before_items} -> {after_items}"
        )
    ids = [s["id"] for s in body["results"]]
    if manager_sale_id in ids:
        fail(f"sales flow: deleted sale still in the list: {ids}")
    print("OK — the Owner soft-deletes a sale and the summary updates.")

    # Step 23d: the gap window is matched against sales using each count's plain local calendar
    # date (business/counts/gap.py's _local_date, from submitted_at), not StockCount's own
    # business_date field — which day_starts_hour can shift to the previous calendar day for a
    # count submitted in the early hours. A Sale's own business_date is always the plain calendar
    # date (sales/views.py's _business_today), so matching on the shifted field would silently drop
    # a sale recorded under "today" whenever this test happened to run between midnight and
    # day_starts_hour. day_starts_hour: 5 here (the real default) deliberately leaves that gap in
    # place; the window is built from submitted_at either way, so this passes regardless of what
    # time of day the suite runs — the sale's business_date (today's plain calendar date, computed
    # the same way sales/views.py does) is what must land inside it, not the count's own
    # (possibly shifted) business_date.
    _, gw_owner_access, _ = signup_and_login("Gap Window Owner")
    status, body, _ = request(
        "POST",
        "/businesses/",
        {"name": "Gap Window Biz", "business_type": "cloud_kitchen", "city": "Pune"},
        token=gw_owner_access,
    )
    if status != 201:
        fail(f"sales flow: gap window business create expected 201, got {status} ({body})")
    gw_business_id = body["id"]
    status, body, _ = request(
        "PATCH",
        f"/businesses/{gw_business_id}/settings/",
        {"day_starts_hour": 5},
        token=gw_owner_access,
    )
    if status != 200:
        fail(f"sales flow: gap window settings patch expected 200, got {status} ({body})")

    status, body, _ = request(
        "POST",
        f"/businesses/{gw_business_id}/stock-items/bulk/",
        {"items": [{"name": "Paneer", "unit": "kg"}]},
        token=gw_owner_access,
    )
    if status != 201:
        fail(f"sales flow: gap window stock bulk create expected 201, got {status} ({body})")
    paneer_id = body[0]["id"]
    combo_id, _ = _create_dish(
        gw_business_id, gw_owner_access, "Paneer Combo", "150.00", [(paneer_id, "1.5")]
    )

    status, body, _ = request(
        "POST",
        f"/businesses/{gw_business_id}/counts/",
        {"type": "opening", "lines": [{"stock_item": paneer_id, "state": "counted", "counted_qty": "10"}]},
        token=gw_owner_access,
    )
    if status != 201:
        fail(f"sales flow: gap window opening count expected 201, got {status} ({body})")

    status, body, _ = request(
        "POST",
        f"/businesses/{gw_business_id}/purchases/",
        {
            "supplier_name": "Dairy Co",
            "purchase_date_time": _now_iso(),
            "lines": [
                {"stock_item": paneer_id, "quantity": "5", "unit_price": "50", "line_total": "250"}
            ],
        },
        token=gw_owner_access,
    )
    if status != 201:
        fail(f"sales flow: gap window purchase expected 201, got {status} ({body})")
    status, body, _ = request(
        "POST",
        f"/businesses/{gw_business_id}/wastage/",
        {"stock_item": paneer_id, "quantity": "1", "reason": "spillage"},
        token=gw_owner_access,
    )
    if status != 201:
        fail(f"sales flow: gap window wastage expected 201, got {status} ({body})")

    # closing count: Paneer 6 kg -> used_since_last_count = 10 + 5 - 1 - 6 = 8
    status, body, _ = request(
        "POST",
        f"/businesses/{gw_business_id}/counts/",
        {"type": "closing", "lines": [{"stock_item": paneer_id, "state": "counted", "counted_qty": "6"}]},
        token=gw_owner_access,
    )
    if status != 201:
        fail(f"sales flow: gap window closing count expected 201, got {status} ({body})")
    gw_closing_id = body["id"]

    # the sale is dated "today" the same way sales/views.py's own _business_today works — not via
    # the closing count's own (possibly day_starts_hour-shifted) business_date.
    plain_today = datetime.now(ZoneInfo("Asia/Kolkata")).date().isoformat()
    status, body, _ = request(
        "POST",
        f"/businesses/{gw_business_id}/sales/",
        {
            "business_date": plain_today,
            "lines": [{"sell_item": combo_id, "quantity": "2"}],
        },
        token=gw_owner_access,
    )
    if status != 201:
        fail(f"sales flow: gap window sale create expected 201, got {status} ({body})")

    status, body, _ = request(
        "GET",
        f"/businesses/{gw_business_id}/counts/{gw_closing_id}/",
        token=gw_owner_access,
    )
    if status != 200:
        fail(f"sales flow: gap window count detail expected 200, got {status} ({body})")
    paneer_line = next(line_ for line_ in body["lines"] if line_["stock_item"] == paneer_id)
    if paneer_line["gap_status"] != "ok":
        fail(
            "sales flow: expected the plain-calendar-dated sale to land inside the gap window "
            f"regardless of day_starts_hour, got {paneer_line}"
        )
    if Decimal(paneer_line["expected_used"]) != Decimal("3"):
        fail(f"sales flow: expected expected_used 3 (2 combos x 1.5 kg), got {paneer_line}")
    if Decimal(paneer_line["gap_qty"]) != Decimal("5"):
        fail(f"sales flow: expected gap_qty 5 (used 8 - expected 3), got {paneer_line}")
    print("OK — the gap window matches sales by plain calendar date, not the shifted business_date.")


def check_alerts_flow() -> None:
    # closing_late + price_rise + wastage_high all live on one business — a submitted opening count
    # is unavoidably needed as the "previous" data point for any gap_flagged line (the only other
    # count slot in a day), so getting a closing_late alert in the same business as gap_flagged in the
    # same GET is structurally impossible via the real API; gap_flagged gets its own business below,
    # reusing the exact Step 14 numbers.
    _, owner_access, _ = signup_and_login("Alerts Owner")
    status, body, _ = request(
        "POST",
        "/businesses/",
        {"name": "Alerts Test Biz", "business_type": "cloud_kitchen", "city": "Pune"},
        token=owner_access,
    )
    if status != 201:
        fail(f"alerts flow: business create expected 201, got {status} ({body})")
    business_id = body["id"]

    # closing late today; opening's deadline pushed to the end of the day (not yet passed, whatever
    # time this script happens to run) so exactly one closing_late alert fires, deterministically.
    # day_starts_hour: 0 keeps business_date the plain calendar date, so "today 23:00" can't
    # already belong to yesterday's (already-passed) business date overnight — see the same note
    # in check_sales_and_gap_flow.
    status, body, _ = request(
        "PATCH",
        f"/businesses/{business_id}/settings/",
        {"day_starts_hour": 0, "closing_count_hour": 0, "count_deadline_hour": 23},
        token=owner_access,
    )
    if status != 200:
        fail(f"alerts flow: settings patch expected 200, got {status} ({body})")

    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/stock-items/bulk/",
        {
            "items": [
                {"name": "Flour", "unit": "kg"},
                {"name": "Cooking Oil", "unit": "L"},
            ]
        },
        token=owner_access,
    )
    if status != 201:
        fail(f"alerts flow: stock bulk create expected 201, got {status} ({body})")
    flour_id = next(i["id"] for i in body if i["name"] == "Flour")
    oil_id = next(i["id"] for i in body if i["name"] == "Cooking Oil")

    # Step 23d: closing_late can't fire for a business that has never counted anything — give it an
    # opening count for today first (count_deadline_hour: 23 is still hours away, so this isn't
    # itself late), so the closing_late trip below is about today's missing closing, not the
    # business's first-ever count.
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/counts/",
        {
            "type": "opening",
            "lines": [
                {"stock_item": flour_id, "state": "skipped"},
                {"stock_item": oil_id, "state": "skipped"},
            ],
        },
        token=owner_access,
    )
    if status != 201:
        fail(f"alerts flow: opening count expected 201, got {status} ({body})")

    # price_rise: two purchases at 60, then one at 70 — default rate_creep_pct is 10, and
    # (70-60)/60 = 16.67% > 10%
    for price in ("60", "60", "70"):
        status, body, _ = request(
            "POST",
            f"/businesses/{business_id}/purchases/",
            {
                "supplier_name": "Flour Mill",
                "purchase_date_time": _now_iso(),
                "lines": [
                    {
                        "stock_item": flour_id,
                        "quantity": "10",
                        "unit_price": price,
                        "line_total": str(10 * int(price)),
                    }
                ],
            },
            token=owner_access,
        )
        if status != 201:
            fail(
                f"alerts flow: flour purchase at {price} expected 201, got {status} ({body})"
            )

    # wastage_high: 2 L wasted against 20 L bought — default wastage_alert_pct is 5, and 2/20 = 10%
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/purchases/",
        {
            "supplier_name": "Oil Depot",
            "purchase_date_time": _now_iso(),
            "lines": [
                {
                    "stock_item": oil_id,
                    "quantity": "20",
                    "unit_price": "150",
                    "line_total": "3000",
                }
            ],
        },
        token=owner_access,
    )
    if status != 201:
        fail(f"alerts flow: oil purchase expected 201, got {status} ({body})")
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/wastage/",
        {"stock_item": oil_id, "quantity": "2", "reason": "spillage"},
        token=owner_access,
    )
    if status != 201:
        fail(f"alerts flow: oil wastage expected 201, got {status} ({body})")

    status, body, _ = request(
        "GET", f"/businesses/{business_id}/alerts/", token=owner_access
    )
    if status != 200:
        fail(f"alerts flow: list expected 200, got {status} ({body})")
    by_type = {a["type"]: a for a in body["results"]}
    if set(by_type) != {"closing_late", "price_rise", "wastage_high"}:
        fail(
            f"alerts flow: expected closing_late/price_rise/wastage_high, got {set(by_type)}"
        )
    if body["counts"]["total"] != 3:
        fail(f"alerts flow: expected 3 total alerts, got {body['counts']}")
    if (
        by_type["closing_late"]["severity"] != "warning"
        or by_type["wastage_high"]["severity"] != "warning"
    ):
        fail(
            f"alerts flow: expected closing_late/wastage_high severity warning, got {by_type}"
        )
    if by_type["price_rise"]["severity"] != "danger":
        fail(
            f"alerts flow: expected price_rise severity danger, got {by_type['price_rise']}"
        )
    if Decimal(by_type["price_rise"]["numbers"]["pct_increase"]) != Decimal("16.67"):
        fail(
            f"alerts flow: expected price_rise pct_increase 16.67, got {by_type['price_rise']}"
        )
    if Decimal(by_type["wastage_high"]["numbers"]["pct"]) != Decimal("10.00"):
        fail(
            f"alerts flow: expected wastage_high pct 10.00, got {by_type['wastage_high']}"
        )
    if by_type["price_rise"]["next_action"]["route"] != f"/stock/{flour_id}":
        fail(
            f"alerts flow: expected price_rise route /stock/{flour_id}, got {by_type['price_rise']}"
        )
    if by_type["closing_late"]["next_action"]["label"] != "Prepare reminder":
        fail(
            f"alerts flow: expected Owner's closing_late action 'Prepare reminder', got {by_type['closing_late']}"
        )
    print(
        "OK — one business trips closing_late, price_rise and wastage_high with the right severities and numbers."
    )

    status, body, _ = request(
        "GET", f"/businesses/{business_id}/today/", token=owner_access
    )
    if status != 200 or body.get("alerts_count") != 3:
        fail(f"alerts flow: today expected alerts_count 3, got {status} ({body})")
    print("OK — GET today/ carries the same alerts_count for the Owner.")

    # check the wastage_high alert -> it disappears and the counts drop
    wastage_key = by_type["wastage_high"]["key"]
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/alerts/check/",
        {"key": wastage_key},
        token=owner_access,
    )
    if status != 204:
        fail(f"alerts flow: check expected 204, got {status} ({body})")
    status, body, _ = request(
        "GET", f"/businesses/{business_id}/alerts/", token=owner_access
    )
    if body["counts"]["total"] != 2 or body["counts"]["wastage_high"] != 0:
        fail(
            f"alerts flow: expected total 2 and wastage_high 0 after check, got {body['counts']}"
        )
    if wastage_key in {a["key"] for a in body["results"]}:
        fail(f"alerts flow: checked alert still present, got {body['results']}")
    print("OK — checking an alert hides it and the counts drop.")

    # re-checking the same key is rejected (no longer open)
    status, _, _ = request(
        "POST",
        f"/businesses/{business_id}/alerts/check/",
        {"key": wastage_key},
        token=owner_access,
    )
    if status not in (400, 422):
        fail(
            f"alerts flow: re-check of a closed alert expected rejection, got {status}"
        )

    _, helper_access, _ = _add_team_member(
        business_id, owner_access, "Alerts Helper", "helper"
    )
    status, _, _ = request(
        "GET", f"/businesses/{business_id}/alerts/", token=helper_access
    )
    if status != 403:
        fail(f"alerts flow: helper list expected 403, got {status}")
    status, _, _ = request(
        "POST",
        f"/businesses/{business_id}/alerts/check/",
        {"key": by_type["closing_late"]["key"]},
        token=helper_access,
    )
    if status != 403:
        fail(f"alerts flow: helper check expected 403, got {status}")
    status, helper_today, _ = request(
        "GET", f"/businesses/{business_id}/today/", token=helper_access
    )
    if "alerts_count" in helper_today:
        fail("alerts flow: helper's today should carry no alerts_count")
    print("OK — a Helper gets 403 on alerts, and sees no alerts_count on today.")

    _, manager_access, _ = _add_team_member(
        business_id, owner_access, "Alerts Manager", "manager"
    )
    status, body, _ = request(
        "GET", f"/businesses/{business_id}/alerts/", token=manager_access
    )
    if status != 200 or body["counts"]["total"] != 2:
        fail(
            f"alerts flow: manager list expected 200 with total 2, got {status} ({body})"
        )
    status, _, _ = request(
        "POST",
        f"/businesses/{business_id}/alerts/check/",
        {"key": by_type["price_rise"]["key"]},
        token=manager_access,
    )
    if status != 204:
        fail(f"alerts flow: manager check expected 204, got {status}")
    status, body, _ = request(
        "GET", f"/businesses/{business_id}/alerts/", token=manager_access
    )
    if body["counts"]["total"] != 1:
        fail(
            f"alerts flow: expected total 1 after manager's check, got {body['counts']}"
        )
    print("OK — a Manager can view and check alerts.")

    # gap_flagged: its own business, exact Step 14 numbers (12 L opening, 20 L bought, 1.5 L wasted,
    # 8 L closing, 100 Tea packs sold -> gap_qty 2.5, 12.5% over the 10% default -> flagged)
    _, gap_owner_access, _ = signup_and_login("Gap Alert Owner")
    status, body, _ = request(
        "POST",
        "/businesses/",
        {"name": "Gap Alert Biz", "business_type": "cloud_kitchen", "city": "Pune"},
        token=gap_owner_access,
    )
    if status != 201:
        fail(f"alerts flow: gap business create expected 201, got {status} ({body})")
    gap_business_id = body["id"]

    status, body, _ = request(
        "POST",
        f"/businesses/{gap_business_id}/stock-items/bulk/",
        {"items": [{"name": "Milk", "unit": "L"}]},
        token=gap_owner_access,
    )
    milk_id = body[0]["id"]
    tea_pack_id, _ = _create_dish(
        gap_business_id, gap_owner_access, "Tea pack", "20.00", [(milk_id, "0.200")]
    )

    status, body, _ = request(
        "POST",
        f"/businesses/{gap_business_id}/counts/",
        {
            "type": "opening",
            "lines": [{"stock_item": milk_id, "state": "counted", "counted_qty": "12"}],
        },
        token=gap_owner_access,
    )
    business_date = body["business_date"]
    request(
        "POST",
        f"/businesses/{gap_business_id}/purchases/",
        {
            "supplier_name": "Dairy Co",
            "purchase_date_time": _now_iso(),
            "lines": [
                {
                    "stock_item": milk_id,
                    "quantity": "20",
                    "unit_price": "64",
                    "line_total": "1280",
                }
            ],
        },
        token=gap_owner_access,
    )
    request(
        "POST",
        f"/businesses/{gap_business_id}/wastage/",
        {"stock_item": milk_id, "quantity": "1.5", "reason": "spillage"},
        token=gap_owner_access,
    )
    status, body, _ = request(
        "POST",
        f"/businesses/{gap_business_id}/counts/",
        {
            "type": "closing",
            "lines": [{"stock_item": milk_id, "state": "counted", "counted_qty": "8"}],
        },
        token=gap_owner_access,
    )
    closing_count_id = body["id"]
    status, body, _ = request(
        "POST",
        f"/businesses/{gap_business_id}/sales/",
        {
            "business_date": business_date,
            "lines": [{"sell_item": tea_pack_id, "quantity": "100"}],
        },
        token=gap_owner_access,
    )
    if status != 201:
        fail(f"alerts flow: gap sale expected 201, got {status} ({body})")

    status, body, _ = request(
        "GET", f"/businesses/{gap_business_id}/alerts/", token=gap_owner_access
    )
    if status != 200:
        fail(f"alerts flow: gap alerts list expected 200, got {status} ({body})")
    gap_alerts = [a for a in body["results"] if a["type"] == "gap_flagged"]
    if len(gap_alerts) != 1:
        fail(
            f"alerts flow: expected exactly 1 gap_flagged alert, got {body['results']}"
        )
    gap_alert = gap_alerts[0]
    if gap_alert["severity"] != "danger":
        fail(f"alerts flow: expected gap_flagged severity danger, got {gap_alert}")
    if Decimal(gap_alert["numbers"]["gap_qty"]) != Decimal("2.5"):
        fail(f"alerts flow: expected gap_qty 2.5, got {gap_alert}")
    if gap_alert["next_action"]["route"] != f"/counts/{closing_count_id}":
        fail(
            f"alerts flow: expected gap_flagged route /counts/{closing_count_id}, got {gap_alert}"
        )
    print(
        "OK — a separate business's flagged gap line surfaces as a danger-severity gap_flagged alert."
    )


def check_expiry_alerts_flow() -> None:
    """Step 18: expiry_soon. One business, three stock items covering the worked cases:
    (a) Tomatoes — bought 10 kg 4 days ago, counted 4 kg today -> danger (its only batch, 1 day past
        its 3-day shelf life).
    (b) Paneer — an old 4 kg batch from 7 days ago plus a fresh 10 kg batch bought today, counted 14
        kg (both still on hand) -> the FIFO walk has to dig past the fresh batch into the old one to
        cover the count, so the old batch is what gets flagged, not the fresh one.
    (c) Milk — not marked as going off at all (Step 19 requires a shelf life whenever that's
        on, so "perishable with no shelf life" isn't a reachable state via the API any more) ->
        never alerts, however old its purchase.
    All three share one closing count (one call, one line per item), since compute_alerts looks at
    each item's own latest count independently.
    """
    _, owner_access, _ = signup_and_login("Expiry Alert Owner")
    status, body, _ = request(
        "POST",
        "/businesses/",
        {"name": "Expiry Alert Biz", "business_type": "cloud_kitchen", "city": "Pune"},
        token=owner_access,
    )
    if status != 201:
        fail(f"expiry flow: business create expected 201, got {status} ({body})")
    business_id = body["id"]

    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/stock-items/bulk/",
        {
            "items": [
                {
                    "name": "Tomatoes",
                    "unit": "kg",
                    "goes_off": True,
                    "shelf_life_days": 3,
                },
                {
                    "name": "Paneer",
                    "unit": "kg",
                    "goes_off": True,
                    "shelf_life_days": 3,
                },
                {"name": "Milk", "unit": "L"},
            ]
        },
        token=owner_access,
    )
    if status != 201:
        fail(f"expiry flow: stock bulk create expected 201, got {status} ({body})")
    tomatoes_id = next(i["id"] for i in body if i["name"] == "Tomatoes")
    paneer_id = next(i["id"] for i in body if i["name"] == "Paneer")
    milk_id = next(i["id"] for i in body if i["name"] == "Milk")

    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/purchases/",
        {
            "supplier_name": "Veg Market",
            "purchase_date_time": _days_ago_iso(4),
            "lines": [
                {
                    "stock_item": tomatoes_id,
                    "quantity": "10",
                    "unit_price": "50",
                    "line_total": "500",
                }
            ],
        },
        token=owner_access,
    )
    if status != 201:
        fail(f"expiry flow: tomatoes purchase expected 201, got {status} ({body})")

    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/purchases/",
        {
            "supplier_name": "Dairy Co",
            "purchase_date_time": _days_ago_iso(7),
            "lines": [
                {
                    "stock_item": paneer_id,
                    "quantity": "4",
                    "unit_price": "100",
                    "line_total": "400",
                }
            ],
        },
        token=owner_access,
    )
    if status != 201:
        fail(f"expiry flow: paneer old purchase expected 201, got {status} ({body})")
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/purchases/",
        {
            "supplier_name": "Dairy Co",
            "purchase_date_time": _now_iso(),
            "lines": [
                {
                    "stock_item": paneer_id,
                    "quantity": "10",
                    "unit_price": "100",
                    "line_total": "1000",
                }
            ],
        },
        token=owner_access,
    )
    if status != 201:
        fail(f"expiry flow: paneer fresh purchase expected 201, got {status} ({body})")

    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/purchases/",
        {
            "supplier_name": "Dairy Co",
            "purchase_date_time": _days_ago_iso(10),
            "lines": [
                {
                    "stock_item": milk_id,
                    "quantity": "5",
                    "unit_price": "20",
                    "line_total": "100",
                }
            ],
        },
        token=owner_access,
    )
    if status != 201:
        fail(f"expiry flow: milk purchase expected 201, got {status} ({body})")

    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/counts/",
        {
            # Step 23d: this is the business's first-ever count, which can only be an opening —
            # expiry_soon only cares about the latest *counted* line for each item, never the
            # count type, so this is otherwise identical to the "closing" count this used to be.
            "type": "opening",
            "lines": [
                {"stock_item": tomatoes_id, "state": "counted", "counted_qty": "4"},
                {"stock_item": paneer_id, "state": "counted", "counted_qty": "14"},
                {"stock_item": milk_id, "state": "counted", "counted_qty": "2"},
            ],
        },
        token=owner_access,
    )
    if status != 201:
        fail(f"expiry flow: opening count expected 201, got {status} ({body})")

    status, body, _ = request(
        "GET", f"/businesses/{business_id}/alerts/", token=owner_access
    )
    if status != 200:
        fail(f"expiry flow: alerts list expected 200, got {status} ({body})")
    by_item = {
        a["numbers"]["item_name"]: a
        for a in body["results"]
        if a["type"] == "expiry_soon"
    }

    if set(by_item) != {"Tomatoes", "Paneer"}:
        fail(
            f"expiry flow: expected expiry_soon for Tomatoes and Paneer only, got {set(by_item)}"
        )
    print(
        "OK — expiry_soon fires for Tomatoes and Paneer, and never for Milk (no shelf_life_days)."
    )

    tomatoes_alert = by_item["Tomatoes"]
    if tomatoes_alert["severity"] != "danger":
        fail(f"expiry flow: expected Tomatoes severity danger, got {tomatoes_alert}")
    if Decimal(tomatoes_alert["numbers"]["at_risk_qty"]) != Decimal("4.000"):
        fail(f"expiry flow: expected Tomatoes at_risk_qty 4.000, got {tomatoes_alert}")
    if tomatoes_alert["numbers"]["days_left"] != -1:
        fail(f"expiry flow: expected Tomatoes days_left -1, got {tomatoes_alert}")
    print(
        "OK — (a) a 3-day-shelf-life item bought 4 days ago, counted down to its only batch, "
        "is a danger alert."
    )

    paneer_alert = by_item["Paneer"]
    if paneer_alert["severity"] != "danger":
        fail(f"expiry flow: expected Paneer severity danger, got {paneer_alert}")
    if Decimal(paneer_alert["numbers"]["at_risk_qty"]) != Decimal("4.000"):
        fail(
            "expiry flow: expected Paneer at_risk_qty 4.000 (the OLD batch, not the fresh 10 kg), "
            f"got {paneer_alert}"
        )
    print(
        "OK — (b) counting past a fresh purchase into an older batch flags that older batch, "
        "not the fresh one."
    )

    # (d) Head chef has no alerts.view at all (same gate as every other alert type) — 403, so they
    # structurally never see any alert, money or otherwise.
    _, head_chef_access, _ = _add_team_member(
        business_id, owner_access, "Expiry Head Chef", "head_chef"
    )
    status, _, _ = request(
        "GET", f"/businesses/{business_id}/alerts/", token=head_chef_access
    )
    if status != 403:
        fail(f"expiry flow: head chef alerts list expected 403, got {status}")
    print(
        "OK — (d) a Head chef gets 403 on alerts, same as every other alert type — never sees money."
    )


def _check_reports_unit_family_rollup() -> None:
    """Step U1b-3b-2: wastage entries typed in kg and L (packaged as weight/volume, not the item's
    stored base unit) must still roll up correctly in the wastage trend's quantity_by_family —
    this is what used to read the stale "L" key and get 0 after the base-unit migration moved
    storage to g/ml."""
    _, owner_access, _ = signup_and_login("Reports Rollup Owner")
    status, body, _ = request(
        "POST",
        "/businesses/",
        {"name": "Reports Rollup Biz", "business_type": "cloud_kitchen", "city": "Pune"},
        token=owner_access,
    )
    if status != 201:
        fail(f"reports rollup flow: business create expected 201, got {status} ({body})")
    business_id = body["id"]

    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/stock-items/bulk/",
        {"items": [{"name": "Rice", "unit": "kg"}, {"name": "Oil", "unit": "L"}]},
        token=owner_access,
    )
    if status != 201:
        fail(f"reports rollup flow: stock items create expected 201, got {status} ({body})")
    rice_id, oil_id = body[0]["id"], body[1]["id"]

    for stock_item_id, qty, entry_unit in ((rice_id, "2", "kg"), (oil_id, "1.2", "L")):
        status, body, _ = request(
            "POST",
            f"/businesses/{business_id}/wastage/",
            {
                "stock_item": stock_item_id,
                "quantity": qty,
                "entry_unit": entry_unit,
                "reason": "spillage",
            },
            token=owner_access,
        )
        if status != 201:
            fail(f"reports rollup flow: wastage create expected 201, got {status} ({body})")

    status, body, _ = request(
        "GET",
        f"/businesses/{business_id}/reports/summary/?period=today",
        token=owner_access,
    )
    if status != 200:
        fail(f"reports rollup flow: summary expected 200, got {status} ({body})")

    family = body["wastage_trend"]["total"]["quantity_by_family"]
    weight = family.get("weight")
    volume = family.get("volume")
    if weight is None or Decimal(weight["base_qty"]) != Decimal("2000"):
        fail(f"reports rollup flow: expected weight base_qty 2000 (2 kg), got {weight}")
    if weight["display_unit"] != "kg" or Decimal(weight["display_qty"]) != Decimal("2"):
        fail(f"reports rollup flow: expected weight display 2 kg, got {weight}")
    if volume is None or Decimal(volume["base_qty"]) != Decimal("1200"):
        fail(f"reports rollup flow: expected volume base_qty 1200 (1.2 L), got {volume}")
    if volume["display_unit"] != "L" or Decimal(volume["display_qty"]) != Decimal("1.2"):
        fail(f"reports rollup flow: expected volume display 1.2 L, got {volume}")
    print(
        "OK — wastage entries typed in kg/L roll up correctly in the report's quantity_by_family "
        "(2 kg -> weight 2000 g, 1.2 L -> volume 1200 ml)."
    )


def check_reports_flow() -> None:
    _, owner_access, _ = signup_and_login("Reports Owner")
    status, body, _ = request(
        "POST",
        "/businesses/",
        {"name": "Reports Test Biz", "business_type": "cloud_kitchen", "city": "Pune"},
        token=owner_access,
    )
    if status != 201:
        fail(f"reports flow: business create expected 201, got {status} ({body})")
    business_id = body["id"]

    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/stock-items/bulk/",
        {"items": [{"name": "Milk", "unit": "L"}, {"name": "Flour", "unit": "kg"}]},
        token=owner_access,
    )
    if status != 201:
        fail(f"reports flow: stock items create expected 201, got {status} ({body})")
    milk_id = body[0]["id"]
    flour_id = body[1]["id"]

    tea_pack_id, _ = _create_dish(
        business_id, owner_access, "Tea pack", "20.00", [(milk_id, "0.200")]
    )

    opening_lines = [
        {"stock_item": milk_id, "state": "counted", "counted_qty": "12"},
        {"stock_item": flour_id, "state": "skipped"},
    ]
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/counts/",
        {"type": "opening", "lines": opening_lines},
        token=owner_access,
    )
    if status != 201:
        fail(f"reports flow: opening count expected 201, got {status} ({body})")
    business_date = body["business_date"]

    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/purchases/",
        {
            "supplier_name": "Dairy Co",
            "purchase_date_time": _now_iso(),
            "lines": [
                {
                    "stock_item": milk_id,
                    "quantity": "20",
                    "unit_price": "64",
                    "line_total": "1280",
                }
            ],
        },
        token=owner_access,
    )
    if status != 201:
        fail(f"reports flow: milk purchase expected 201, got {status} ({body})")

    # Flour's own 60 -> 70 price history — kept off Milk so the gap_value below stays tied to Milk's
    # *last* purchase price (64), same rule alerts.gap_flagged already relies on; a 60 -> 70 Milk
    # history would move that to 70 and break the Rs 160 figure.
    older = (datetime.now(dt_timezone.utc) - timedelta(days=2)).isoformat()
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/purchases/",
        {
            "supplier_name": "Mill Co",
            "purchase_date_time": older,
            "lines": [
                {
                    "stock_item": flour_id,
                    "quantity": "10",
                    "unit_price": "60",
                    "line_total": "600",
                }
            ],
        },
        token=owner_access,
    )
    if status != 201:
        fail(f"reports flow: flour purchase 1 expected 201, got {status} ({body})")
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/purchases/",
        {
            "supplier_name": "Mill Co",
            "purchase_date_time": _now_iso(),
            "lines": [
                {
                    "stock_item": flour_id,
                    "quantity": "10",
                    "unit_price": "70",
                    "line_total": "700",
                }
            ],
        },
        token=owner_access,
    )
    if status != 201:
        fail(f"reports flow: flour purchase 2 expected 201, got {status} ({body})")

    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/wastage/",
        {"stock_item": milk_id, "quantity": "1.5", "reason": "spillage"},
        token=owner_access,
    )
    if status != 201:
        fail(f"reports flow: wastage expected 201, got {status} ({body})")

    closing_lines = [
        {"stock_item": milk_id, "state": "counted", "counted_qty": "8"},
        {"stock_item": flour_id, "state": "skipped"},
    ]
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/counts/",
        {"type": "closing", "lines": closing_lines},
        token=owner_access,
    )
    if status != 201:
        fail(f"reports flow: closing count expected 201, got {status} ({body})")

    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/sales/",
        {
            "business_date": business_date,
            "lines": [{"sell_item": tea_pack_id, "quantity": "100"}],
        },
        token=owner_access,
    )
    if status != 201:
        fail(f"reports flow: sale expected 201, got {status} ({body})")
    if Decimal(body[0]["amount"]) != Decimal("2000.00"):
        fail(f"reports flow: expected sale amount 2000.00, got {body}")
    print(
        "OK — Reports Test Biz seeded: Milk's 160 gap, Flour's 60 -> 70 price rise, a 2000 sale."
    )

    status, body, _ = request(
        "GET",
        f"/businesses/{business_id}/reports/summary/?period=7d",
        token=owner_access,
    )
    if status != 200:
        fail(f"reports flow: summary expected 200, got {status} ({body})")

    money_went = body["money_went"]
    if Decimal(money_went["total"]["gap_value"]) != Decimal("160.00"):
        fail(
            f"reports flow: expected money_went gap_value 160.00, got {money_went['total']}"
        )
    if Decimal(money_went["total"]["bought"]) != Decimal("2580.00"):
        fail(
            f"reports flow: expected money_went bought 2580.00, got {money_went['total']}"
        )
    if Decimal(money_went["total"]["wastage_value"]) != Decimal("96.00"):
        fail(
            f"reports flow: expected money_went wastage_value 96.00, got {money_went['total']}"
        )
    print("OK — money_went totals (bought 2580, wastage 96, gap 160) add up over 7d.")

    biggest_gaps = body["biggest_gaps"]["items"]
    if len(biggest_gaps) != 1 or biggest_gaps[0]["name"] != "Milk":
        fail(
            f"reports flow: expected biggest_gaps to show only Milk, got {biggest_gaps}"
        )
    if Decimal(biggest_gaps[0]["value"]) != Decimal("160.00"):
        fail(
            f"reports flow: expected Milk's biggest_gaps value 160.00, got {biggest_gaps}"
        )
    print("OK — biggest_gaps shows Milk at Rs 160.")

    used_vs_expected = body["used_vs_expected"]["items"]
    if len(used_vs_expected) != 1 or used_vs_expected[0]["name"] != "Milk":
        fail(
            f"reports flow: expected used_vs_expected to show only Milk, got {used_vs_expected}"
        )
    milk_row = used_vs_expected[0]
    if Decimal(milk_row["used"]) != Decimal("22.5") or Decimal(
        milk_row["expected"]
    ) != Decimal("20"):
        fail(f"reports flow: expected Milk used 22.5 / expected 20, got {milk_row}")
    print("OK — used_vs_expected shows Milk's used 22.5 against expected 20.")

    price_trend = body["price_trend"]
    if price_trend["item"] is None or price_trend["item"]["name"] != "Flour":
        fail(
            f"reports flow: expected price_trend's default item to be Flour, got {price_trend['item']}"
        )
    prices = [Decimal(point["unit_price"]) for point in price_trend["points"]]
    if prices != [Decimal("60.00"), Decimal("70.00")]:
        fail(f"reports flow: expected Flour's prices [60, 70], got {prices}")
    if Decimal(price_trend["pct_change"]) != Decimal("16.7"):
        fail(
            f"reports flow: expected Flour's pct_change 16.7, got {price_trend['pct_change']}"
        )
    print("OK — price_trend defaults to Flour's 60 -> 70 rise, +16.7%.")

    sales_vs_cost = body["sales_vs_cost"]
    if Decimal(sales_vs_cost["total"]["sales"]) != Decimal("2000.00"):
        fail(
            f"reports flow: expected sales total 2000.00, got {sales_vs_cost['total']}"
        )
    if Decimal(sales_vs_cost["total"]["cost"]) != Decimal("1280.00"):
        fail(f"reports flow: expected cost total 1280.00, got {sales_vs_cost['total']}")
    if Decimal(sales_vs_cost["cost_pct"]) != Decimal("64.0"):
        fail(f"reports flow: expected cost_pct 64.0, got {sales_vs_cost['cost_pct']}")
    print("OK — sales_vs_cost: (100 x 0.2 x 64) / 2000 = 64.0% cost.")

    wastage_trend = body["wastage_trend"]
    volume_total = wastage_trend["total"]["quantity_by_family"].get("volume")
    if volume_total is None or Decimal(volume_total["base_qty"]) != Decimal("1.5"):
        fail(
            f"reports flow: expected wastage_trend volume base_qty 1.5, got {wastage_trend['total']}"
        )
    if volume_total["display_unit"] != "ml" or Decimal(volume_total["display_qty"]) != Decimal(
        "1.5"
    ):
        fail(f"reports flow: expected wastage_trend volume display 1.5 ml, got {volume_total}")
    bucket_qty_total = sum(
        Decimal(bucket["quantity_by_family"].get("volume", {}).get("base_qty", "0"))
        for bucket in wastage_trend["buckets"]
    )
    if bucket_qty_total != Decimal("1.5"):
        fail(
            f"reports flow: expected wastage_trend buckets to add up to 1.5, got {bucket_qty_total}"
        )
    print("OK — wastage_trend's bucket quantities add up to the period total.")

    _check_reports_unit_family_rollup()

    _, helper_access, _ = _add_team_member(
        business_id, owner_access, "Reports Helper", "helper"
    )
    status, _, _ = request(
        "GET",
        f"/businesses/{business_id}/reports/summary/?period=7d",
        token=helper_access,
    )
    if status != 403:
        fail(f"reports flow: helper summary expected 403, got {status}")
    print("OK — a Helper gets 403 on the reports endpoint.")

    _, fresh_owner_access, _ = signup_and_login("Reports Fresh Owner")
    status, body, _ = request(
        "POST",
        "/businesses/",
        {"name": "Reports Empty Biz", "business_type": "cloud_kitchen", "city": "Pune"},
        token=fresh_owner_access,
    )
    if status != 201:
        fail(f"reports flow: fresh business create expected 201, got {status} ({body})")
    fresh_business_id = body["id"]

    status, body, _ = request(
        "GET",
        f"/businesses/{fresh_business_id}/reports/summary/?period=7d",
        token=fresh_owner_access,
    )
    if status != 200:
        fail(
            f"reports flow: empty business summary expected 200, got {status} ({body})"
        )
    if Decimal(body["money_went"]["total"]["bought"]) != Decimal("0.00"):
        fail(
            f"reports flow: expected empty business money_went bought 0.00, got {body['money_went']}"
        )
    if body["biggest_gaps"]["items"] != [] or body["used_vs_expected"]["items"] != []:
        fail(f"reports flow: expected empty business gap lists empty, got {body}")
    if body["price_trend"]["item"] is not None or body["price_trend"]["points"] != []:
        fail(
            f"reports flow: expected empty business price_trend empty, got {body['price_trend']}"
        )
    if body["sales_vs_cost"]["cost_pct"] is not None:
        fail(
            f"reports flow: expected empty business cost_pct null, got {body['sales_vs_cost']}"
        )
    print(
        "OK — a brand-new business returns every report block present but empty, no errors."
    )


def check_pincode_geo_flow() -> None:
    _, access, _ = signup_and_login("Pincode Owner")

    # a known pincode
    status, body, _ = request("GET", "/geo/pincode/560034/", token=access)
    if status != 200:
        fail(f"pincode lookup: expected HTTP 200, got {status} ({body})")
    if body.get("state") != "Karnataka" or "Bengaluru" not in body.get("districts", []):
        fail(f"pincode lookup: expected Karnataka/Bengaluru, got {body}")
    if "Koramangala" not in body.get("areas", []):
        fail(
            f"pincode lookup: expected Koramangala among areas, got {body.get('areas')}"
        )
    print("OK — 560034 resolves to Karnataka / Bengaluru, areas include Koramangala.")

    # an unknown pincode
    status, body, _ = request("GET", "/geo/pincode/999999/", token=access)
    if status != 404:
        fail(
            f"pincode lookup: expected HTTP 404 for an unknown pincode, got {status} ({body})"
        )
    print("OK — an unknown pincode returns 404.")

    # a badly-shaped pincode (too short, and one starting with 0)
    for bad in ("12345", "012345"):
        status, body, _ = request("GET", f"/geo/pincode/{bad}/", token=access)
        if status != 400:
            fail(
                f"pincode lookup: expected HTTP 400 for {bad!r}, got {status} ({body})"
            )
    print("OK — a badly-shaped pincode is rejected with 400, not treated as unknown.")

    # no token at all
    status, body, _ = request("GET", "/geo/pincode/560034/")
    if status != 401:
        fail(f"pincode lookup: expected HTTP 401 signed out, got {status} ({body})")
    print("OK — the pincode endpoint requires authentication.")

    # business create: pincode's own district is accepted
    status, body, _ = request(
        "POST",
        "/businesses/",
        {
            "name": "Pincode Biz",
            "business_type": "cloud_kitchen",
            "city": "Bengaluru",
            "pincode": "560034",
        },
        token=access,
    )
    if status != 201 or body.get("state") != "Karnataka":
        fail(
            f"business create with pincode: expected HTTP 201 and state Karnataka, got {status} ({body})"
        )
    business_id = body["id"]
    print(
        "OK — business create with a matching pincode/city fills in state automatically."
    )

    # business create: city that doesn't match the pincode is rejected
    status, body, _ = request(
        "POST",
        "/businesses/",
        {
            "name": "Mismatch Biz",
            "business_type": "cloud_kitchen",
            "city": "Nowhereville",
            "pincode": "560034",
        },
        token=access,
    )
    if status != 400:
        fail(
            f"business create: expected HTTP 400 for a mismatched city, got {status} ({body})"
        )
    print("OK — a city that isn't one of the pincode's areas is rejected.")

    # business create: an unknown pincode without manual_location is rejected
    status, body, _ = request(
        "POST",
        "/businesses/",
        {
            "name": "Unknown Pin Biz",
            "business_type": "cloud_kitchen",
            "city": "Nowhere",
            "pincode": "999999",
        },
        token=access,
    )
    if status != 400:
        fail(
            f"business create: expected HTTP 400 for an unknown pincode, got {status} ({body})"
        )
    print("OK — an unknown pincode without manual_location is rejected.")

    # business create: the same unknown pincode saves once manual_location is set
    status, body, _ = request(
        "POST",
        "/businesses/",
        {
            "name": "Manual Pin Biz",
            "business_type": "cloud_kitchen",
            "city": "Nowhere",
            "pincode": "999999",
            "state": "Delhi",
            "manual_location": True,
        },
        token=access,
    )
    if status != 201 or body.get("city") != "Nowhere" or body.get("state") != "Delhi":
        fail(
            f"business create: expected manual_location to save as typed, got {status} ({body})"
        )
    print("OK — manual_location saves an unknown pincode with the typed city/state.")

    # business update: mismatched state/city against an existing pincode is rejected
    status, body, _ = request(
        "PATCH",
        f"/businesses/{business_id}/",
        {"pincode": "560034", "state": "Maharashtra"},
        token=access,
    )
    if status != 400:
        fail(
            f"business update: expected HTTP 400 for a mismatched state, got {status} ({body})"
        )
    print("OK — a business update with a mismatched state/pincode is rejected.")


def _ai_sql_write(sql: str, params: tuple) -> int:
    conn = sqlite3.connect(f"file:{os.path.abspath(DB_PATH)}?mode=rw", uri=True)
    try:
        cursor = conn.execute(sql, params)
        conn.commit()
        return cursor.lastrowid
    finally:
        conn.close()


def _ai_sql_read_one(sql: str, params: tuple):
    conn = sqlite3.connect(f"file:{os.path.abspath(DB_PATH)}?mode=ro", uri=True)
    try:
        return conn.execute(sql, params).fetchone()
    finally:
        conn.close()


def check_ai_provider_signature() -> None:
    """No network, no API key: builds the exact kwargs backend/ai/provider/anthropic_provider.py's
    _get_raw sends to the installed anthropic SDK's Messages.create, then checks every kwarg name
    against inspect.signature(...) of that real method. Fails on any kwarg the installed SDK doesn't
    accept — the regression this guards against is an SDK upgrade silently dropping or renaming a
    parameter (as it did with `temperature` in anthropic 2.x) that only shows up once a real call is
    made against the live API. Also checks tool_choice_for_model (same file) against
    settings.AI_MODEL_FALLBACK/AI_MODEL_MENU: a model in _MODELS_REQUIRING_AUTO_TOOL_CHOICE must never
    get a forced tool_choice (claude-sonnet-5-5 returns a 400 for one, Step C1e), while the configured
    primary menu model keeps the forced one."""
    import inspect

    backend_dir = os.path.join(os.path.dirname(__file__), "..", "backend")
    sys.path.insert(0, os.path.abspath(backend_dir))
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
    import django

    django.setup()

    import anthropic
    from django.conf import settings

    from ai import prompts
    from ai.provider.anthropic_provider import tool_choice_for_model

    kwargs = dict(
        model="claude-x",
        max_tokens=100,
        system=[{"type": "text", "text": "x", "cache_control": {"type": "ephemeral"}}],
        tools=[prompts.menu_tool()],
        tool_choice={"type": "tool", "name": prompts.MENU_TOOL_NAME},
        messages=[{"role": "user", "content": "x"}],
    )

    sig = inspect.signature(anthropic.resources.messages.Messages.create)
    accepts_any_kwarg = any(
        p.kind == inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values()
    )
    unknown = [] if accepts_any_kwarg else [k for k in kwargs if k not in sig.parameters]
    if unknown:
        fail(
            f"ai provider signature: anthropic {anthropic.__version__}'s Messages.create does not "
            f"accept {unknown} — update backend/ai/provider/anthropic_provider.py"
        )
    print(
        f"OK — anthropic {anthropic.__version__}'s Messages.create accepts every kwarg the real "
        "provider sends."
    )

    fallback_choice, _system, fallback_needs_auto = tool_choice_for_model(
        settings.AI_MODEL_FALLBACK, "x", "record_x"
    )
    if fallback_choice.get("type") in ("tool", "any") or not fallback_needs_auto:
        fail(
            f"ai provider signature: AI_MODEL_FALLBACK={settings.AI_MODEL_FALLBACK!r} still gets a "
            f"forced tool_choice ({fallback_choice}) — add it to _MODELS_REQUIRING_AUTO_TOOL_CHOICE "
            "if the real API rejects one for this model."
        )
    menu_choice, _system, menu_needs_auto = tool_choice_for_model(
        settings.AI_MODEL_MENU, "x", "record_x"
    )
    if menu_needs_auto or menu_choice.get("type") != "tool":
        fail(
            f"ai provider signature: AI_MODEL_MENU={settings.AI_MODEL_MENU!r} unexpectedly lost its "
            f"forced tool_choice ({menu_choice})."
        )
    print(
        "OK — AI_MODEL_FALLBACK gets tool_choice 'auto' (no forced tool_choice), AI_MODEL_MENU keeps "
        "the forced one."
    )


def check_ai_flow() -> None:
    """AI_FAKE-only (the dev server's default) — never touches the real Anthropic API. Covers the
    whole menu-scan job lifecycle, both schema-validation outcomes (fallback recovery and persistent
    failure), the daily scan limit, file validation, the monthly cost cap, cross-business scoping,
    temp-file cleanup, and recipe-suggestion caching/matching."""
    owner_mobile, owner_access, _ = signup_and_login("AI Owner")
    status, body, _ = request(
        "POST",
        "/businesses/",
        {"name": "AI Test Biz", "business_type": "restaurant_cafe", "city": "Pune"},
        token=owner_access,
    )
    if status != 201:
        fail(f"ai flow: business create expected 201, got {status} ({body})")
    business_id = body["id"]

    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/stock-items/bulk/",
        {"items": [{"name": "Rice", "unit": "kg", "usual_price": "60.00"}]},
        token=owner_access,
    )
    if status != 201:
        fail(f"ai flow: stock bulk create expected 201, got {status} ({body})")
    rice_id = body[0]["id"]

    # A dish that shares a name with one of the fake provider's canned dishes, so the menu scan's
    # "existing" flag has something real to prove.
    existing_dish_id, _ = _create_dish(
        business_id, owner_access, "Fake Dish 2", "120.00", [(rice_id, "0.200")]
    )

    def scan_with_images(images: list[tuple[str, bytes, str]]):
        body_bytes, content_type = multipart_multi_body(
            [("images", name, content, ctype) for name, content, ctype in images]
        )
        return request(
            "POST",
            f"/businesses/{business_id}/ai/menu-scans/",
            raw_body=body_bytes,
            content_type=content_type,
            token=owner_access,
        )

    def scan_with_pdf(content: bytes):
        body_bytes, content_type = multipart_multi_body([("pdf", "menu.pdf", content, "application/pdf")])
        return request(
            "POST",
            f"/businesses/{business_id}/ai/menu-scans/",
            raw_body=body_bytes,
            content_type=content_type,
            token=owner_access,
        )

    def scan_detail(scan_id: int, token: str = owner_access):
        return request(
            "GET", f"/businesses/{business_id}/ai/menu-scans/{scan_id}/", token=token
        )

    # --- oversize/invalid file rejected (none of these should consume the daily scan limit) ---
    status, body, _ = scan_with_images([])
    if status != 422:
        fail(f"ai flow: no file expected 422, got {status} ({body})")
    status, body, _ = scan_with_images([(f"img{i}.png", make_png(), "image/png") for i in range(7)])
    if status != 422:
        fail(f"ai flow: 7 images expected 422, got {status} ({body})")
    status, body, _ = scan_with_images([("fake.png", b"not a real image", "image/png")])
    if status != 422:
        fail(f"ai flow: bad image bytes expected 422, got {status} ({body})")
    oversize_png = make_png() + (b"\x00" * (4 * 1024 * 1024 + 10))
    status, body, _ = scan_with_images([("big.png", oversize_png, "image/png")])
    if status != 422:
        fail(f"ai flow: oversize image expected 422, got {status} ({body})")
    status, body, _ = scan_with_pdf(b"NOT A PDF AT ALL")
    if status != 422:
        fail(f"ai flow: bad pdf header expected 422, got {status} ({body})")
    status, body, _ = scan_with_pdf(make_pdf(num_pages=11))
    if status != 422:
        fail(f"ai flow: 11-page pdf expected 422, got {status} ({body})")
    print("OK — oversize/invalid menu-scan files are rejected (none of them cost a daily scan).")

    # --- happy path: queued -> done, sections/dishes, the existing-dish flag ---
    status, body, _ = scan_with_images([("menu.png", make_png(), "image/png")])
    if status != 202 or "id" not in body:
        fail(f"ai flow: menu scan create expected 202, got {status} ({body})")
    scan_id = body["id"]
    status, body, _ = scan_detail(scan_id)
    if status != 200 or body["status"] != "done" or not body["is_menu"]:
        fail(f"ai flow: menu scan expected done/is_menu, got {status} ({body})")
    dishes = {d["name"]: d for section in body["sections"] for d in section["dishes"]}
    if "Fake Dish 2" not in dishes or not dishes["Fake Dish 2"]["existing"]:
        fail(f"ai flow: expected 'Fake Dish 2' flagged existing, got {dishes}")
    if "Fake Dish 1" not in dishes or dishes["Fake Dish 1"]["existing"]:
        fail(f"ai flow: expected 'Fake Dish 1' flagged not existing, got {dishes}")
    temp_dir = _ai_sql_read_one("SELECT temp_dir FROM ai_menuscan WHERE id = ?", (scan_id,))[0]
    temp_path = os.path.join(
        os.path.dirname(__file__), "..", "backend", "ai_tmp", temp_dir
    )
    if os.path.exists(temp_path):
        fail(f"ai flow: temp dir {temp_path} still exists after the job finished")
    print("OK — menu scan job lifecycle queued->done, dishes/sections, existing-dish flag.")
    print("OK — a finished scan's temp files are deleted.")

    # --- add-on rows carry kind=addon; option/two-name rows carry note and variants ---
    if "Extra Cheese" not in dishes or dishes["Extra Cheese"]["kind"] != "addon":
        fail(f"ai flow: expected 'Extra Cheese' flagged kind=addon, got {dishes.get('Extra Cheese')}")
    variant_dish = dishes.get("Fake Dish 3 (Veg/Chicken)")
    if (
        not variant_dish
        or variant_dish["note"] != "has options"
        or variant_dish["variants"] != ["Veg", "Chicken"]
    ):
        fail(f"ai flow: expected 'Fake Dish 3' note/variants, got {variant_dish}")
    print("OK — add-on rows carry kind=addon; option rows carry note and variants.")

    # --- cost: the recorded AiUsage row matches Decimal maths over the (realistic) fake token counts.
    # Uses config/settings.py's AI_PRICE_IN_PER_MTOK/AI_PRICE_OUT_PER_MTOK defaults (1.00 / 5.00) —
    # this script stays stdlib-only and talks to the server over HTTP only, same as the rest of
    # smoke.py, so it doesn't import Django to read the live setting; a dev .env that overrides
    # either price would need this updated to match. ---
    usage_row = _ai_sql_read_one(
        "SELECT est_cost_usd, input_tokens, output_tokens FROM ai_aiusage "
        "WHERE business_id = ? ORDER BY id ASC LIMIT 1",
        (business_id,),
    )
    if usage_row is None:
        fail(f"ai flow: expected an AiUsage row for business {business_id}, found none")
    expected_cost = (
        Decimal(usage_row[1]) / Decimal(1_000_000) * Decimal("1.00")
        + Decimal(usage_row[2]) / Decimal(1_000_000) * Decimal("5.00")
    )
    if Decimal(str(usage_row[0])) != expected_cost:
        fail(f"ai flow: expected AiUsage.est_cost_usd {expected_cost}, got {usage_row}")
    print(f"OK — AiUsage.est_cost_usd (${usage_row[0]}) matches Decimal maths over the real token counts.")

    # --- non-menu result ---
    status, body, _ = scan_with_images([("notmenu.png", make_png(marker=b"NOT_A_MENU"), "image/png")])
    if status != 202:
        fail(f"ai flow: not-a-menu scan create expected 202, got {status} ({body})")
    status, body, _ = scan_detail(body["id"])
    if status != 200 or body["status"] != "done" or body["is_menu"] is not False:
        fail(f"ai flow: expected is_menu false, got {status} ({body})")
    print("OK — a non-menu upload comes back is_menu=false.")

    # --- schema validation: fails once, recovers on the fallback model ---
    status, body, _ = scan_with_images(
        [("badschema.png", make_png(marker=b"FORCE_BAD_SCHEMA"), "image/png")]
    )
    status, body, _ = scan_detail(body["id"])
    if status != 200 or body["status"] != "done":
        fail(f"ai flow: expected the fallback model to recover, got {status} ({body})")
    print("OK — a canned response that fails schema validation recovers on the fallback model.")

    # --- schema validation: fails on both attempts -> the scan is marked failed ---
    status, body, _ = scan_with_images(
        [("badschema2.png", make_png(marker=b"FORCE_BAD_SCHEMA_PERSISTENT"), "image/png")]
    )
    status, body, _ = scan_detail(body["id"])
    if status != 200 or body["status"] != "failed" or body["error_code"] != "ai_schema_invalid":
        fail(f"ai flow: expected a schema-invalid failure, got {status} ({body})")
    print("OK — a canned response that fails validation on both attempts marks the scan failed.")

    # --- daily scan limit: one more succeeds (5 used so far), the 6th is rejected ---
    status, body, _ = scan_with_images([("fifth.png", make_png(), "image/png")])
    if status != 202:
        fail(f"ai flow: 5th scan today expected 202, got {status} ({body})")
    status, body, _ = scan_with_images([("sixth.png", make_png(), "image/png")])
    if status != 429:
        fail(f"ai flow: 6th scan today expected 429, got {status} ({body})")
    print("OK — a 6th menu scan in one day is rejected (429).")

    # --- cross-business access: a real scan id under someone else's business -> 404 ---
    other_mobile, other_access, _ = signup_and_login("AI Intruder")
    status, body, _ = request(
        "POST",
        "/businesses/",
        {"name": "Intruder Biz", "business_type": "cloud_kitchen", "city": "Pune"},
        token=other_access,
    )
    if status != 201:
        fail(f"ai flow: intruder business create expected 201, got {status} ({body})")
    other_business_id = body["id"]
    status, body, _ = request(
        "GET",
        f"/businesses/{other_business_id}/ai/menu-scans/{scan_id}/",
        token=other_access,
    )
    if status != 404:
        fail(f"ai flow: cross-business scan access expected 404, got {status} ({body})")
    print("OK — a scan id from another business is a 404, not the scan's own data.")

    # --- recipe suggestions: matching to an existing stock item, dish_ids, caching ---
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/ai/recipe-suggestions/",
        {"dishes": [{"name": "Rice Bowl"}]},
        token=owner_access,
    )
    if status != 200:
        fail(f"ai flow: recipe suggestion expected 200, got {status} ({body})")
    ingredient = body["dishes"][0]["ingredients"][0]
    if ingredient["matched_stock_item_id"] != rice_id:
        fail(f"ai flow: expected the Rice stock item matched, got {ingredient}")
    print("OK — a suggested ingredient matches the owner's existing stock item.")

    minor_ingredient = body["dishes"][0]["minor_ingredients"][0]
    if minor_ingredient["name"] != "Salt":
        fail(f"ai flow: expected a minor ingredient (salt) kept separate from ingredients, got {minor_ingredient}")
    print("OK — minor ingredients (e.g. salt) come back in their own list, separate from the main one.")

    before = _ai_sql_read_one(
        "SELECT COUNT(*) FROM ai_aiusage WHERE business_id = ?", (business_id,)
    )[0]
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/ai/recipe-suggestions/",
        {"dishes": [{"name": "Rice Bowl"}]},
        token=owner_access,
    )
    after = _ai_sql_read_one(
        "SELECT COUNT(*) FROM ai_aiusage WHERE business_id = ?", (business_id,)
    )[0]
    if status != 200 or after != before:
        fail(f"ai flow: expected a cache hit to skip the client, got {status}, {before} -> {after}")
    print("OK — a repeated dish name is a cache hit and skips the client (no new AiUsage row).")

    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/ai/recipe-suggestions/",
        {"dish_ids": [existing_dish_id]},
        token=owner_access,
    )
    if status != 200 or body["dishes"][0]["dish_name"] != "Fake Dish 2":
        fail(f"ai flow: recipe suggestion by dish_ids expected the dish's own name, got {status} ({body})")
    print("OK — recipe-suggestions by dish_ids resolves to the business's own dish names.")

    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/ai/recipe-suggestions/",
        {"dishes": [{"name": "FORCE_BAD_SCHEMA dish"}]},
        token=owner_access,
    )
    if status != 200 or body["dishes"][0]["dish_name"] != "FORCE_BAD_SCHEMA dish":
        fail(f"ai flow: recipe suggestion expected the fallback model to recover, got {status} ({body})")
    print("OK — a recipe suggestion that fails schema validation once recovers on the fallback model.")

    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/ai/recipe-suggestions/",
        {"dishes": [{"name": "FORCE_BAD_SCHEMA_PERSISTENT dish"}]},
        token=owner_access,
    )
    if status != 502:
        fail(f"ai flow: persistently-invalid recipe suggestion expected 502, got {status} ({body})")
    print("OK — a recipe suggestion that never passes schema validation is rejected (502).")

    # --- Haiku sometimes keys a dish "name" instead of "dish_name"; schemas.py accepts both so this
    # doesn't burn the expensive fallback-model retry ---
    before = _ai_sql_read_one(
        "SELECT COUNT(*) FROM ai_aiusage WHERE business_id = ? AND model = 'claude-sonnet-5-5'",
        (business_id,),
    )[0]
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/ai/recipe-suggestions/",
        {"dishes": [{"name": "FORCE_NAME_ALIAS dish"}]},
        token=owner_access,
    )
    after = _ai_sql_read_one(
        "SELECT COUNT(*) FROM ai_aiusage WHERE business_id = ? AND model = 'claude-sonnet-5-5'",
        (business_id,),
    )[0]
    if status != 200 or body["dishes"][0]["dish_name"] != "FORCE_NAME_ALIAS dish" or after != before:
        fail(f"ai flow: a dish keyed 'name' expected to resolve without a fallback retry, got {status} ({body})")
    print("OK — a recipe suggestion keyed 'name' instead of 'dish_name' is accepted without a fallback retry.")

    # --- a long PDF is read a few pages at a time and merged, not sent (or capped) as one call;
    # every chunk's canned response is identical here, so a correct merge/dedupe leaves exactly the
    # 4 canned dishes, not 8 (2 chunks x 4) --- a fresh business, since the first one is already at
    # today's scan limit.
    status, body, _ = request(
        "POST",
        "/businesses/",
        {"name": "AI Chunk Biz", "business_type": "restaurant_cafe", "city": "Pune"},
        token=owner_access,
    )
    if status != 201:
        fail(f"ai flow: chunk-test business create expected 201, got {status} ({body})")
    chunk_business_id = body["id"]
    usage_before = _ai_sql_read_one(
        "SELECT COUNT(*) FROM ai_aiusage WHERE business_id = ?", (chunk_business_id,)
    )[0]
    pdf_body, pdf_content_type = multipart_multi_body(
        [("pdf", "menu.pdf", make_pdf(num_pages=4), "application/pdf")]
    )
    status, body, _ = request(
        "POST",
        f"/businesses/{chunk_business_id}/ai/menu-scans/",
        raw_body=pdf_body,
        content_type=pdf_content_type,
        token=owner_access,
    )
    if status != 202:
        fail(f"ai flow: 4-page pdf scan create expected 202, got {status} ({body})")
    status, body, _ = request(
        "GET", f"/businesses/{chunk_business_id}/ai/menu-scans/{body['id']}/", token=owner_access
    )
    if status != 200 or body["status"] != "done":
        fail(f"ai flow: 4-page pdf scan expected done, got {status} ({body})")
    chunk_dish_names = {d["name"] for section in body["sections"] for d in section["dishes"]}
    if len(chunk_dish_names) != 4:
        fail(f"ai flow: expected a 4-page pdf's per-chunk duplicates deduped to 4 dishes, got {chunk_dish_names}")
    usage_after = _ai_sql_read_one(
        "SELECT COUNT(*) FROM ai_aiusage WHERE business_id = ?", (chunk_business_id,)
    )[0]
    if usage_after - usage_before != 2:
        fail(
            "ai flow: expected one AiUsage row per PDF page-chunk (2 chunks for 4 pages at 3/chunk), "
            f"got {usage_after - usage_before}"
        )
    print("OK — a multi-page PDF is read in page chunks and merged/deduped, one AiUsage row per chunk.")

    # The owner is already at the 3-business cap (business_id, chunk_business_id, and
    # incomplete_business_id further below) — every remaining ai/ check reuses one of those three
    # rather than creating a 4th.

    # --- a chunk that overflows max_tokens is retried one page at a time and recovers: the 3-page
    # PDF here is small enough to go as a single whole-document call (no top-level chunking at 3/
    # chunk), and FORCE_MAX_TOKENS rides along as an unreferenced object present only in that raw,
    # unrewritten upload — pypdf drops it the moment extraction.py splits the doc into individual
    # pages for the retry, so each retry call comes back clean. ---
    retry_usage_before = _ai_sql_read_one(
        "SELECT COUNT(*) FROM ai_aiusage WHERE business_id = ?", (chunk_business_id,)
    )[0]
    retry_pdf_body, retry_pdf_content_type = multipart_multi_body(
        [("pdf", "menu.pdf", make_pdf(num_pages=3, marker=b"FORCE_MAX_TOKENS"), "application/pdf")]
    )
    status, body, _ = request(
        "POST",
        f"/businesses/{chunk_business_id}/ai/menu-scans/",
        raw_body=retry_pdf_body,
        content_type=retry_pdf_content_type,
        token=owner_access,
    )
    if status != 202:
        fail(f"ai flow: retry-test pdf scan create expected 202, got {status} ({body})")
    status, body, _ = request(
        "GET", f"/businesses/{chunk_business_id}/ai/menu-scans/{body['id']}/", token=owner_access
    )
    retry_dish_names = {d["name"] for section in body.get("sections", []) for d in section["dishes"]}
    if status != 200 or body["status"] != "done" or body.get("incomplete") or len(retry_dish_names) != 4:
        fail(
            "ai flow: expected a recovered page-by-page retry (done, not incomplete, 4 dishes), "
            f"got {status} ({body})"
        )
    retry_usage_after = _ai_sql_read_one(
        "SELECT COUNT(*) FROM ai_aiusage WHERE business_id = ?", (chunk_business_id,)
    )[0]
    if retry_usage_after - retry_usage_before != 4:
        fail(
            "ai flow: expected 4 AiUsage rows (1 overflowing chunk call + 3 page retries), "
            f"got {retry_usage_after - retry_usage_before}"
        )
    print("OK — a chunk that overflows max_tokens is retried one page at a time and recovers.")

    # --- when a single page still overflows on its own, that page's scan stays incomplete but the
    # other chunk's dishes are kept, never dropped to zero. ---
    partial_pdf_body, partial_pdf_content_type = multipart_multi_body(
        [
            (
                "pdf",
                "menu.pdf",
                make_pdf(num_pages=4, page_markers={4: b"FORCE_MAX_TOKENS"}),
                "application/pdf",
            )
        ]
    )
    status, body, _ = request(
        "POST",
        f"/businesses/{chunk_business_id}/ai/menu-scans/",
        raw_body=partial_pdf_body,
        content_type=partial_pdf_content_type,
        token=owner_access,
    )
    if status != 202:
        fail(f"ai flow: partial-overflow pdf scan create expected 202, got {status} ({body})")
    status, body, _ = request(
        "GET", f"/businesses/{chunk_business_id}/ai/menu-scans/{body['id']}/", token=owner_access
    )
    partial_dish_names = {d["name"] for section in body.get("sections", []) for d in section["dishes"]}
    if status != 200 or body["status"] != "done" or not body.get("incomplete") or not partial_dish_names:
        fail(
            "ai flow: expected the clean chunk's dishes kept and incomplete=true when the other "
            f"chunk's single page overflows, got {status} ({body})"
        )
    print(
        "OK — a single page that still overflows keeps the other chunk's dishes and flags incomplete."
    )

    # --- variants must be option/alternate names, never prices; schemas.py strips anything price-like ---
    price_variants_body, price_variants_content_type = multipart_multi_body(
        [("images", "variants.png", make_png(marker=b"FORCE_PRICE_VARIANTS"), "image/png")]
    )
    status, body, _ = request(
        "POST",
        f"/businesses/{chunk_business_id}/ai/menu-scans/",
        raw_body=price_variants_body,
        content_type=price_variants_content_type,
        token=owner_access,
    )
    if status != 202:
        fail(f"ai flow: price-variants scan create expected 202, got {status} ({body})")
    status, body, _ = request(
        "GET", f"/businesses/{chunk_business_id}/ai/menu-scans/{body['id']}/", token=owner_access
    )
    if status != 200 or body["status"] != "done":
        fail(f"ai flow: price-variants scan expected done, got {status} ({body})")
    price_variant_dish = next(
        d for section in body["sections"] for d in section["dishes"] if "Lollipop" in d["name"]
    )
    if price_variant_dish["variants"]:
        fail(
            "ai flow: expected price-like variants (['300', 'Rs 320']) stripped to none, "
            f"got {price_variant_dish['variants']}"
        )
    print("OK — variants that are plain prices are rejected, never passed through as option names.")

    # --- a short bare number on one side of a slash (e.g. "Gobi Manchurian/65") is a dish style,
    # not a price, and must survive as a variant alongside the other side — reuses chunk_business_id
    # (not a fresh business: the owner is already at the 3-business cap, see above) and stays within
    # its daily scan limit (4 scans so far: the multi-page merge, the chunk-overflow retry, the
    # single-page-overflow and the price-variants check, all above). ---
    slash_variant_body, slash_variant_content_type = multipart_multi_body(
        [("images", "slash.png", make_png(marker=b"FORCE_SLASH_VARIANT"), "image/png")]
    )
    status, body, _ = request(
        "POST",
        f"/businesses/{chunk_business_id}/ai/menu-scans/",
        raw_body=slash_variant_body,
        content_type=slash_variant_content_type,
        token=owner_access,
    )
    if status != 202:
        fail(f"ai flow: slash-variant scan create expected 202, got {status} ({body})")
    status, body, _ = request(
        "GET", f"/businesses/{chunk_business_id}/ai/menu-scans/{body['id']}/", token=owner_access
    )
    if status != 200 or body["status"] != "done":
        fail(f"ai flow: slash-variant scan expected done, got {status} ({body})")
    slash_variant_dish = next(
        d for section in body["sections"] for d in section["dishes"] if "Manchurian" in d["name"]
    )
    if slash_variant_dish["variants"] != ["Manchurian", "65"]:
        fail(
            "ai flow: expected both sides of 'Gobi Manchurian/65' kept as variants "
            f"(['Manchurian', '65']), got {slash_variant_dish['variants']}"
        )
    print("OK — a short bare number on one side of a slash (a dish style, not a price) survives as a variant.")

    # --- a model that stops at max_tokens is flagged incomplete, not silently returned as whole ---
    status, body, _ = request(
        "POST",
        "/businesses/",
        {"name": "AI Incomplete Biz", "business_type": "restaurant_cafe", "city": "Pune"},
        token=owner_access,
    )
    if status != 201:
        fail(f"ai flow: incomplete-test business create expected 201, got {status} ({body})")
    incomplete_business_id = body["id"]
    maxtok_body, maxtok_content_type = multipart_multi_body(
        [("images", "maxtok.png", make_png(marker=b"FORCE_MAX_TOKENS"), "image/png")]
    )
    status, body, _ = request(
        "POST",
        f"/businesses/{incomplete_business_id}/ai/menu-scans/",
        raw_body=maxtok_body,
        content_type=maxtok_content_type,
        token=owner_access,
    )
    if status != 202:
        fail(f"ai flow: max-tokens scan create expected 202, got {status} ({body})")
    status, body, _ = request(
        "GET",
        f"/businesses/{incomplete_business_id}/ai/menu-scans/{body['id']}/",
        token=owner_access,
    )
    if status != 200 or body["status"] != "done" or not body.get("incomplete"):
        fail(f"ai flow: expected a max_tokens stop flagged incomplete, got {status} ({body})")
    print("OK — a scan where the model stops at max_tokens is flagged incomplete, not silently cut.")

    # --- a fake 200-dish menu: the merge/cap logic returns every dish, none lost ---
    many_body, many_content_type = multipart_multi_body(
        [("images", "many.png", make_png(marker=b"FORCE_MANY_DISHES"), "image/png")]
    )
    status, body, _ = request(
        "POST",
        f"/businesses/{incomplete_business_id}/ai/menu-scans/",
        raw_body=many_body,
        content_type=many_content_type,
        token=owner_access,
    )
    if status != 202:
        fail(f"ai flow: many-dishes scan create expected 202, got {status} ({body})")
    status, body, _ = request(
        "GET",
        f"/businesses/{incomplete_business_id}/ai/menu-scans/{body['id']}/",
        token=owner_access,
    )
    if status != 200 or body["status"] != "done":
        fail(f"ai flow: many-dishes scan expected done, got {status} ({body})")
    many_dish_count = sum(len(section["dishes"]) for section in body["sections"])
    if many_dish_count != 200 or body.get("incomplete"):
        fail(
            f"ai flow: expected all 200 dishes with none lost, got {many_dish_count} "
            f"(incomplete={body.get('incomplete')})"
        )
    print("OK — a 200-dish menu comes back complete, none lost to the dish cap.")

    # --- monthly cost cap: a huge AiUsage row trips it, then cleanup restores normal service ---
    cap_row_id = _ai_sql_write(
        "INSERT INTO ai_aiusage "
        "(business_id, kind, model, input_tokens, output_tokens, est_cost_usd, created) "
        "VALUES (?, 'recipe_suggestion', 'smoke-test', 0, 0, '999999', ?)",
        (business_id, str(datetime.now(dt_timezone.utc))),
    )
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/ai/recipe-suggestions/",
        {"dishes": [{"name": "Cap Test Dish"}]},
        token=owner_access,
    )
    if status != 503:
        fail(f"ai flow: expected 503 once the monthly cost cap is reached, got {status} ({body})")
    print("OK — AI endpoints return 503 once the monthly cost cap is reached.")

    _ai_sql_write("DELETE FROM ai_aiusage WHERE id = ?", (cap_row_id,))
    status, body, _ = request(
        "POST",
        f"/businesses/{business_id}/ai/recipe-suggestions/",
        {"dishes": [{"name": "Cap Test Dish"}]},
        token=owner_access,
    )
    if status != 200:
        fail(f"ai flow: expected service to resume once back under the cap, got {status} ({body})")
    print("OK — AI service resumes once usage is back under the monthly cap.")


def check_kitchen_base_discovery() -> None:
    """Step EK-1: no network, no API key — direct Django calls (same style as
    check_ai_provider_signature) against backend/ai/knowledge/ and ai/base_discovery.py's pure
    functions. Covers: the restaurant_cafe library loads with its templates, a base used by only 2
    dishes is dropped, a formula summing far from its own yield is flagged (not dropped), and a menu
    line with inline options expands into one dish per option."""
    backend_dir = os.path.join(os.path.dirname(__file__), "..", "backend")
    sys.path.insert(0, os.path.abspath(backend_dir))
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
    import django

    django.setup()

    from django.conf import settings

    from ai.base_discovery import _cache_key, discover_bases, expand_dish_options, sanity_check
    from ai.knowledge import load_library
    from ai.models import AiKitchenBaseCache

    library = load_library("restaurant_cafe")
    if not library["base_templates"]:
        fail("kitchen base discovery: expected restaurant_cafe library to have base templates")
    template_names = {t["name"] for t in library["base_templates"]}
    if "Onion-tomato masala" not in template_names or "Ginger-garlic paste" not in template_names:
        fail(f"kitchen base discovery: expected key templates present, got {template_names}")
    print(f"OK — the restaurant_cafe knowledge library loads ({len(template_names)} base templates).")

    empty_library = load_library("home_business")
    if empty_library["base_templates"]:
        fail(f"kitchen base discovery: expected an empty library for home_business, got {empty_library}")
    print("OK — a sector with no knowledge file falls back to an empty library, same shape.")

    dishes = [{"name": "A"}, {"name": "B"}, {"name": "C"}]
    two_dish_base = {
        "name": "Two-dish base",
        "batch_ingredients": [{"name": "Onion", "qty": 1000, "unit": "g"}],
        "yield_qty": 1000,
        "used_by": [
            {"dish": "A", "grams_per_portion": 100},
            {"dish": "B", "grams_per_portion": 100},
        ],
        "flags": [],
    }
    kept = sanity_check([two_dish_base], dishes, library["rules"])
    if kept:
        fail(f"kitchen base discovery: expected a base used by only 2 dishes dropped, got {kept}")
    print("OK — a base used by fewer dishes than the sector's rule requires is dropped.")

    bad_formula_base = {
        "name": "Bad formula base",
        "batch_ingredients": [{"name": "Onion", "qty": 1400, "unit": "g"}],
        "yield_qty": 1000,
        "used_by": [
            {"dish": "A", "grams_per_portion": 100},
            {"dish": "B", "grams_per_portion": 100},
            {"dish": "C", "grams_per_portion": 100},
        ],
        "flags": [],
    }
    kept = sanity_check([bad_formula_base], dishes, library["rules"])
    if len(kept) != 1 or not any("1400" in flag for flag in kept[0]["flags"]):
        fail(f"kitchen base discovery: expected the 1,400 g formula flagged (not dropped), got {kept}")
    print("OK — a formula summing far from its own yield is flagged, not dropped.")

    expanded = expand_dish_options([{"name": "Chicken (Manchurian/Chilli/Pepper/Lemon)"}])
    expanded_names = [d["name"] for d in expanded]
    if expanded_names != ["Chicken Manchurian", "Chicken Chilli", "Chicken Pepper", "Chicken Lemon"]:
        fail(f"kitchen base discovery: expected 4 expanded dishes, got {expanded_names}")
    if any(d.get("expanded_from") != "Chicken (Manchurian/Chilli/Pepper/Lemon)" for d in expanded):
        fail(f"kitchen base discovery: expected expanded_from set on every expanded row, got {expanded}")
    print("OK — a menu line with inline options expands into one dish per option.")

    menu_dishes = [
        {"name": n}
        for n in [
            "Chicken Curry",
            "Mutton Curry",
            "Paneer Curry",
            "Veg Manchurian",
            "Chicken Manchurian",
            "Gobi Manchurian",
        ]
    ]
    # Cache rows aren't business-scoped (same key shape as AiRecipeCache) — clear this exact dish set
    # first so a repeat run of this check (or `verify`/`verify:full` run twice) sees a real call, not
    # a stale cache hit left over from the last time this check ran against the same dev database.
    AiKitchenBaseCache.objects.filter(
        sector="restaurant_cafe", dish_set_hash=_cache_key([d["name"] for d in menu_dishes])
    ).delete()
    result = discover_bases(menu_dishes, "restaurant_cafe", [])
    base_names = {b["name"] for b in result["bases"]}
    if "Onion-tomato masala" not in base_names or "Indo-Chinese sauce base" not in base_names:
        fail(f"kitchen base discovery: expected the fake provider's canned bases, got {base_names}")
    if result["usage"] is None or result["usage"]["model"] != settings.AI_MODEL_KITCHEN:
        fail(f"kitchen base discovery: expected a real (uncached) call on the first run, got {result['usage']}")
    print("OK — end-to-end discovery (fake provider) finds the expected library bases for this menu.")

    cached_result = discover_bases(menu_dishes, "restaurant_cafe", [])
    if cached_result["usage"] is not None:
        fail(f"kitchen base discovery: expected a cache hit on the same dish set, got {cached_result['usage']}")
    print("OK — the same dish set on a repeat call is a cache hit (no model call, no new usage).")


# Every check, in the suite's original order — the default (no --area) runs exactly this list, same
# as before --area existed. check_health() is always run first regardless of --area; it's the
# "is the server even up" sanity ping, not tied to any one area.
def check_admin_delete_flow() -> None:
    """Step F1: Django admin delete rules for User/Business — direct ORM + django.test.Client against
    the same dev database the rest of this suite's API checks use (admin pages are server-rendered,
    not part of the DRF API, so there's no live-server HTTP call here, same pattern as
    check_ai_provider_signature). Covers: a no-business user deletes clean; deleting a business via
    its admin action cascades everything (no orphan rows, no raw IntegrityError) while leaving the
    owner account itself alone; a non-superuser staff account can't delete at all; the last active
    superuser can't be deleted (tested inside a rolled-back transaction, so no real admin account is
    ever actually touched)."""
    import random
    import uuid
    from types import SimpleNamespace

    backend_dir = os.path.join(os.path.dirname(__file__), "..", "backend")
    sys.path.insert(0, os.path.abspath(backend_dir))
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
    import django

    django.setup()

    from django.contrib.admin.helpers import ACTION_CHECKBOX_NAME
    from django.db import transaction
    from django.test import Client
    from django.utils import timezone as django_timezone

    from accounts.admin import UserAdmin
    from accounts.models import User
    from businesses.admin import BusinessAdmin
    from businesses.models import Business
    from counts.models import CountLine, StockCount
    from sales.models import Sale
    from stock.models import SellItem, StockItem
    from wastage.models import WastageEntry

    def _mobile() -> str:
        return random.choice("6789") + "".join(random.choices("0123456789", k=9))

    tag = uuid.uuid4().hex[:8]
    admin_path = f"/{__import__('django.conf', fromlist=['settings']).settings.ADMIN_URL_PATH}"

    superuser = User.objects.create_superuser(
        mobile=_mobile(), name=f"Admin {tag}", password="AdminPass123!", email=f"admin{tag}@test.local"
    )
    staff = User.objects.create_user(
        mobile=_mobile(), name=f"Staff {tag}", password="StaffPass123!", email=f"staff{tag}@test.local"
    )
    staff.is_staff = True
    staff.save(update_fields=["is_staff"])

    try:
        client = Client()
        client.force_login(superuser)

        # --- a plain user with no business deletes clean ---
        lonely = User.objects.create_user(mobile=_mobile(), name="Lonely", password="x")
        response = client.post(
            f"{admin_path}accounts/user/{lonely.pk}/delete/", {"post": "yes"}, follow=True
        )
        if response.status_code != 200 or User.objects.filter(pk=lonely.pk).exists():
            fail(f"admin delete flow: expected the no-business user deleted, got {response.status_code}")
        print("OK — a superuser deletes a no-business user cleanly from the admin.")

        # --- deleting a business via its admin action cascades, no orphans, owner untouched ---
        owner = User.objects.create_user(mobile=_mobile(), name="Owner", password="x")
        business = Business.objects.create(
            name=f"Test Biz {tag}", business_type="restaurant_cafe", city="Pune", created_by=owner
        )
        stock_item = StockItem.objects.create(business=business, created_by=owner, name="Rice", unit="kg")
        sell_item = SellItem.objects.create(
            business=business, created_by=owner, name="Veg Rice", selling_price="100"
        )
        now = django_timezone.now()
        count = StockCount.objects.create(
            business=business,
            count_type="opening",
            business_date=now.date(),
            counted_by=owner,
            deadline_at=now,
        )
        CountLine.objects.create(count=count, stock_item=stock_item, state="counted", counted_qty="5")
        WastageEntry.objects.create(
            business=business,
            stock_item=stock_item,
            quantity="1",
            reason="spoiled",
            recorded_by=owner,
        )
        Sale.objects.create(
            business=business,
            sell_item=sell_item,
            business_date="2026-01-01",
            quantity=1,
            amount="100",
            recorded_by=owner,
        )

        response = client.post(
            f"{admin_path}businesses/business/",
            {
                "action": "delete_business_and_data",
                ACTION_CHECKBOX_NAME: [str(business.pk)],
                "apply": "1",
            },
            follow=True,
        )
        if response.status_code != 200:
            fail(f"admin delete flow: business delete action expected 200, got {response.status_code}")
        if Business.objects.filter(pk=business.pk).exists():
            fail("admin delete flow: business still exists after the delete action")
        if StockItem.objects.filter(business_id=business.pk).exists() or SellItem.objects.filter(
            business_id=business.pk
        ).exists():
            fail("admin delete flow: stock/sell items were orphaned after the business delete")
        if not User.objects.filter(pk=owner.pk).exists():
            fail("admin delete flow: deleting the business must not delete its owner")
        print("OK — the business delete action cascades everything with no orphan rows, owner kept.")

        # Now the owner is unprotected (no business left) — deleting them must work too.
        response = client.post(
            f"{admin_path}accounts/user/{owner.pk}/delete/", {"post": "yes"}, follow=True
        )
        if User.objects.filter(pk=owner.pk).exists():
            fail("admin delete flow: expected the now-business-less owner to delete cleanly")
        print("OK — the owner deletes cleanly once their business (and its data) is gone.")

        # --- a non-superuser staff account cannot delete at all ---
        target = User.objects.create_user(mobile=_mobile(), name="Target", password="x")
        staff_client = Client()
        staff_client.force_login(staff)
        response = staff_client.post(
            f"{admin_path}accounts/user/{target.pk}/delete/", {"post": "yes"}
        )
        if response.status_code == 200 and not User.objects.filter(pk=target.pk).exists():
            fail("admin delete flow: a non-superuser staff account was able to delete a user")
        if not User.objects.filter(pk=target.pk).exists():
            fail("admin delete flow: the target user should not have been deleted by non-superuser staff")
        print("OK — non-superuser staff cannot delete a user from the admin.")
        target.delete()

        # --- the last active superuser can never be deleted — proven inside a rolled-back
        # transaction, so no real superuser account in this dev database is ever actually touched ---
        class _RollbackProbe(Exception):
            pass

        try:
            with transaction.atomic():
                User.objects.filter(is_superuser=True, is_active=True).exclude(pk=superuser.pk).update(
                    is_active=False
                )
                fake_request = SimpleNamespace(user=superuser)
                if UserAdmin(User, None).has_delete_permission(fake_request, superuser):
                    fail("admin delete flow: the last active superuser must not be deletable")
                raise _RollbackProbe()
        except _RollbackProbe:
            pass
        print("OK — the last active superuser can't be deleted (checked, then rolled back).")

        # has_delete_permission(obj=None) still allows other superuser accounts to use the page —
        # BusinessAdmin's action similarly refuses a non-superuser.
        if BusinessAdmin(Business, None).has_delete_permission(SimpleNamespace(user=staff)):
            fail("admin delete flow: BusinessAdmin.has_delete_permission should always be False (the "
                 "model stays undeletable directly — only the custom action removes it)")
        print("OK — Business itself stays undeletable from its own admin page.")
    finally:
        User.objects.filter(pk__in=[superuser.pk, staff.pk]).delete()
        Business.objects.filter(created_by__email__endswith="@test.local").delete()


ALL_CHECKS = [
    check_permission_table,
    check_auth_flow,
    check_business_flow,
    check_sector_change_flow,
    check_stock_flow,
    check_item_setup_flow,
    check_low_stock_flow,
    check_bases_flow,
    check_starter_pack_flow,
    check_sector_units_flow,
    check_team_flow,
    check_team_reset_flow,
    check_purchase_flow,
    check_count_and_wastage_flow,
    check_daily_counts_flow,
    check_first_count_flow,
    check_settings_flow,
    check_sales_and_gap_flow,
    check_alerts_flow,
    check_expiry_alerts_flow,
    check_reports_flow,
    check_pincode_geo_flow,
    check_ai_provider_signature,
    check_ai_flow,
    check_kitchen_base_discovery,
    check_admin_delete_flow,
]

# One check can serve more than one area (e.g. check_sales_and_gap_flow is both "sales" and
# "counts" — the stock gap is a counts concept, computed over a sales window). --area is additive:
# `--area counts --area sales` runs the union, each check at most once, in ALL_CHECKS order.
AREA_CHECKS: dict[str, list] = {
    "counts": [
        check_count_and_wastage_flow,
        check_daily_counts_flow,
        check_first_count_flow,
        check_sales_and_gap_flow,
    ],
    "stock": [
        check_stock_flow,
        check_item_setup_flow,
        check_low_stock_flow,
        check_bases_flow,
        check_starter_pack_flow,
        check_sector_units_flow,
        check_purchase_flow,
        check_settings_flow,
        check_sector_change_flow,
    ],
    "sales": [check_sales_and_gap_flow],
    "alerts": [check_alerts_flow, check_expiry_alerts_flow, check_low_stock_flow],
    "wastage": [check_count_and_wastage_flow],
    "permissions": [check_permission_table, check_team_flow, check_team_reset_flow],
    "onboarding": [check_auth_flow, check_business_flow, check_pincode_geo_flow],
    "reports": [check_reports_flow],
    "ai": [check_ai_provider_signature, check_ai_flow, check_kitchen_base_discovery],
    "admin": [check_admin_delete_flow],
}


def _checks_for(areas: list[str]) -> list:
    seen = set()
    checks = []
    for area in areas:
        for check in AREA_CHECKS[area]:
            if check not in seen:
                seen.add(check)
                checks.append(check)
    return checks


def main() -> None:
    parser = argparse.ArgumentParser(description="EasyKharcha backend API smoke suite")
    parser.add_argument(
        "--area",
        action="append",
        choices=sorted(AREA_CHECKS),
        help="Run only this area's checks (repeatable, e.g. --area counts --area sales). "
        "Default: every check.",
    )
    args = parser.parse_args()

    check_health()
    checks = _checks_for(args.area) if args.area else ALL_CHECKS
    if args.area:
        print(f"Area(s) {', '.join(args.area)}: {len(checks)} check(s) to run.\n")

    suite_start = time.monotonic()
    durations = []
    for check in checks:
        check_start = time.monotonic()
        check()
        durations.append((check.__name__, time.monotonic() - check_start))
    total = time.monotonic() - suite_start

    print(f"\nAll smoke checks passed. ({total:.1f}s total)")
    if len(durations) > 1:
        print("\nSlowest checks:")
        for name, duration in sorted(durations, key=lambda d: -d[1])[:5]:
            print(f"  {duration:6.1f}s  {name}")


if __name__ == "__main__":
    main()
