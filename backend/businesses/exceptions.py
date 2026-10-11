from rest_framework.exceptions import APIException


class BusinessLimitReached(APIException):
    status_code = 422
    default_detail = "You can add up to 3 businesses."
    default_code = "BUSINESS_LIMIT_REACHED"


class InvalidLogoFile(APIException):
    status_code = 422
    default_detail = "Use a PNG or JPG under 2 MB."
    default_code = "INVALID_LOGO_FILE"
