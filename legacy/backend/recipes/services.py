"""Adopting a global template into a tenant's recipe (§5d).

The one rule worth stating: adopting **copies** the numbers. A later edit to the global template never
reaches back into a tenant's saved recipe. A restaurant that has calibrated chilli chicken to 165 g must
not have it silently reset because someone tidied the library.
"""

from django.db import transaction

from audit.services import log
from core.exceptions import BusinessRuleError
from core.fields import d
from inventory.models import Ingredient, RecipeLine
from recipes.models import RecipeTemplate, TemplateBasis


def _candidates(business, canonical) -> list[Ingredient]:
    return list(
        Ingredient.objects.filter(business=business, canonical=canonical, shared=False).order_by(
            "name"
        )
    )


def _line_quantity(template: RecipeTemplate, line, ingredient: Ingredient | None, size: str | None):
    """Quantity for one template line, in the tenant ingredient's recipe unit.

    Piece-based lines convert through a piece weight: the tenant's own override if it has measured its
    cuts, else the canonical's average. Supplier cuts differ enough that this matters.
    """
    multiplier = line.multiplier_for(size)

    if line.basis == TemplateBasis.PIECE:
        pieces = d(line.qty_per_portion) * multiplier
        piece_weight = None
        if ingredient is not None:
            piece_weight = ingredient.effective_piece_weight_g
        if piece_weight is None and line.canonical.avg_piece_weight_g is not None:
            piece_weight = line.canonical.avg_piece_weight_g
        if piece_weight is None:
            return None, "no_piece_weight"
        return d(pieces) * d(piece_weight), None

    return d(line.qty_per_portion) * multiplier, None


def preview_adopt(business, template: RecipeTemplate, size: str | None = None) -> dict:
    """What adopting would produce, for the client to review and edit before saving."""
    matched, ambiguous, unmatched = [], [], []

    for line in template.lines.select_related("canonical").all():
        candidates = _candidates(business, line.canonical)
        ingredient = candidates[0] if len(candidates) == 1 else None
        qty, problem = _line_quantity(template, line, ingredient, size)

        entry = {
            "canonical": line.canonical.code,
            "canonical_name": line.canonical.name,
            "basis": line.basis,
            "unit": line.unit,
            "template_qty": d(line.qty_per_portion),
            "confidence": line.confidence,
            "qty_per_portion": qty,
            "problem": problem,
        }

        if not candidates:
            unmatched.append(
                {
                    **entry,
                    "message": f"No ingredient here is tagged {line.canonical.code}. "
                    "Create one, or tag an existing ingredient with it.",
                }
            )
        elif len(candidates) > 1:
            ambiguous.append(
                {
                    **entry,
                    "options": [{"id": i.id, "name": i.name, "unit": i.unit} for i in candidates],
                }
            )
        else:
            matched.append(
                {
                    **entry,
                    "ingredient": ingredient.id,
                    "ingredient_name": ingredient.name,
                    "recipe_unit": ingredient.recipe_unit,
                }
            )

    return {
        "template": {
            "code": template.code,
            "name": template.name,
            "portion_label": template.portion_label,
            "pieces_per_portion": template.pieces_per_portion,
        },
        "size": size,
        "matched": matched,
        "ambiguous": ambiguous,
        "unmatched": unmatched,
        "ready": not ambiguous and not unmatched and bool(matched),
    }


@transaction.atomic
def adopt(
    access,
    dish,
    template: RecipeTemplate,
    size: str | None = None,
    choices: dict | None = None,
    replace: bool = False,
) -> dict:
    """Copy template lines onto `dish`.

    `choices` maps canonical code -> ingredient id, resolving the ambiguous rows the preview returned.
    """
    business = access.business
    if dish.business_id != business.id:
        raise BusinessRuleError("That dish belongs to another business.", code="wrong_tenant")

    choices = choices or {}
    created, skipped = [], []

    if replace:
        dish.recipe_lines.all().delete()

    for line in template.lines.select_related("canonical").all():
        chosen_id = choices.get(line.canonical.code)
        if chosen_id:
            ingredient = Ingredient.objects.filter(
                pk=chosen_id, business=business, shared=False
            ).first()
        else:
            candidates = _candidates(business, line.canonical)
            ingredient = candidates[0] if len(candidates) == 1 else None

        if ingredient is None:
            skipped.append({"canonical": line.canonical.code, "reason": "unmatched"})
            continue

        qty, problem = _line_quantity(template, line, ingredient, size)
        if qty is None:
            skipped.append({"canonical": line.canonical.code, "reason": problem})
            continue

        recipe_line, was_created = RecipeLine.objects.get_or_create(
            dish=dish,
            ingredient=ingredient,
            defaults={
                "qty_per_portion": qty,
                "source_template": template,
                "confidence": line.confidence,
            },
        )
        if not was_created:
            # An existing line is left alone. Overwriting a number the kitchen measured with a
            # library default would be the exact failure mode §5d warns about.
            skipped.append({"canonical": line.canonical.code, "reason": "already_present"})
            continue
        created.append(recipe_line)

    log(
        access,
        "recipe.adopt",
        summary=f"Adopted template {template.code} onto {dish.name} "
        f"({len(created)} line(s), {len(skipped)} skipped)",
        detail={
            "dish": dish.code,
            "template": template.code,
            "size": size,
            "created": [line.ingredient.code for line in created],
            "skipped": skipped,
        },
    )
    return {"created": created, "skipped": skipped}


def suggest_templates(business, dish, limit: int = 5) -> list[dict]:
    """Name-similarity suggestions for bulk adoption during onboarding (§5d)."""
    from difflib import SequenceMatcher

    target = dish.name.lower().strip()
    scored = []
    for template in RecipeTemplate.objects.all():
        score = SequenceMatcher(None, target, template.name.lower().strip()).ratio()
        if score > 0.45:
            scored.append((score, template))
    scored.sort(key=lambda pair: pair[0], reverse=True)
    return [
        {
            "code": template.code,
            "name": template.name,
            "cuisine": template.cuisine,
            "score": round(score, 3),
        }
        for score, template in scored[:limit]
    ]
