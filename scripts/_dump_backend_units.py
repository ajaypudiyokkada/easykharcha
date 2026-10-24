"""Dumps backend/stock/units.py's unit tables as JSON on stdout, for scripts/check_units_parity.mjs
to compare against mobile/src/units.ts. Pure stdlib + the units module itself (no Django setup
needed — units.py only imports `decimal`), same "no test suite, just a check script" style as
scripts/check_sector_copy.py.
"""

import json
import os
import sys

BACKEND_DIR = os.path.join(os.path.dirname(__file__), "..", "backend")
sys.path.insert(0, os.path.abspath(BACKEND_DIR))

from stock import units as u  # noqa: E402

print(
    json.dumps(
        {
            "UNIT_FAMILY": u.UNIT_FAMILY,
            "BASE_UNIT_FOR_FAMILY": u.BASE_UNIT_FOR_FAMILY,
            "PACK_ENTRY_UNITS": sorted(u.PACK_ENTRY_UNITS),
            "FAMILY_ENTRY_FACTORS": {
                family: {unit: str(factor) for unit, factor in factors.items()}
                for family, factors in u._FAMILY_ENTRY_FACTORS.items()
            },
            "QUANTITY_DECIMALS": -u.QUANTITY_QUANTUM.as_tuple().exponent,
            "PRICE_DECIMALS": -u.PRICE_QUANTUM.as_tuple().exponent,
            "MAJOR_UNIT_FOR_FAMILY": u.MAJOR_UNIT_FOR_FAMILY,
            "MAJOR_UNIT_FACTOR": str(u.MAJOR_UNIT_FACTOR),
        }
    )
)
