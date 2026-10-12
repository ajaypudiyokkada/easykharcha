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
