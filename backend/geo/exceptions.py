from rest_framework.exceptions import APIException


class PincodeNotFound(APIException):
    status_code = 404
    default_detail = "We couldn't find that pincode."
    default_code = "PINCODE_NOT_FOUND"
