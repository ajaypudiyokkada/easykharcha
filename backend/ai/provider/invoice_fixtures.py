"""Canned bill readings for AI_FAKE (Step S4a): plain JSON-shaped dicts, no real images. Each is what a
good model would return for that bill, run through the same schema as a real answer. Selected by the
import's `fixture` field (AI_FAKE only)."""

DEFAULT_FIXTURE = "fomo_14753"


def _line(name, qty, rate, amount):
    return {
        "name_as_printed": name,
        "qty": qty,
        "unit_rate": rate,
        "amount": amount,
        "confidence": 0.95,
    }


FIXTURES: dict[str, dict] = {
    # a. FOMO, a reprint stamped Duplicate
    "fomo_14753": {
        "readability": {"ok": True, "reason": ""},
        "bill_number": "14753",
        "bill_date_printed": "19/11/26",
        "bill_date": "2026-11-19",
        "lines": [
            _line("Fire Pork", 1, 380, 380),
            _line("Mutton Keema Panni Puri", 1, 320, 320),
            _line("Water Bottle", 3, 20, 60),
            _line("Mixed Fried Rice", 1, 300, 300),
        ],
        "items_total": 1060,
        "discounts": [],
        "taxes": [{"label": "SGST 2.5%", "amount": 25}, {"label": "CGST 2.5%", "amount": 25}],
        "grand_total": 1110,
        "is_reprint": True,
        "confidence": {"bill_number": 0.97, "bill_date": 0.95, "grand_total": 0.98},
    },
    # b. FOMO, ten lines, tax printed rounded down
    "fomo_14751": {
        "readability": {"ok": True, "reason": ""},
        "bill_number": "14751",
        "bill_date_printed": "19/11/26",
        "bill_date": "2026-11-19",
        "lines": [
            _line("Chicken Alfredo Pasta", 1, 300, 300),
            _line("Oreo Milkshake", 1, 150, 150),
            _line("Tea", 1, 50, 50),
            _line("Hot Chocolate", 1, 80, 80),
            _line("Masala Tea", 1, 60, 60),
            _line("French Fries", 1, 120, 120),
            _line("Sweet Lassi", 1, 120, 120),
            _line("Chicken Steak", 1, 380, 380),
            _line("Chicken Noodles", 1, 220, 220),
            _line("Water Bottle", 1, 20, 20),
        ],
        "items_total": 1500,
        "taxes": [{"label": "SGST", "amount": 37}, {"label": "CGST", "amount": 37}],
        "grand_total": 1574,
        "confidence": {"bill_number": 0.97, "bill_date": 0.95, "grand_total": 0.98},
    },
    # c. Spice Route: discount, round off, UPI, a long bill number and dd-mm-yyyy date
    "spice_route": {
        "readability": {"ok": True, "reason": ""},
        "bill_number": "KOL/26-27/004521",
        "bill_date_printed": "11-10-2026",
        "bill_date": "2026-10-11",
        "lines": [
            _line("Paneer Butter Masala", 1, 320, 320),
            _line("Butter Naan", 2, 60, 120),
            _line("Fresh Lime Soda", 2, 90, 180),
        ],
        "items_total": 620,
        "discounts": [{"label": "Discount 10%", "amount": -62}],
        "taxes": [{"label": "CGST", "amount": 13.95}, {"label": "SGST", "amount": 13.95}],
        "round_off": 0.10,
        "grand_total": 586,
        "payment_mode": "upi",
        "confidence": {"bill_number": 0.9, "bill_date": 0.93, "grand_total": 0.97},
    },
    # d. Bhagini: quantity suffixes, "16 May 2024", cash
    "bhagini": {
        "readability": {"ok": True, "reason": ""},
        "bill_number": "7767",
        "bill_date_printed": "16 May 2024",
        "bill_date": "2024-05-16",
        "lines": [
            _line("Mutton biriyani", "4No", 400, 1600),
            _line("Tandoori Roti", "5No", 30, 150),
            _line("Chilly chicken", "2No", 250, 500),
            _line("Chicken pepper", "3No", 250, 750),
        ],
        "items_total": 3000,
        "taxes": [{"label": "CGST", "amount": 75}, {"label": "SGST", "amount": 75}],
        "grand_total": 3150,
        "payment_mode": "cash",
        "confidence": {"bill_number": 0.95, "bill_date": 0.9, "grand_total": 0.97},
    },
    # e. Meat My Truk: misspelt names as printed, a packing charge line, no tax
    "meat_my_truk": {
        "readability": {"ok": True, "reason": ""},
        "bill_number": "2073",
        "bill_date_printed": "29/08/2025",
        "bill_date": "2025-08-29",
        "lines": [
            _line("Crspy Chi Burgr", 5, 180, 900),
            _line("Parcel Large", 1, 30, 30),
        ],
        "taxes": [],
        "grand_total": 930,
        "confidence": {"bill_number": 0.9, "bill_date": 0.9, "grand_total": 0.95},
    },
    # f. A photo nobody could read
    "unreadable": {
        "readability": {"ok": False, "reason": "blurred"},
        "lines": [],
    },
}
