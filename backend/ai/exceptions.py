from rest_framework.exceptions import APIException


class AiUnavailable(APIException):
    status_code = 503
    default_detail = "Menu reading isn't available right now. You can add dishes one by one."
    default_code = "ai_unavailable"


class AiDailyLimitReached(APIException):
    status_code = 429
    default_detail = "You've reached today's limit for this. Try again tomorrow."
    default_code = "ai_daily_limit_reached"


class InvalidMenuFile(APIException):
    status_code = 422
    default_detail = (
        "Choose 1-6 photos (JPEG, PNG or WEBP, up to 4 MB each) or one PDF (up to 10 MB, 10 pages)."
    )
    default_code = "invalid_menu_file"


class AiProviderUnavailable(APIException):
    status_code = 502
    default_detail = "The AI service could not process this request. Try again in a moment."
    default_code = "ai_provider_error"
