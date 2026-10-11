from rest_framework.exceptions import APIException


class DuplicateMobile(APIException):
    status_code = 409
    default_detail = "An account with this mobile number already exists."
    default_code = "DUPLICATE_MOBILE"


class InvalidCredentials(APIException):
    status_code = 401
    default_detail = "Mobile number or password is not right."
    default_code = "invalid_credentials"


class RateLimited(APIException):
    status_code = 429
    default_detail = "Too many attempts. Try again later."
    default_code = "rate_limited"
