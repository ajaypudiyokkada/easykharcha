#!/usr/bin/env python
"""Step 24a RBAC audit — dynamic probe (read-only against application code; this script itself is a
test tool, not part of the app). Seeds one business with one user per role (Owner, Manager, Head
chef, Helper) plus a second business with a different Owner, then for every endpoint x role (plus
the second business's Owner as a cross-business outsider, and an unauthenticated caller) records the
status code and, for 2xx JSON responses, whether a money-shaped key appears anywhere in the body
(recursive key scan). Also runs a handful of write-attempt probes (Manager counting, Manager
recording wastage, Helper editing a stock item's price, Head chef creating a sale, a non-Owner
managing the team, cross-business id access).

Run with:  python scripts/rbac_probe.py   (backend must be running: npm run dev, or
`python backend/manage.py runserver`)
"""

import json
import random
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone as dt_timezone

BASE_URL = "http://127.0.0.1:8000/api/v1"
ORIGIN = "http://localhost:8081"

MONEY_KEY_SUBSTRINGS = (
    "price",
    "cost",
    "value",
    "amount",
    "total",
    "rate",
    "bought",
    "wastage_value",
    "sales",
    "gap_value",
)
# Keys that contain one of the substrings above but are never money (avoid false positives).
MONEY_KEY_EXCLUDE = {
    "total_gap_value",  # still money, keep — placeholder to show the set is deliberate, not a no-op
}


def fail(message: str) -> None:
    print(f"FAIL: {message}")
    sys.exit(1)


def request(method: str, path: str, body: dict | None = None, token: str | None = None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Origin": ORIGIN, "Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(f"{BASE_URL}{path}", data=data, headers=headers, method=method)
    try:
        response = urllib.request.urlopen(req, timeout=10)
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        payload = json.loads(raw) if raw else {}
        return exc.code, payload
    except urllib.error.URLError as exc:
        fail(f"could not reach {BASE_URL}{path} — is the backend running? ({exc})")
        return None, None
    raw = response.read()
    payload = json.loads(raw) if raw else {}
    return response.status, payload


def find_money_keys(obj, path: str = "$") -> list[str]:
    """Recursively scans a JSON-decoded body for any dict key that looks money-shaped. Returns the
    list of json-path-ish locations where one was found (not just a bool) so a hit can be pointed at."""
    hits: list[str] = []
    if isinstance(obj, dict):
        for key, value in obj.items():
            key_l = key.lower()
            if any(sub in key_l for sub in MONEY_KEY_SUBSTRINGS):
                hits.append(f"{path}.{key}")
            hits.extend(find_money_keys(value, f"{path}.{key}"))
    elif isinstance(obj, list):
        for index, item in enumerate(obj[:5]):  # first 5 is plenty to catch a leak in a list
            hits.extend(find_money_keys(item, f"{path}[{index}]"))
    elif isinstance(obj, str):
        if "₹" in obj:  # a rupee sign embedded in a text field (e.g. an alert's `detail`)
            hits.append(f"{path} (rupee sign in text)")
    return hits


def rand_mobile() -> str:
    return "9" + "".join(str(random.randint(0, 9)) for _ in range(9))


def signup(name: str) -> tuple[str, str, str]:
    mobile = rand_mobile()
    password = "Correct-Horse-9"
    status, body = request(
        "POST",
        "/auth/signup/",
        {"name": name, "mobile": mobile, "password": password, "consent": True},
    )
    if status != 201:
        fail(f"signup({name}): expected 201, got {status} ({body})")
    return mobile, password, body["id"]


def login(mobile: str, secret: str) -> str:
    status, body = request("POST", "/auth/login/", {"mobile": mobile, "secret": secret})
    if status != 200:
        fail(f"login({mobile}): expected 200, got {status} ({body})")
    return body["access"]


def create_business(owner_token: str, name: str) -> int:
    status, body = request(
        "POST",
        "/businesses/",
        {"name": name, "business_type": "restaurant_cafe", "city": "Bengaluru"},
        token=owner_token,
    )
    if status != 201:
        fail(f"create business({name}): expected 201, got {status} ({body})")
    return body["id"]


def add_team_member(owner_token: str, business_id: int, role: str, name: str) -> tuple[str, str]:
    mobile = rand_mobile()
    secret = "5073" if role in ("head_chef", "helper") else "Correct-Horse-9"
    status, body = request(
        "POST",
        f"/businesses/{business_id}/team/",
        {"mobile": mobile, "role": role, "name": name, "secret": secret},
        token=owner_token,
    )
    if status != 201:
        fail(f"add team member({role}): expected 201, got {status} ({body})")
    return mobile, secret


def seed_stock_and_sell_items(owner_token: str, business_id: int) -> tuple[int, int]:
    status, body = request(
        "POST",
        f"/businesses/{business_id}/stock-items/bulk/",
        {"items": [{"name": "Milk", "unit": "L", "usual_price": "60.00"}]},
        token=owner_token,
    )
    if status != 201:
        fail(f"seed stock item: expected 201, got {status} ({body})")
    stock_item_id = body[0]["id"]

    status, body = request(
        "POST",
        f"/businesses/{business_id}/sell-items/",
        {
            "name": "Tea",
            "selling_price": "20.00",
            "ingredients": [{"stock_item": stock_item_id, "quantity": "0.2"}],
        },
        token=owner_token,
    )
    if status != 201:
        fail(f"seed sell item: expected 201, got {status} ({body})")
    sell_item_id = body["id"]
    return stock_item_id, sell_item_id


def seed_purchase(owner_token: str, business_id: int, stock_item_id: int) -> None:
    status, body = request(
        "POST",
        f"/businesses/{business_id}/purchases/",
        {
            "purchase_date_time": datetime.now(dt_timezone.utc).isoformat(),
            "lines": [
                {
                    "stock_item": stock_item_id,
                    "quantity": "10.000",
                    "unit_price": "60.00",
                    "line_total": "600.00",
                }
            ],
        },
        token=owner_token,
    )
    if status != 201:
        fail(f"seed purchase: expected 201, got {status} ({body})")


def seed_wastage(owner_token: str, business_id: int, stock_item_id: int) -> None:
    status, body = request(
        "POST",
        f"/businesses/{business_id}/wastage/",
        {"stock_item": stock_item_id, "quantity": "1.000", "reason": "spoiled"},
        token=owner_token,
    )
    if status != 201:
        fail(f"seed wastage: expected 201, got {status} ({body})")


def seed_sale(owner_token: str, business_id: int, sell_item_id: int) -> None:
    today = datetime.now(dt_timezone.utc).date().isoformat()
    status, body = request(
        "POST",
        f"/businesses/{business_id}/sales/",
        {"business_date": today, "lines": [{"sell_item": sell_item_id, "quantity": "5"}]},
        token=owner_token,
    )
    if status != 201:
        fail(f"seed sale: expected 201, got {status} ({body})")


def main() -> None:
    print("Seeding business A with one user per role...")
    owner_a_mobile, owner_a_secret, _ = signup("Owner A")
    owner_a_token = login(owner_a_mobile, owner_a_secret)
    business_a = create_business(owner_a_token, "Business A")

    manager_mobile, manager_secret = add_team_member(owner_a_token, business_a, "manager", "Manager A")
    head_chef_mobile, head_chef_secret = add_team_member(
        owner_a_token, business_a, "head_chef", "Head chef A"
    )
    helper_mobile, helper_secret = add_team_member(owner_a_token, business_a, "helper", "Helper A")

    manager_token = login(manager_mobile, manager_secret)
    head_chef_token = login(head_chef_mobile, head_chef_secret)
    helper_token = login(helper_mobile, helper_secret)

    stock_item_id, sell_item_id = seed_stock_and_sell_items(owner_a_token, business_a)
    seed_purchase(owner_a_token, business_a, stock_item_id)
    seed_wastage(owner_a_token, business_a, stock_item_id)
    seed_sale(owner_a_token, business_a, sell_item_id)

    # Opening count so counts/, counts/<id>/, counts/today/ all have a real row to return.
    status, items_body = request(
        "GET", f"/businesses/{business_a}/counts/form/?type=opening", token=owner_a_token
    )
    if status != 200:
        fail(f"counts/form (seed): expected 200, got {status}")
    status, count_body = request(
        "POST",
        f"/businesses/{business_a}/counts/",
        {
            "type": "opening",
            "lines": [
                {"stock_item": item["id"], "state": "counted", "counted_qty": "5.000"}
                for item in items_body["items"]
            ],
        },
        token=owner_a_token,
    )
    if status != 201:
        fail(f"seed opening count: expected 201, got {status} ({count_body})")
    count_id = count_body["id"]

    print("Seeding business B with its own Owner (cross-business outsider)...")
    owner_b_mobile, owner_b_secret, _ = signup("Owner B")
    owner_b_token = login(owner_b_mobile, owner_b_secret)
    business_b = create_business(owner_b_token, "Business B")

    roles = {
        "owner": owner_a_token,
        "manager": manager_token,
        "head_chef": head_chef_token,
        "helper": helper_token,
        "outsider_owner_b": owner_b_token,
        "unauthenticated": None,
    }

    endpoints = [
        ("GET", "/me/"),
        ("GET", f"/businesses/{business_a}/team/"),
        ("GET", f"/businesses/{business_a}/settings/"),
        ("GET", f"/businesses/{business_a}/stock-items/"),
        ("GET", f"/businesses/{business_a}/stock-items/{stock_item_id}/"),
        ("GET", f"/businesses/{business_a}/sell-items/"),
        ("GET", f"/businesses/{business_a}/suppliers/"),
        ("GET", f"/businesses/{business_a}/purchases/"),
        ("GET", f"/businesses/{business_a}/counts/form/?type=opening"),
        ("GET", f"/businesses/{business_a}/counts/today/"),
        ("GET", f"/businesses/{business_a}/counts/"),
        ("GET", f"/businesses/{business_a}/counts/{count_id}/"),
        ("GET", f"/businesses/{business_a}/today/"),
        ("GET", f"/businesses/{business_a}/wastage/"),
        ("GET", f"/businesses/{business_a}/sales/"),
        ("GET", f"/businesses/{business_a}/alerts/"),
        ("GET", f"/businesses/{business_a}/reports/summary/"),
    ]

    print("\n=== Endpoint x role status matrix (+ money-leak scan on 2xx bodies) ===")
    header = f"{'endpoint':55s}" + "".join(f"{role:>18s}" for role in roles)
    print(header)
    leak_report: list[str] = []
    for method, path in endpoints:
        row = f"{method + ' ' + path:55s}"
        for role, token in roles.items():
            status, body = request(method, path, token=token)
            cell = str(status)
            if 200 <= status < 300:
                hits = find_money_keys(body)
                if hits and role in ("head_chef", "helper", "outsider_owner_b", "unauthenticated"):
                    cell += "*"
                    leak_report.append(
                        f"  {role} @ {method} {path} -> money-shaped key(s): {hits[:5]}"
                    )
            row += f"{cell:>18s}"
        print(row)
    print("(* = a money-shaped key appeared in a 2xx body for a role that shouldn't see money)")

    print("\n=== Money-leak detail ===")
    if leak_report:
        for line in leak_report:
            print(line)
    else:
        print("  none found")

    print("\n=== Write-attempt probes ===")
    write_probes = [
        (
            "Manager submits a stock count (should be 403 — Manager lacks counts.create)",
            "POST",
            f"/businesses/{business_a}/counts/",
            {"type": "closing", "lines": []},
            manager_token,
        ),
        (
            "Manager records wastage (should be 403 — Manager lacks wastage.create)",
            "POST",
            f"/businesses/{business_a}/wastage/",
            {"stock_item": stock_item_id, "quantity": "1.000", "reason": "spoiled"},
            manager_token,
        ),
        (
            "Helper edits a stock item's price (should be 403 — Helper lacks stockitems.manage)",
            "PATCH",
            f"/businesses/{business_a}/stock-items/{stock_item_id}/",
            {"usual_price": "999.00"},
            helper_token,
        ),
        (
            "Head chef creates a sale (should be 403 — Head chef lacks sales.create)",
            "POST",
            f"/businesses/{business_a}/sales/",
            {
                "business_date": datetime.now(dt_timezone.utc).date().isoformat(),
                "lines": [{"sell_item": sell_item_id, "quantity": "1"}],
            },
            head_chef_token,
        ),
        (
            "Manager adds a team member (should be 403 — Manager lacks team.manage)",
            "POST",
            f"/businesses/{business_a}/team/",
            {"mobile": rand_mobile(), "role": "helper", "name": "X", "secret": "1234"},
            manager_token,
        ),
        (
            "Head chef tries to promote themself to manager (should be 403 — no team.manage)",
            "PATCH",
            f"/businesses/{business_a}/team/1/",
            {"role": "manager", "secret": "Correct-Horse-9"},
            head_chef_token,
        ),
        (
            "Outsider Owner B reads Business A's stock items by guessing the id (should be 403)",
            "GET",
            f"/businesses/{business_a}/stock-items/",
            None,
            owner_b_token,
        ),
        (
            "Outsider Owner B reads Business A's count detail by guessing the id (should be 403)",
            "GET",
            f"/businesses/{business_a}/counts/{count_id}/",
            None,
            owner_b_token,
        ),
        (
            "Unauthenticated caller reads Business A's stock items (should be 401)",
            "GET",
            f"/businesses/{business_a}/stock-items/",
            None,
            None,
        ),
    ]
    for description, method, path, body, token in write_probes:
        status, resp_body = request(method, path, body, token=token)
        print(f"  [{status}] {description}")

    print(f"\nSeeded business_a={business_a}, business_b={business_b}, count_id={count_id}")
    print("Done.")


if __name__ == "__main__":
    main()
