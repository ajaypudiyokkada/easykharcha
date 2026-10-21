from rest_framework.exceptions import APIException


class BusinessLimitReached(APIException):
    status_code = 422
    default_detail = "You can add up to 3 businesses."
    default_code = "BUSINESS_LIMIT_REACHED"


class InvalidLogoFile(APIException):
    status_code = 422
    default_detail = "Use a PNG or JPG under 2 MB."
    default_code = "INVALID_LOGO_FILE"


class TeamLimitReached(APIException):
    status_code = 422
    default_detail = "You can add up to 10 team members."
    default_code = "TEAM_LIMIT_REACHED"


class AlreadyTeamMember(APIException):
    status_code = 409
    default_detail = "This person already has access to this business."
    default_code = "ALREADY_TEAM_MEMBER"


class CannotRemoveSelf(APIException):
    status_code = 422
    default_detail = "You can't remove your own Owner access."
    default_code = "CANNOT_REMOVE_SELF"


class CannotResetSelf(APIException):
    status_code = 422
    default_detail = "You can't reset your own Owner access."
    default_code = "CANNOT_RESET_SELF"


class CannotChangeOwnerRole(APIException):
    status_code = 422
    default_detail = "Owner role can't be changed here."
    default_code = "CANNOT_CHANGE_OWNER_ROLE"


class ItemsDecisionNeeded(APIException):
    """Changing business_type while stock/sell items exist needs an explicit keep-or-remove choice
    from the owner first — same 409-then-resubmit-with-a-flag pattern as counts'
    NeedsConfirmation. Carries just enough for the client's confirmation sheet (names, for the "up
    to 5 + N more" preview, and counts), never decides anything itself."""

    status_code = 409
    default_detail = "Choose what should happen to the existing items first."
    default_code = "items_decision_needed"

    def __init__(self, stock_item_names: list[str], sell_item_names: list[str]):
        super().__init__()
        self.items_summary = {
            "stock_items": stock_item_names,
            "sell_items": sell_item_names,
            "total_count": len(stock_item_names) + len(sell_item_names),
        }
