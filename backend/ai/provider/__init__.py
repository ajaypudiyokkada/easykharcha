"""The one swappable seam: extract_menu/suggest_recipes dispatch to the fake provider (AI_FAKE=true
— tests, dev, CI) or the real Anthropic-backed one. Both return the same AiCallResult shape
(provider/base.py), so nothing outside this package needs to know which one ran."""

from django.conf import settings

from .base import AiCallResult


def _provider():
    if settings.AI_FAKE:
        from . import fake

        return fake
    from . import anthropic_provider

    return anthropic_provider


def extract_menu(files: list[dict], business_type: str) -> AiCallResult:
    return _provider().extract_menu(files, business_type)


def extract_menu_groups(files: list[dict], business_type: str) -> AiCallResult:
    return _provider().extract_menu_groups(files, business_type)


def suggest_recipes(
    dish_names: list[str], business_type: str, stock_items: list[tuple[str, str]]
) -> AiCallResult:
    return _provider().suggest_recipes(dish_names, business_type, stock_items)


def classify_dishes(dish_names: list[str], sector: str, dish_types: list[str]) -> AiCallResult:
    return _provider().classify_dishes(dish_names, sector, dish_types)


def pick_best_sellers(shortlist: list[dict], business_type: str) -> AiCallResult:
    return _provider().pick_best_sellers(shortlist, business_type)


def compose_family_recipe(
    family_name: str,
    member_dish_names: list[str],
    business_type: str,
    stock_items: list[tuple[str, str]],
    excluded_ingredient_names: list[str],
) -> AiCallResult:
    return _provider().compose_family_recipe(
        family_name, member_dish_names, business_type, stock_items, excluded_ingredient_names
    )
