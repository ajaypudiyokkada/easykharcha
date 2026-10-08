"""§5c sales import and §5d recipe templates."""

import io
from datetime import date
from decimal import Decimal

import pytest

from inventory.models import Confidence, Dish, Ingredient, RecipeLine, Sale, SaleSource
from recipes.models import (
    CanonicalIngredient,
    RecipeTemplate,
    RecipeTemplateLine,
    TemplateBasis,
)

pytestmark = pytest.mark.django_db

DAY = date(2026, 3, 2)


# ---------------------------------------------------------------------------------------------
# Recipe templates
# ---------------------------------------------------------------------------------------------


@pytest.fixture
def canonical_boneless(db):
    return CanonicalIngredient.objects.create(
        code="CHICKEN_BONELESS", name="Chicken — boneless", avg_piece_weight_g=Decimal("25")
    )


@pytest.fixture
def template(canonical_boneless):
    template = RecipeTemplate.objects.create(
        code="TPL-CHILLI", name="Chilli chicken", cuisine="Indo-Chinese", portion_label="6 pcs"
    )
    RecipeTemplateLine.objects.create(
        template=template,
        canonical=canonical_boneless,
        qty_per_portion=Decimal("150"),
        unit="g",
        basis=TemplateBasis.WEIGHT,
        confidence=Confidence.OWNER_STATED,
        size_multipliers={"half": 0.6, "full": 1.0},
    )
    return template


@pytest.fixture
def tagged_chicken(chicken, canonical_boneless):
    chicken.canonical = canonical_boneless
    chicken.save(update_fields=["canonical"])
    return chicken


@pytest.fixture
def blank_dish(business, chicken):
    return Dish.objects.create(
        business=business, code="ND", name="New dish", price=Decimal("280"), ing=chicken
    )


def test_adopt_maps_by_canonical_tag(api, manager, business, template, tagged_chicken, blank_dish):
    """The whole point of canonical tags: one global template reaches every tenant's naming."""
    response = api(manager).post(
        f"/api/tenants/{business.id}/dishes/{blank_dish.id}/recipe/adopt",
        {"template": template.code},
    )
    assert response.status_code == 200
    assert len(response.data["created"]) == 1

    line = RecipeLine.objects.get(dish=blank_dish)
    assert line.ingredient == tagged_chicken
    assert line.qty_per_portion == Decimal("150.000")
    assert line.source_template == template
    assert line.confidence == Confidence.OWNER_STATED


def test_adopt_copies_so_later_template_edits_do_not_leak(
    api, manager, business, template, tagged_chicken, blank_dish
):
    """A tenant that calibrated its recipe must not have it reset when the library is tidied."""
    api(manager).post(
        f"/api/tenants/{business.id}/dishes/{blank_dish.id}/recipe/adopt",
        {"template": template.code},
    )
    template.lines.update(qty_per_portion=Decimal("999"))

    line = RecipeLine.objects.get(dish=blank_dish)
    assert line.qty_per_portion == Decimal("150.000")


def test_preview_reports_an_unmatched_canonical(api, manager, business, template, blank_dish):
    """No ingredient carries the tag, so the preview says so rather than silently skipping."""
    response = api(manager).get(
        f"/api/tenants/{business.id}/dishes/{blank_dish.id}/recipe/adopt?template={template.code}"
    )
    assert response.status_code == 200
    assert response.data["ready"] is False
    assert len(response.data["unmatched"]) == 1
    assert "CHICKEN_BONELESS" in response.data["unmatched"][0]["message"]


def test_preview_reports_ambiguity_instead_of_guessing(
    api, manager, business, template, tagged_chicken, canonical_boneless, blank_dish, vendor
):
    Ingredient.objects.create(
        business=business,
        code="CHK2",
        name="Chicken boneless (premium)",
        unit="kg",
        rate=Decimal("420"),
        vendor=vendor,
        canonical=canonical_boneless,
        recipe_units_per_stock_unit=Decimal("1000"),
    )
    response = api(manager).get(
        f"/api/tenants/{business.id}/dishes/{blank_dish.id}/recipe/adopt?template={template.code}"
    )
    assert response.data["ready"] is False
    assert len(response.data["ambiguous"]) == 1
    assert len(response.data["ambiguous"][0]["options"]) == 2


def test_size_multiplier_scales_the_quantity(
    api, manager, business, template, tagged_chicken, blank_dish
):
    response = api(manager).post(
        f"/api/tenants/{business.id}/dishes/{blank_dish.id}/recipe/adopt",
        {"template": template.code, "size": "half"},
    )
    assert response.status_code == 200
    assert RecipeLine.objects.get(dish=blank_dish).qty_per_portion == Decimal("90.000")


def test_piece_based_lines_use_the_tenants_own_piece_weight(
    api, manager, business, canonical_boneless, tagged_chicken, blank_dish
):
    """Supplier cuts differ, so a tenant override beats the canonical's average."""
    piece_template = RecipeTemplate.objects.create(
        code="TPL-WINGS", name="Wings", pieces_per_portion=6
    )
    RecipeTemplateLine.objects.create(
        template=piece_template,
        canonical=canonical_boneless,
        qty_per_portion=Decimal("6"),
        unit="pc",
        basis=TemplateBasis.PIECE,
    )
    tagged_chicken.piece_weight_g = Decimal("30")
    tagged_chicken.save(update_fields=["piece_weight_g"])

    api(manager).post(
        f"/api/tenants/{business.id}/dishes/{blank_dish.id}/recipe/adopt",
        {"template": "TPL-WINGS"},
    )
    assert RecipeLine.objects.get(dish=blank_dish).qty_per_portion == Decimal("180.000")  # 6 x 30


def test_adopting_twice_leaves_the_existing_line_alone(
    api, manager, business, template, tagged_chicken, blank_dish
):
    api(manager).post(
        f"/api/tenants/{business.id}/dishes/{blank_dish.id}/recipe/adopt",
        {"template": template.code},
    )
    RecipeLine.objects.filter(dish=blank_dish).update(qty_per_portion=Decimal("165"))

    response = api(manager).post(
        f"/api/tenants/{business.id}/dishes/{blank_dish.id}/recipe/adopt",
        {"template": template.code},
    )
    assert response.data["skipped"][0]["reason"] == "already_present"
    assert RecipeLine.objects.get(dish=blank_dish).qty_per_portion == Decimal("165.000")


def test_replacing_a_recipe_is_an_owner_action(
    api, manager, business, template, tagged_chicken, blank_dish
):
    response = api(manager).post(
        f"/api/tenants/{business.id}/dishes/{blank_dish.id}/recipe/adopt",
        {"template": template.code, "replace": True},
    )
    assert response.status_code == 400
    assert response.data["error"]["code"] == "forbidden"


def test_only_a_super_admin_edits_the_global_library(api, owner, superadmin, template):
    assert api(owner).get("/api/recipe-templates/").status_code == 200
    assert (
        api(owner).patch(f"/api/recipe-templates/{template.id}/", {"name": "x"}).status_code == 403
    )
    assert (
        api(superadmin).patch(f"/api/recipe-templates/{template.id}/", {"name": "x"}).status_code
        == 200
    )


# ---------------------------------------------------------------------------------------------
# Sales import
# ---------------------------------------------------------------------------------------------


def _csv(rows, header="Date,Item Name,Quantity,Amount"):
    body = header + "\n" + "\n".join(rows)
    return io.BytesIO(body.encode("utf-8"))


def _upload(client, business, path, rows, header="Date,Item Name,Quantity,Amount", **extra):
    handle = _csv(rows, header)
    handle.name = "petpooja.csv"
    return client.post(
        f"/api/tenants/{business.id}/sales/import/{path}",
        {"file": handle, **extra},
        format="multipart",
    )


def test_preview_matches_by_name_and_writes_nothing(api, manager, business, worked_example):
    response = _upload(
        api(manager),
        business,
        "preview",
        ["2026-03-10,Chilli chicken,7,1820", "2026-03-10,Chicken soup,3,420"],
    )
    assert response.status_code == 200
    assert len(response.data["matched"]) == 2
    assert response.data["unmatched"] == []
    assert not Sale.objects.filter(date="2026-03-10").exists()


def test_pos_alias_takes_priority_over_the_dish_name(api, manager, business, worked_example):
    dish = worked_example["dishes"]["D1"]
    dish.pos_alias = "CHILI CHKN [DRY]"
    dish.save(update_fields=["pos_alias"])

    response = _upload(api(manager), business, "preview", ["2026-03-10,CHILI CHKN [DRY],4,1040"])
    assert len(response.data["matched"]) == 1
    assert response.data["matched"][0]["dish"] == dish.id


def test_unmatched_items_get_a_suggestion_not_an_automatic_match(
    api, manager, business, worked_example
):
    """Fuzzy matching only ever suggests. Auto-matching would misattribute plates silently."""
    response = _upload(api(manager), business, "preview", ["2026-03-10,Chilli Chicken Dry,4,1040"])
    assert response.data["matched"] == []
    assert len(response.data["unmatched"]) == 1
    assert response.data["unmatched"][0]["suggestion"]["dish_name"] == "Chilli chicken"


def test_confirm_writes_sales_marked_as_imported(api, manager, business, worked_example):
    response = _upload(api(manager), business, "confirm", ["2026-03-10,Chilli chicken,7,1820"])
    assert response.status_code == 200

    sale = Sale.objects.get(date="2026-03-10")
    assert sale.plates == 7
    assert sale.revenue == Decimal("1820.00")
    assert sale.source == SaleSource.IMPORT
    assert sale.import_batch is not None


def test_reimport_replaces_only_imported_rows(api, manager, business, worked_example):
    _upload(api(manager), business, "confirm", ["2026-03-10,Chilli chicken,7,1820"])
    _upload(api(manager), business, "confirm", ["2026-03-10,Chilli chicken,9,2340"])

    sales = Sale.objects.filter(date="2026-03-10")
    assert sales.count() == 1
    assert sales.first().plates == 9


def test_a_manual_row_is_never_overwritten_by_an_import(api, manager, business, worked_example):
    """§5c: manual rows untouched. The import reports the clash rather than winning it."""
    response = _upload(api(manager), business, "confirm", [f"{DAY},Chilli chicken,99,99999"])
    assert response.status_code == 400  # nothing left to import once the manual row is excluded

    existing = Sale.objects.get(date=DAY, dish__code="D1")
    assert existing.plates == 20
    assert existing.source == SaleSource.MANUAL


def test_an_alias_can_be_saved_during_confirm(api, manager, business, worked_example):
    import json

    dish = worked_example["dishes"]["D2"]
    response = _upload(
        api(manager),
        business,
        "confirm",
        ["2026-03-11,NOODLE CHKN,5,1050"],
        aliases=json.dumps({"NOODLE CHKN": dish.id}),
    )
    assert response.status_code == 200
    dish.refresh_from_db()
    assert dish.pos_alias == "NOODLE CHKN"
    assert Sale.objects.filter(date="2026-03-11", dish=dish).exists()


def test_a_file_without_the_needed_columns_says_which_are_missing(api, manager, business):
    response = _upload(api(manager), business, "preview", ["a,b"], header="Something,Else")
    assert response.status_code == 400
    assert response.data["error"]["code"] == "missing_columns"
    assert "date" in response.data["error"]["detail"]["missing"]


def test_indian_date_format_is_read_correctly(api, manager, business, worked_example):
    response = _upload(api(manager), business, "preview", ["10/03/2026,Chilli chicken,7,1820"])
    assert response.status_code == 200
    assert str(response.data["matched"][0]["date"]) == "2026-03-10"


def test_a_chef_cannot_import_sales(api, chef, business, worked_example):
    response = _upload(api(chef), business, "preview", ["2026-03-10,Chilli chicken,7,1820"])
    assert response.status_code == 403
