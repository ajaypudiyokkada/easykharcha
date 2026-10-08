"""Shared field helpers.

Quantities and money are Decimal everywhere. Float would accumulate error across the opening + purchased
- closing - wastage chain and make variance alerts fire on rounding noise.
"""

from decimal import Decimal

from django.core.validators import MinValueValidator
from django.db import models

ZERO = Decimal("0")


def quantity_field(**kwargs):
    """A physical quantity in the ingredient's stock unit. 3 dp covers grams expressed in kg."""
    kwargs.setdefault("max_digits", 14)
    kwargs.setdefault("decimal_places", 3)
    kwargs.setdefault("validators", [MinValueValidator(ZERO)])
    return models.DecimalField(**kwargs)


def money_field(**kwargs):
    kwargs.setdefault("max_digits", 14)
    kwargs.setdefault("decimal_places", 2)
    kwargs.setdefault("validators", [MinValueValidator(ZERO)])
    return models.DecimalField(**kwargs)


def percent_field(**kwargs):
    kwargs.setdefault("max_digits", 6)
    kwargs.setdefault("decimal_places", 2)
    kwargs.setdefault("validators", [MinValueValidator(ZERO)])
    return models.DecimalField(**kwargs)


def d(value) -> Decimal:
    """Coerce to Decimal without going through binary float."""
    if isinstance(value, Decimal):
        return value
    if value is None:
        return ZERO
    return Decimal(str(value))


def q3(value) -> Decimal:
    return d(value).quantize(Decimal("0.001"))


def q2(value) -> Decimal:
    return d(value).quantize(Decimal("0.01"))
