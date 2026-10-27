"""Step U2b1b2's acceptance check (docs/BASES_PLAN.md secs 2, 6, 8.2): the Chicken Curry base
example, a base shared by three dishes each with their own grams/portion, a stock item reached
both directly and via a base, and the U2b1b1 coverage bands — all run through the real
`stock.base_expansion.quantity_per_portion_by_sell_item` and `counts.gap.gap_for_line`, not a
reimplementation. Builds its own fixtures (business 15's existing team, inside one transaction,
rolled back at the end) rather than depending on fragile seed-data state.

Run: python manage.py verify_u2b1b2_bases_engine
"""

from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from businesses.models import Business
from counts.gap import gap_for_line, gap_window
from counts.models import CountType, StockCount
from sales.models import Sale
from stock.base_expansion import quantity_per_portion_by_sell_item
from stock.models import (
    Base,
    BaseIngredient,
    RecipeStatus,
    SellItem,
    SellItemBase,
    SellItemIngredient,
    StockItem,
)

ZERO = Decimal("0")


class Command(BaseCommand):
    help = "Proves the Chicken Curry base-expansion and coverage-wiring regression cases."

    def handle(self, *args, **options):
        failures = []

        with transaction.atomic():
            business = Business.objects.get(id=15)
            user = business.created_by

            def stock_item(name, unit, unit_family):
                return StockItem.objects.create(
                    business=business,
                    name=name,
                    unit=unit,
                    unit_family=unit_family,
                    created_by=user,
                )

            chicken = stock_item("QA Chicken", "g", "weight")
            onion = stock_item("QA Onion", "g", "weight")
            tomato = stock_item("QA Tomato", "g", "weight")
            oil = stock_item("QA Oil", "ml", "volume")
            cashew = stock_item("QA Cashew", "g", "weight")
            spices = stock_item("QA Spices", "g", "weight")
            salt = stock_item("QA Salt", "g", "weight")

            base = Base.objects.create(
                business=business,
                name="QA Onion-Tomato Masala",
                unit_family="weight",
                created_by=user,
            )
            BaseIngredient.objects.create(
                base=base, stock_item=onion, quantity_per_1000=Decimal("450")
            )
            BaseIngredient.objects.create(
                base=base, stock_item=tomato, quantity_per_1000=Decimal("400")
            )
            BaseIngredient.objects.create(
                base=base, stock_item=oil, quantity_per_1000=Decimal("90")
            )
            BaseIngredient.objects.create(
                base=base, stock_item=cashew, quantity_per_1000=Decimal("40")
            )
            BaseIngredient.objects.create(
                base=base, stock_item=spices, quantity_per_1000=Decimal("20")
            )
            # Both-paths-sum case (sec 2): Salt reaches Chicken Curry directly AND via the base.
            BaseIngredient.objects.create(
                base=base, stock_item=salt, quantity_per_1000=Decimal("10")
            )

            chicken_curry = SellItem.objects.create(
                business=business,
                name="QA Chicken Curry",
                selling_price=Decimal("250"),
                recipe_status=RecipeStatus.CONFIRMED,
                created_by=user,
            )
            SellItemIngredient.objects.create(
                sell_item=chicken_curry, stock_item=chicken, quantity=Decimal("180")
            )
            SellItemIngredient.objects.create(
                sell_item=chicken_curry, stock_item=salt, quantity=Decimal("5")
            )
            SellItemBase.objects.create(sell_item=chicken_curry, base=base, quantity=Decimal("200"))

            # Base used by many dishes: three more sell items on the same base, each its own
            # grams/portion, none of them touched by the Chicken Curry sale below.
            grams_per_portion = {
                "QA Red Curry A": Decimal("150"),
                "QA Red Curry B": Decimal("250"),
                "QA Red Curry C": Decimal("300"),
            }
            red_curry_items = {}
            for name, qty in grams_per_portion.items():
                item = SellItem.objects.create(
                    business=business,
                    name=name,
                    selling_price=Decimal("200"),
                    recipe_status=RecipeStatus.CONFIRMED,
                    created_by=user,
                )
                SellItemBase.objects.create(sell_item=item, base=base, quantity=qty)
                red_curry_items[name] = item

            self._check_expansion(failures, business, chicken, chicken_curry)
            self._check_expansion(failures, business, onion, chicken_curry)
            self._check_expansion(failures, business, tomato, chicken_curry)
            self._check_expansion(failures, business, oil, chicken_curry)
            self._check_expansion(failures, business, cashew, chicken_curry)
            self._check_expansion(failures, business, spices, chicken_curry)
            self._check_expansion(failures, business, salt, chicken_curry)
            self._check_many_dishes(failures, business, onion, grams_per_portion, red_curry_items)
            self._check_gap_for_line_wiring(failures, business, onion, chicken_curry)
            self._check_coverage_bands(failures, business, user)

            transaction.set_rollback(True)

        if failures:
            for f in failures:
                self.stderr.write(self.style.ERROR(f"FAIL: {f}"))
            raise CommandError(f"{len(failures)} check(s) failed")
        self.stdout.write(self.style.SUCCESS("All U2b1b2 bases-engine checks passed."))

    def _check_expansion(self, failures, business, item, chicken_curry):
        expected_per_portion = {
            "QA Chicken": Decimal("180"),
            "QA Onion": Decimal("90"),  # 200 * 450/1000
            "QA Tomato": Decimal("80"),  # 200 * 400/1000
            "QA Oil": Decimal("18"),  # 200 * 90/1000
            "QA Cashew": Decimal("8"),  # 200 * 40/1000
            "QA Spices": Decimal("4"),  # 200 * 20/1000
            "QA Salt": Decimal("7"),  # direct 5 + base 200*10/1000=2
        }
        totals = quantity_per_portion_by_sell_item(business, item)
        actual = totals.get(chicken_curry)
        expected = expected_per_portion[item.name]
        if actual != expected:
            failures.append(
                f"{item.name}: expected {expected}/portion for Chicken Curry, got {actual}"
            )
            return
        # 10 curries sold -> raw usage at that scale (sec 6's worked example).
        scaled = actual * 10
        expected_scaled = {
            "QA Chicken": Decimal("1800"),
            "QA Onion": Decimal("900"),
            "QA Tomato": Decimal("800"),
            "QA Oil": Decimal("180"),
            "QA Cashew": Decimal("80"),
            "QA Spices": Decimal("40"),
            "QA Salt": Decimal("70"),
        }[item.name]
        if scaled != expected_scaled:
            failures.append(f"{item.name}: expected {expected_scaled} for 10 curries, got {scaled}")
        else:
            self.stdout.write(f"{item.name}: {actual}/portion, {scaled} for 10 curries — OK")

    def _check_many_dishes(self, failures, business, onion, grams_per_portion, red_curry_items):
        totals = quantity_per_portion_by_sell_item(business, onion)
        for name, grams in grams_per_portion.items():
            expected = grams * Decimal("450") / Decimal("1000")
            actual = totals.get(red_curry_items[name])
            if actual != expected:
                failures.append(
                    f"base-shared-by-many-dishes: {name} expected {expected} onion/portion, got {actual}"
                )
        self.stdout.write(
            "Base shared by three dishes: each expands with its own grams/portion — OK"
        )

    def _check_gap_for_line_wiring(self, failures, business, onion, chicken_curry):
        """Proves the expansion is actually wired into gap_for_line, not just the raw function."""
        now = timezone.now()
        # Far-future placeholder business_date: only the unique-per-(business, type, date)
        # constraint cares about this field, gap_window works off submitted_at (set below).
        marker_date = now.date() + timezone.timedelta(days=1000)
        prev_count = StockCount.objects.create(
            business=business,
            count_type=CountType.OPENING,
            business_date=marker_date,
            counted_by=business.created_by,
            deadline_at=now,
        )
        count = StockCount.objects.create(
            business=business,
            count_type=CountType.CLOSING,
            business_date=marker_date,
            counted_by=business.created_by,
            deadline_at=now,
        )
        StockCount.objects.filter(pk=prev_count.pk).update(
            submitted_at=now - timezone.timedelta(hours=1)
        )
        StockCount.objects.filter(pk=count.pk).update(submitted_at=now)
        prev_count.refresh_from_db()
        count.refresh_from_db()
        window_start, window_end = gap_window(business, prev_count, count)
        if window_start != window_end:
            failures.append(
                f"gap_for_line wiring: expected a single-day window, got {window_start}..{window_end}"
            )
            return

        Sale.objects.create(
            business=business,
            sell_item=chicken_curry,
            business_date=window_start,
            quantity=Decimal("10"),
            amount=Decimal("2500"),
            recorded_by=business.created_by,
        )

        # 1000 g opening, 100 g left -> 900 g used, matching the base-expanded 900 g expected.
        result = gap_for_line(
            business, onion, Decimal("900"), prev_count, count, business.settings.gap_alert_pct
        )
        if result["expected_used"] != Decimal("900"):
            failures.append(
                f"gap_for_line wiring: expected_used expected 900, got {result['expected_used']}"
            )
            return
        if result["gap_qty"] != ZERO or result["gap_status"] != "ok" or result["flagged"]:
            failures.append(f"gap_for_line wiring: expected a clean zero-gap line, got {result}")
            return
        self.stdout.write(
            f"gap_for_line wiring: onion expected_used={result['expected_used']} g via base "
            f"expansion, coverage={result['coverage_pct']}% — OK"
        )

    def _check_coverage_bands(self, failures, business, user):
        """U2b1b1 regression (now sourced through base expansion, not just direct ingredients):
        an UNCONFIRMED dish using the same base alongside the CONFIRMED Chicken Curry must still
        split into the right coverage band."""
        shared = StockItem.objects.create(
            business=business,
            name="QA Shared Base Item",
            unit="g",
            unit_family="weight",
            created_by=user,
        )
        base2 = Base.objects.create(
            business=business, name="QA Band Test Base", unit_family="weight", created_by=user
        )
        BaseIngredient.objects.create(
            base=base2, stock_item=shared, quantity_per_1000=Decimal("1000")
        )

        confirmed_dish = SellItem.objects.create(
            business=business,
            name="QA Confirmed Dish",
            selling_price=Decimal("100"),
            recipe_status=RecipeStatus.CONFIRMED,
            created_by=user,
        )
        SellItemBase.objects.create(sell_item=confirmed_dish, base=base2, quantity=Decimal("100"))

        unconfirmed_dish = SellItem.objects.create(
            business=business,
            name="QA Unconfirmed Dish",
            selling_price=Decimal("100"),
            recipe_status=RecipeStatus.UNCONFIRMED,
            created_by=user,
        )
        SellItemBase.objects.create(sell_item=unconfirmed_dish, base=base2, quantity=Decimal("300"))

        now = timezone.now()
        marker_date = now.date() + timezone.timedelta(days=2000)
        prev_count = StockCount.objects.create(
            business=business,
            count_type=CountType.OPENING,
            business_date=marker_date,
            counted_by=user,
            deadline_at=now,
        )
        count = StockCount.objects.create(
            business=business,
            count_type=CountType.CLOSING,
            business_date=marker_date,
            counted_by=user,
            deadline_at=now,
        )
        StockCount.objects.filter(pk=prev_count.pk).update(
            submitted_at=now - timezone.timedelta(hours=1)
        )
        StockCount.objects.filter(pk=count.pk).update(submitted_at=now)
        prev_count.refresh_from_db()
        count.refresh_from_db()
        window_start, _ = gap_window(business, prev_count, count)

        # confirmed: 10 * 100*1000/1000 = 1000; unconfirmed: 10 * 300*1000/1000 = 3000.
        # coverage = 1000 / (1000+3000) = 25% -> not_comparable (below 40%).
        Sale.objects.create(
            business=business,
            sell_item=confirmed_dish,
            business_date=window_start,
            quantity=Decimal("10"),
            amount=Decimal("1000"),
            recorded_by=user,
        )
        Sale.objects.create(
            business=business,
            sell_item=unconfirmed_dish,
            business_date=window_start,
            quantity=Decimal("10"),
            amount=Decimal("1000"),
            recorded_by=user,
        )

        result = gap_for_line(
            business, shared, Decimal("900"), prev_count, count, business.settings.gap_alert_pct
        )
        if (
            result["gap_status"] != "not_comparable"
            or result["gap_reason"]["code"] != "low_recipe_coverage"
        ):
            failures.append(
                f"coverage band (<40%) via base expansion: expected not_comparable, got {result}"
            )
            return
        self.stdout.write("Coverage band <40% via base expansion still not_comparable — OK")
