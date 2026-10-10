"""Cost, variance, trends and alerts.

Every formula here comes from docs/product.md §4, §5, §5b. Non-negotiable #5: this module is the only
place the arithmetic exists — the client renders what it is given and never recomputes.

Two notes where the spec's prose needed a decision, both marked inline below:

1. `yield_pct` is a property of the *ingredient*, so the `÷ (yield_pct/100)` must be applied per recipe
   line, inside the sum, not to the summed total. Applying it outside would be wrong for any dish whose
   ingredients have different yields.
2. `consumed` and `actual_used` are **null**, not zero, when the opening or closing count is missing. A
   missing count is "we don't know", and reporting it as zero cost would hide exactly the problem this
   product exists to surface.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

from django.db.models import DecimalField, F, Q, Sum
from django.db.models.functions import Coalesce

from core.fields import ZERO, d, q2, q3
from inventory.models import (
    DailyStock,
    Dish,
    Ingredient,
    Purchase,
    Request,
    RequestStatus,
    Sale,
    Wastage,
)

HUNDRED = Decimal("100")


def _pct(numerator: Decimal | None, denominator: Decimal | None) -> Decimal | None:
    """numerator/denominator as a percentage, or None when the denominator is zero/unknown."""
    if numerator is None or not denominator:
        return None
    return q2(d(numerator) / d(denominator) * HUNDRED)


# ---------------------------------------------------------------------------------------------
# Gathering raw movement per ingredient
# ---------------------------------------------------------------------------------------------


@dataclass
class Movement:
    """One ingredient's physical movement across a date range."""

    ingredient: Ingredient
    opening: Decimal | None
    closing: Decimal | None
    purchased_qty: Decimal
    purchase_value: Decimal
    wastage_qty: Decimal
    short_qty: Decimal = ZERO

    @property
    def weighted_rate(self) -> Decimal:
        """Weighted average purchase rate, falling back to the standard rate with no purchases."""
        if self.purchased_qty > 0:
            return d(self.purchase_value) / d(self.purchased_qty)
        return d(self.ingredient.rate)

    @property
    def actual_used(self) -> Decimal | None:
        """Total disappearance including wastage. None when a count is missing (note 2 above)."""
        if self.opening is None or self.closing is None:
            return None
        return d(self.opening) + d(self.purchased_qty) - d(self.closing)

    @property
    def consumed(self) -> Decimal | None:
        """What went into dishes: disappearance minus recorded wastage."""
        used = self.actual_used
        return None if used is None else used - d(self.wastage_qty)

    @property
    def cost(self) -> Decimal | None:
        consumed = self.consumed
        return None if consumed is None else q2(consumed * self.weighted_rate)

    @property
    def missing_counts(self) -> list[str]:
        missing = []
        if self.opening is None:
            missing.append("opening")
        if self.closing is None:
            missing.append("closing")
        return missing


def _opening_for(business, ingredient_ids: list[int], start: date) -> dict[int, Decimal]:
    """Opening at range start: that day's opening if captured, else the last closing before it."""
    openings: dict[int, Decimal] = {}

    same_day = DailyStock.objects.filter(
        business=business, ingredient_id__in=ingredient_ids, date=start, opening_qty__isnull=False
    ).values_list("ingredient_id", "opening_qty")
    openings.update(dict(same_day))

    remaining = [i for i in ingredient_ids if i not in openings]
    if remaining:
        prior = (
            DailyStock.objects.filter(
                business=business,
                ingredient_id__in=remaining,
                date__lt=start,
                closing_qty__isnull=False,
            )
            .order_by("ingredient_id", "-date")
            .values_list("ingredient_id", "closing_qty", "date")
        )
        for ingredient_id, closing, _day in prior:
            openings.setdefault(ingredient_id, closing)
    return openings


def _closing_for(business, ingredient_ids: list[int], start: date, end: date) -> dict[int, Decimal]:
    """The latest closing captured inside the range."""
    rows = (
        DailyStock.objects.filter(
            business=business,
            ingredient_id__in=ingredient_ids,
            date__gte=start,
            date__lte=end,
            closing_qty__isnull=False,
        )
        .order_by("ingredient_id", "-date")
        .values_list("ingredient_id", "closing_qty")
    )
    closings: dict[int, Decimal] = {}
    for ingredient_id, closing in rows:
        closings.setdefault(ingredient_id, closing)
    return closings


def movements(business, start: date, end: date) -> dict[int, Movement]:
    ingredients = list(
        Ingredient.objects.filter(business=business).select_related("vendor", "canonical")
    )
    ids = [i.id for i in ingredients]

    purchases = {
        row["ingredient"]: row
        for row in Purchase.objects.filter(business=business, date__gte=start, date__lte=end)
        .values("ingredient")
        .annotate(
            qty=Coalesce(Sum("qty_received"), ZERO, output_field=DecimalField()),
            value=Coalesce(
                Sum(F("qty_received") * F("rate"), output_field=DecimalField()),
                ZERO,
                output_field=DecimalField(),
            ),
            short=Coalesce(
                Sum(
                    F("qty_invoiced") - F("qty_received"),
                    filter=Q(qty_received__lt=F("qty_invoiced")),
                    output_field=DecimalField(),
                ),
                ZERO,
                output_field=DecimalField(),
            ),
        )
    }
    wastages = dict(
        Wastage.objects.filter(business=business, date__gte=start, date__lte=end)
        .values_list("ingredient")
        .annotate(qty=Coalesce(Sum("qty"), ZERO, output_field=DecimalField()))
    )
    openings = _opening_for(business, ids, start)
    closings = _closing_for(business, ids, start, end)

    result = {}
    for ingredient in ingredients:
        purchase = purchases.get(ingredient.id, {})
        result[ingredient.id] = Movement(
            ingredient=ingredient,
            opening=openings.get(ingredient.id),
            closing=closings.get(ingredient.id),
            purchased_qty=d(purchase.get("qty", ZERO)),
            purchase_value=d(purchase.get("value", ZERO)),
            wastage_qty=d(wastages.get(ingredient.id, ZERO)),
            short_qty=d(purchase.get("short", ZERO)),
        )
    return result


def dish_sales(business, start: date, end: date) -> dict[int, dict]:
    """Plates and revenue per dish across the range."""
    rows = (
        Sale.objects.filter(business=business, date__gte=start, date__lte=end)
        .values("dish")
        .annotate(
            plates=Coalesce(Sum("plates"), 0),
            revenue=Coalesce(Sum("revenue"), ZERO, output_field=DecimalField()),
        )
    )
    return {row["dish"]: {"plates": row["plates"], "revenue": d(row["revenue"])} for row in rows}


# ---------------------------------------------------------------------------------------------
# §5 — cost report
# ---------------------------------------------------------------------------------------------


def cost_report(business, start: date, end: date) -> dict:
    move = movements(business, start, end)
    sales = dish_sales(business, start, end)
    dishes = {
        dish.id: dish for dish in Dish.objects.filter(business=business).select_related("ing")
    }
    recipe_by_dish = _recipe_lines_by_dish(business)

    total_revenue = sum((s["revenue"] for s in sales.values()), ZERO)

    # Revenue attributable to each *primary* ingredient — the denominator in §5 step 3.
    revenue_by_primary: dict[int, Decimal] = {}
    for dish_id, figures in sales.items():
        dish = dishes.get(dish_id)
        if dish is None:
            continue
        revenue_by_primary[dish.ing_id] = (
            revenue_by_primary.get(dish.ing_id, ZERO) + figures["revenue"]
        )

    shared_pool = ZERO
    ingredient_rows = []
    for movement in move.values():
        ingredient = movement.ingredient
        cost = movement.cost
        if ingredient.shared:
            if cost is not None:
                shared_pool += cost
            group_revenue = None
        else:
            group_revenue = revenue_by_primary.get(ingredient.id, ZERO)

        ingredient_rows.append(
            {
                "id": ingredient.id,
                "code": ingredient.code,
                "name": ingredient.name,
                "unit": ingredient.unit,
                "shared": ingredient.shared,
                "track": ingredient.track,
                "opening": _q3_or_none(movement.opening),
                "purchased": q3(movement.purchased_qty),
                "closing": _q3_or_none(movement.closing),
                "wastage": q3(movement.wastage_qty),
                "consumed": _q3_or_none(movement.consumed),
                "weighted_rate": q2(movement.weighted_rate),
                "cost": cost,
                "cost_pct": None if ingredient.shared else _pct(cost, group_revenue),
                "target_pct": q2(
                    ingredient.target_pct
                    if ingredient.target_pct is not None
                    else business.default_target_pct
                ),
                "missing_counts": movement.missing_counts,
            }
        )

    dish_rows = []
    for dish_id, figures in sorted(sales.items(), key=lambda kv: kv[1]["revenue"], reverse=True):
        dish = dishes.get(dish_id)
        if dish is None:
            continue
        revenue = figures["revenue"]
        movement = move.get(dish.ing_id)
        group_revenue = revenue_by_primary.get(dish.ing_id, ZERO)

        primary_cost = None
        if movement is not None and movement.cost is not None and group_revenue:
            primary_cost = q2(movement.cost * revenue / group_revenue)

        misc_cost = q2(shared_pool * revenue / total_revenue) if total_revenue else ZERO

        est_cost = None if primary_cost is None else primary_cost + misc_cost
        standard = standard_cost_per_plate(recipe_by_dish.get(dish_id, []), move)

        dish_rows.append(
            {
                "id": dish.id,
                "code": dish.code,
                "name": dish.name,
                "section": dish.section,
                "price": q2(dish.price),
                "plates": figures["plates"],
                "revenue": q2(revenue),
                "primary_ingredient": dish.ing.name,
                "primary_cost": primary_cost,
                "misc_cost": misc_cost,
                "est_cost": est_cost,
                "est_cost_pct": _pct(est_cost, revenue),
                "has_recipe": standard is not None,
                "standard_cost_per_plate": standard,
                "standard_cost": None if standard is None else q2(standard * figures["plates"]),
                "standard_cost_pct": (
                    None
                    if standard is None
                    else _pct(standard * figures["plates"] + misc_cost, revenue)
                ),
                "target_pct": q2(
                    dish.ing.target_pct
                    if dish.ing.target_pct is not None
                    else business.default_target_pct
                ),
            }
        )

    # A total built from no known costs must read as "unknown", not as 0%. Reporting a 0% food cost
    # when every count is missing is the most flattering possible lie, and the owner would act on it.
    costed = [row for row in ingredient_rows if row["cost"] is not None]
    uncosted = [row for row in ingredient_rows if row["cost"] is None]
    total_cost = sum((row["cost"] for row in costed), ZERO) if costed else None

    return {
        "start": start,
        "end": end,
        "ingredients": ingredient_rows,
        "dishes": dish_rows,
        "totals": {
            "revenue": q2(total_revenue),
            "cost": None if total_cost is None else q2(total_cost),
            "cost_pct": _pct(total_cost, total_revenue),
            "shared_pool": q2(shared_pool),
            "target_pct": q2(business.default_target_pct),
            "plates": sum(s["plates"] for s in sales.values()),
            "ingredients_costed": len(costed),
            "ingredients_total": len(ingredient_rows),
            "ingredients_missing_counts": [row["name"] for row in uncosted],
            "complete": not uncosted,
        },
        "wastage_by_reason": wastage_by_reason(business, start, end),
        "segregation_flags": segregation_flags(business, start, end),
    }


def _q3_or_none(value):
    return None if value is None else q3(value)


def _recipe_lines_by_dish(business) -> dict[int, list]:
    from inventory.models import RecipeLine

    lines = RecipeLine.objects.filter(dish__business=business).select_related("ingredient", "dish")
    grouped: dict[int, list] = {}
    for line in lines:
        grouped.setdefault(line.dish_id, []).append(line)
    return grouped


def standard_cost_per_plate(lines: list, move: dict[int, Movement]) -> Decimal | None:
    """Σ per line of (qty ÷ units_per_stock_unit × rate ÷ yield). None for a dish with no recipe.

    Yield divides inside the sum — see note 1 at the top of this module.
    """
    if not lines:
        return None
    total = ZERO
    for line in lines:
        ingredient = line.ingredient
        movement = move.get(ingredient.id)
        rate = movement.weighted_rate if movement else d(ingredient.rate)
        stock_qty = d(line.qty_per_portion) / d(ingredient.recipe_units_per_stock_unit)
        stock_qty = stock_qty / (d(ingredient.yield_pct) / HUNDRED)
        total += stock_qty * rate
    return q2(total)


def wastage_by_reason(business, start: date, end: date) -> list[dict]:
    from inventory.models import WastageReason

    rows = (
        Wastage.objects.filter(business=business, date__gte=start, date__lte=end)
        .values("reason")
        # Named `total_qty`, not `qty`: an annotation called `qty` would shadow the column, and the
        # F("qty") below would then resolve to the aggregate instead of the field.
        .annotate(
            total_qty=Coalesce(Sum("qty"), ZERO, output_field=DecimalField()),
            total_value=Coalesce(
                Sum(F("qty") * F("ingredient__rate"), output_field=DecimalField()),
                ZERO,
                output_field=DecimalField(),
            ),
        )
        .order_by("-total_value")
    )
    labels = dict(WastageReason.choices)
    return [
        {
            "reason": row["reason"],
            "label": labels.get(row["reason"], row["reason"]),
            "qty": q3(row["total_qty"]),
            "value": q2(row["total_value"]),
        }
        for row in rows
    ]


# ---------------------------------------------------------------------------------------------
# §5b — variance
# ---------------------------------------------------------------------------------------------


@dataclass
class VarianceFigures:
    """The pure arithmetic of §5b, free of the ORM so it can be unit-tested directly."""

    actual_used: Decimal | None
    expected: Decimal
    wastage: Decimal
    rate: Decimal

    @property
    def unexplained(self) -> Decimal | None:
        if self.actual_used is None:
            return None
        return d(self.actual_used) - d(self.expected) - d(self.wastage)

    @property
    def value(self) -> Decimal | None:
        unexplained = self.unexplained
        return None if unexplained is None else q2(unexplained * d(self.rate))

    @property
    def pct(self) -> Decimal | None:
        unexplained = self.unexplained
        if unexplained is None or not self.expected:
            return None
        return q2(d(unexplained) / d(self.expected) * HUNDRED)


def variance_report(business, start: date, end: date) -> dict:
    move = movements(business, start, end)
    sales = dish_sales(business, start, end)
    dishes = {
        dish.id: dish for dish in Dish.objects.filter(business=business).select_related("ing")
    }
    recipe_by_dish = _recipe_lines_by_dish(business)

    # expected quantity, and the revenue that is "covered" by a recipe, per ingredient
    expected: dict[int, Decimal] = {}
    covered_revenue: dict[int, Decimal] = {}
    using_revenue: dict[int, Decimal] = {}
    dishes_using: dict[int, set[int]] = {}
    plates_using: dict[int, int] = {}

    for dish_id, figures in sales.items():
        dish = dishes.get(dish_id)
        if dish is None:
            continue
        revenue, plates = figures["revenue"], figures["plates"]
        lines = recipe_by_dish.get(dish_id, [])

        if lines:
            for line in lines:
                ingredient = line.ingredient
                per_plate = d(line.qty_per_portion) / d(ingredient.recipe_units_per_stock_unit)
                per_plate = per_plate / (d(ingredient.yield_pct) / HUNDRED)
                expected[ingredient.id] = expected.get(ingredient.id, ZERO) + per_plate * plates
                covered_revenue[ingredient.id] = covered_revenue.get(ingredient.id, ZERO) + revenue
                using_revenue[ingredient.id] = using_revenue.get(ingredient.id, ZERO) + revenue
                dishes_using.setdefault(ingredient.id, set()).add(dish_id)
                plates_using[ingredient.id] = plates_using.get(ingredient.id, 0) + plates
        else:
            # A dish with no recipe still *uses* its primary ingredient — it just contributes nothing
            # to `expected`, which is exactly why coverage must drop below 100% and suppress the alert.
            using_revenue[dish.ing_id] = using_revenue.get(dish.ing_id, ZERO) + revenue
            dishes_using.setdefault(dish.ing_id, set()).add(dish_id)
            plates_using[dish.ing_id] = plates_using.get(dish.ing_id, 0) + plates

    rows = []
    for movement in move.values():
        ingredient = movement.ingredient
        if ingredient.shared or not ingredient.track:
            continue

        expected_qty = expected.get(ingredient.id, ZERO)
        using = using_revenue.get(ingredient.id, ZERO)
        covered = covered_revenue.get(ingredient.id, ZERO)
        coverage_pct = _pct(covered, using)

        figures = VarianceFigures(
            actual_used=movement.actual_used,
            expected=expected_qty,
            wastage=movement.wastage_qty,
            rate=movement.weighted_rate,
        )

        threshold = d(
            ingredient.variance_alert_pct
            if ingredient.variance_alert_pct is not None
            else business.variance_alert_pct
        )

        status, alert = _variance_status(figures, coverage_pct, threshold, movement)

        rows.append(
            {
                "id": ingredient.id,
                "code": ingredient.code,
                "name": ingredient.name,
                "unit": ingredient.unit,
                "recipe_unit": ingredient.recipe_unit,
                "opening": _q3_or_none(movement.opening),
                "purchased": q3(movement.purchased_qty),
                "closing": _q3_or_none(movement.closing),
                "actual_used": _q3_or_none(movement.actual_used),
                "expected": q3(expected_qty),
                "wastage": q3(movement.wastage_qty),
                "unexplained": _q3_or_none(figures.unexplained),
                "unexplained_value": figures.value,
                "unexplained_pct": figures.pct,
                "weighted_rate": q2(movement.weighted_rate),
                "coverage_pct": coverage_pct,
                "threshold_pct": q2(threshold),
                "status": status,
                "alert": alert,
                "dishes_using": len(dishes_using.get(ingredient.id, ())),
                "implied_portion": _implied_portion(
                    movement,
                    dishes_using.get(ingredient.id, set()),
                    plates_using.get(ingredient.id, 0),
                    recipe_by_dish,
                    ingredient,
                ),
                "missing_counts": movement.missing_counts,
            }
        )

    rows.sort(key=lambda row: abs(row["unexplained_value"] or ZERO), reverse=True)

    covered_rows = [r for r in rows if r["status"] in ("ok", "alert")]
    return {
        "start": start,
        "end": end,
        "rows": rows,
        "kitchen_efficiency_pct": kitchen_efficiency(covered_rows),
        "totals": {
            "unexplained_value": q2(sum((r["unexplained_value"] or ZERO) for r in covered_rows)),
            "unexplained_loss_value": q2(
                sum(
                    (r["unexplained_value"] or ZERO)
                    for r in covered_rows
                    if (r["unexplained_value"] or ZERO) > 0
                )
            ),
        },
    }


def _variance_status(
    figures: VarianceFigures, coverage_pct: Decimal | None, threshold: Decimal, movement: Movement
) -> tuple[str, bool]:
    """Status strings the client renders verbatim; `alert` gates the banner.

    The coverage rule (§5b) is the important one: a half-configured ingredient must not raise an alert,
    or the owner learns to ignore the report.
    """
    if movement.actual_used is None:
        return "missing_counts", False
    if coverage_pct is None:
        return "no_sales", False
    if coverage_pct < HUNDRED:
        return "incomplete_recipes", False
    if figures.pct is None:
        return "no_expected", False
    return ("alert", True) if abs(figures.pct) > threshold else ("ok", False)


def _implied_portion(
    movement: Movement,
    dish_ids: set[int],
    plates: int,
    recipe_by_dish: dict[int, list],
    ingredient,
) -> dict | None:
    """§5d: for an ingredient used by exactly one dish, what the kitchen actually spends per plate.

    A suggestion only. Auto-updating the recipe from this would quietly absorb real theft into the
    "correct" portion size.
    """
    if len(dish_ids) != 1 or plates <= 0:
        return None
    consumed = movement.consumed
    if consumed is None or consumed <= 0:
        return None

    per_plate_stock = d(consumed) / d(plates)
    per_plate_recipe = (
        per_plate_stock
        * d(ingredient.recipe_units_per_stock_unit)
        * (d(ingredient.yield_pct) / HUNDRED)
    )

    dish_id = next(iter(dish_ids))
    current = next(
        (
            d(line.qty_per_portion)
            for line in recipe_by_dish.get(dish_id, [])
            if line.ingredient_id == ingredient.id
        ),
        None,
    )
    return {
        "implied_qty_per_portion": q3(per_plate_recipe),
        "recipe_qty_per_portion": None if current is None else q3(current),
        "unit": ingredient.recipe_unit,
        "plates": plates,
    }


def kitchen_efficiency(covered_rows: list[dict]) -> Decimal | None:
    """1 − Σ|unexplained value| ÷ Σ(value of everything that moved), as a percentage.

    ⚠ docs/DECISIONS.md O-2: label and definition still to be confirmed with the owner.
    """
    total_unexplained = ZERO
    total_used_value = ZERO
    for row in covered_rows:
        if row["unexplained_value"] is None or row["actual_used"] is None:
            continue
        total_unexplained += abs(d(row["unexplained_value"]))
        total_used_value += d(row["actual_used"]) * d(row["weighted_rate"])
    if not total_used_value:
        return None
    return q2((Decimal("1") - total_unexplained / total_used_value) * HUNDRED)


# ---------------------------------------------------------------------------------------------
# §1b — segregation of duties
# ---------------------------------------------------------------------------------------------


def segregation_flags(business, start: date, end: date) -> list[dict]:
    """Dates where one non-Owner user recorded both the stock count and the sales.

    Flag only, never a block: a two-person restaurant would be unable to operate under a hard block, and
    an Owner-operated one legitimately does both (docs/DECISIONS.md O-1).
    """
    from accounts.models import Access
    from core.roles import OWNER, SUPER_ADMIN

    stock_rows = DailyStock.objects.filter(
        business=business, date__gte=start, date__lte=end
    ).values_list("date", "opened_by", "closed_by")
    sale_rows = Sale.objects.filter(business=business, date__gte=start, date__lte=end).values_list(
        "date", "entered_by"
    )

    stock_users: dict[date, set[int]] = {}
    for day, opened_by, closed_by in stock_rows:
        for user_id in (opened_by, closed_by):
            if user_id:
                stock_users.setdefault(day, set()).add(user_id)

    sale_users: dict[date, set[int]] = {}
    for day, entered_by in sale_rows:
        if entered_by:
            sale_users.setdefault(day, set()).add(entered_by)

    # Owner/SA are exempt. Roles are read now, not as of the entry — the product has no role history,
    # and the flag is a prompt to look, not an accusation.
    exempt = set(
        Access.objects.filter(
            Q(business=business) | Q(business__isnull=True),
            role__in=[OWNER, SUPER_ADMIN],
            active=True,
        ).values_list("user_id", flat=True)
    )

    names = {}
    flags = []
    for day in sorted(set(stock_users) & set(sale_users)):
        both = (stock_users[day] & sale_users[day]) - exempt
        for user_id in sorted(both):
            if user_id not in names:
                from accounts.models import User

                user = User.objects.filter(pk=user_id).first()
                names[user_id] = (user.name or user.phone) if user else f"#{user_id}"
            flags.append(
                {
                    "date": day,
                    "user_id": user_id,
                    "user": names[user_id],
                    "message": f"{names[user_id]} recorded both stock and sales on {day}.",
                }
            )
    return flags


# ---------------------------------------------------------------------------------------------
# §4 — alerts
# ---------------------------------------------------------------------------------------------


SEVERITY_ORDER = {"high": 0, "medium": 1, "low": 2}


def _alert(severity: str, code: str, message: str, **extra) -> dict:
    return {"severity": severity, "code": code, "message": message, **extra}


def sla_alerts(business, now) -> list[dict]:
    """Closing stock for yesterday after `sla_hours`; opening for today after `sla_hours / 2`."""
    today = now.date()
    yesterday = today - timedelta(days=1)
    hours_elapsed = now.hour + now.minute / 60

    tracked = list(Ingredient.objects.filter(business=business, track=True))
    if not tracked:
        return []
    tracked_ids = [i.id for i in tracked]
    names = {i.id: i.name for i in tracked}

    out = []
    if hours_elapsed >= business.sla_hours:
        have_closing = set(
            DailyStock.objects.filter(
                business=business,
                date=yesterday,
                ingredient_id__in=tracked_ids,
                closing_qty__isnull=False,
            ).values_list("ingredient_id", flat=True)
        )
        missing = [names[i] for i in tracked_ids if i not in have_closing]
        if missing:
            out.append(
                _alert(
                    "high",
                    "sla_closing",
                    f"Closing stock for {yesterday} still missing for "
                    f"{len(missing)} ingredient(s): {', '.join(missing[:5])}"
                    + ("…" if len(missing) > 5 else ""),
                    date=yesterday,
                    count=len(missing),
                )
            )

    if hours_elapsed >= business.sla_hours / 2:
        have_opening = set(
            DailyStock.objects.filter(
                business=business,
                date=today,
                ingredient_id__in=tracked_ids,
                opening_qty__isnull=False,
            ).values_list("ingredient_id", flat=True)
        )
        missing = [names[i] for i in tracked_ids if i not in have_opening]
        if missing:
            out.append(
                _alert(
                    "high",
                    "sla_opening",
                    f"Opening stock for today still missing for {len(missing)} ingredient(s): "
                    f"{', '.join(missing[:5])}" + ("…" if len(missing) > 5 else ""),
                    date=today,
                    count=len(missing),
                )
            )
    return out


def operational_alerts(business, start: date, end: date) -> list[dict]:
    out = []

    open_requests = Request.objects.filter(business=business, status=RequestStatus.OPEN).count()
    if open_requests:
        out.append(
            _alert(
                "medium",
                "open_requests",
                f"{open_requests} inventory request(s) still open.",
                count=open_requests,
            )
        )

    shorts = (
        Purchase.objects.filter(
            business=business, date__gte=start, date__lte=end, qty_received__lt=F("qty_invoiced")
        )
        .select_related("ingredient", "vendor")
        .order_by("-date")[:20]
    )
    for purchase in shorts:
        out.append(
            _alert(
                "medium",
                "short_delivery",
                f"Short delivery on {purchase.date}: {purchase.ingredient.name} — invoiced "
                f"{q3(purchase.qty_invoiced)}, received {q3(purchase.qty_received)} "
                f"({purchase.vendor.name}).",
                date=purchase.date,
                ingredient=purchase.ingredient.name,
            )
        )

    creep_factor = Decimal("1") + d(business.rate_creep_pct) / HUNDRED
    creeps = (
        Purchase.objects.filter(business=business, date__gte=start, date__lte=end)
        .filter(ingredient__rate__gt=0, rate__gt=F("ingredient__rate") * creep_factor)
        .select_related("ingredient", "vendor")
        .order_by("-date")[:20]
    )
    for purchase in creeps:
        over = _pct(d(purchase.rate) - d(purchase.ingredient.rate), purchase.ingredient.rate)
        out.append(
            _alert(
                "medium",
                "rate_creep",
                f"Rate creep on {purchase.ingredient.name}: paid ₹{q2(purchase.rate)} vs standard "
                f"₹{q2(purchase.ingredient.rate)} (+{over}%) on {purchase.date}.",
                date=purchase.date,
                ingredient=purchase.ingredient.name,
            )
        )
    return out


def threshold_alerts(business, start: date, end: date, report: dict | None = None) -> list[dict]:
    """Cost over target, wastage over threshold, and unexplained variance."""
    report = report or cost_report(business, start, end)
    out = []

    for row in report["ingredients"]:
        if row["cost_pct"] is not None and row["cost_pct"] > row["target_pct"]:
            out.append(
                _alert(
                    "medium",
                    "cost_over_target",
                    f"{row['name']} at {row['cost_pct']}% of its dishes' revenue "
                    f"(target {row['target_pct']}%).",
                    ingredient=row["name"],
                )
            )

    move = movements(business, start, end)
    for movement in move.values():
        ingredient = movement.ingredient
        base = d(movement.opening or ZERO) + d(movement.purchased_qty)
        if not base or not movement.wastage_qty:
            continue
        waste_pct = _pct(movement.wastage_qty, base)
        threshold = d(
            ingredient.waste_alert_pct
            if ingredient.waste_alert_pct is not None
            else business.waste_alert_pct
        )
        if waste_pct is not None and waste_pct > threshold:
            out.append(
                _alert(
                    "medium",
                    "waste_over_threshold",
                    f"Wastage on {ingredient.name} is {waste_pct}% of stock handled "
                    f"(threshold {q2(threshold)}%).",
                    ingredient=ingredient.name,
                )
            )

    for row in variance_report(business, start, end)["rows"]:
        if not row["alert"]:
            continue
        direction = "loss" if (row["unexplained"] or ZERO) > 0 else "gain"
        out.append(
            _alert(
                "high",
                "unexplained_variance",
                f"Unexplained {direction} on {row['name']}: {row['unexplained']} {row['unit']} "
                f"(₹{row['unexplained_value']}, {row['unexplained_pct']}% of expected).",
                ingredient=row["name"],
            )
        )

    for flag in report["segregation_flags"]:
        out.append(_alert("low", "segregation", flag["message"], date=flag["date"]))

    return out


def alerts(business, now=None, start: date | None = None, end: date | None = None) -> list[dict]:
    """Everything worth putting on the banner. Defaults to the current week for range-based checks."""
    from django.utils import timezone

    now = now or timezone.localtime()
    if start is None or end is None:
        start, end = week_bounds(now.date())

    out = sla_alerts(business, now)
    out += operational_alerts(business, start, end)
    out += threshold_alerts(business, start, end)
    out.sort(key=lambda alert: SEVERITY_ORDER.get(alert["severity"], 9))
    return out


# ---------------------------------------------------------------------------------------------
# §6 — trends
# ---------------------------------------------------------------------------------------------


def week_bounds(day: date) -> tuple[date, date]:
    """Monday–Sunday containing `day`."""
    start = day - timedelta(days=day.weekday())
    return start, start + timedelta(days=6)


def trends(business, weeks: int = 8, today: date | None = None) -> dict:
    """N independent cost reports over consecutive weekly windows (§6)."""
    from django.utils import timezone

    today = today or timezone.localdate()
    this_week_start, _ = week_bounds(today)

    series = []
    per_ingredient: dict[str, list] = {}
    for offset in range(weeks - 1, -1, -1):
        start = this_week_start - timedelta(weeks=offset)
        end = start + timedelta(days=6)
        report = cost_report(business, start, end)
        series.append(
            {
                "start": start,
                "end": end,
                "label": start.strftime("%d %b"),
                "revenue": report["totals"]["revenue"],
                "cost": report["totals"]["cost"],
                "cost_pct": report["totals"]["cost_pct"],
            }
        )
        for row in report["ingredients"]:
            if row["shared"]:
                continue
            per_ingredient.setdefault(row["name"], []).append(
                {"label": start.strftime("%d %b"), "cost_pct": row["cost_pct"]}
            )

    return {
        "weeks": weeks,
        "total": series,
        "ingredients": [
            {"name": name, "points": points} for name, points in sorted(per_ingredient.items())
        ],
    }
