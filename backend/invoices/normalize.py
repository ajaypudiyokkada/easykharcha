"""Name normalising and similarity for matching a bill line to one of the owner's items you sell.
Plain stdlib (no models, no Django), so the AI fake provider can use the very same maths."""

import re
from difflib import SequenceMatcher

_NON_WORD = re.compile(r"[^\w\s]", flags=re.UNICODE)
_SPACES = re.compile(r"\s+")


def normalize_name(text: str) -> str:
    """lowercase, "&" -> "and", punctuation removed, spaces collapsed and trimmed. The ONE function
    used for aliases, item names and bill lines."""
    lowered = str(text or "").lower().replace("&", " and ")
    return _SPACES.sub(" ", _NON_WORD.sub(" ", lowered)).strip()


def similarity(a: str, b: str) -> float:
    """0 to 1 over two ALREADY-normalised names. Token-aware: the better of the plain character
    ratio and the ratio with words sorted (so "burger crispy" ~ "crispy burger"), nudged up when one
    name's words are all inside the other's."""
    if not a or not b:
        return 0.0
    plain = SequenceMatcher(None, a, b).ratio()
    sorted_ratio = SequenceMatcher(
        None, " ".join(sorted(a.split())), " ".join(sorted(b.split()))
    ).ratio()
    score = max(plain, sorted_ratio)
    tokens_a, tokens_b = set(a.split()), set(b.split())
    if tokens_a and tokens_b and (tokens_a <= tokens_b or tokens_b <= tokens_a):
        # One is a word-subset of the other ("tea" in "masala tea"): related, but never a sure match.
        score = max(
            score,
            min(0.85, 0.5 + 0.35 * len(tokens_a & tokens_b) / max(len(tokens_a), len(tokens_b))),
        )
    return round(score, 4)
