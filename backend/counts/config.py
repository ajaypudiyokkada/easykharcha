"""Tunable constants for the unusual-value guard on blind stock counts — named here, not inline in
the view, so the rule (and the reasoning behind it) lives in one obvious place."""

from decimal import Decimal

# Flag a counted value when it's more than this many times the higher of (a) the item's own
# recent-count history or (b) how much of it was bought recently — a cheap, no-false-negative way
# to catch a typo (80 instead of 8) without needing real "expected" math, which doesn't exist yet.
UNUSUAL_VALUE_MULTIPLIER = Decimal("3")

# How many of the item's most recent *counted* values (any count type) to look back across.
UNUSUAL_VALUE_LOOKBACK_COUNTS = 5

# How many days of purchases to look back across for the same comparison.
UNUSUAL_VALUE_LOOKBACK_DAYS = 7

# Step 23b: how many hours past closing_count_hour the Today status still calls the closing count
# merely "due" rather than "late" — opening has no such grace, it's late immediately past its own
# deadline (count_deadline_hour).
CLOSING_GRACE_HOURS = 2
