class AiProviderCallError(Exception):
    """The call to the AI provider itself failed — network, auth, rate limit, timeout. `status_code`/
    `exc_type` (the underlying anthropic exception class name) are set when known, for diagnostic
    logging only (provider/base.py) — never surfaced to the owner."""

    def __init__(self, message: str, *, status_code: int | None = None, exc_type: str = ""):
        super().__init__(message)
        self.status_code = status_code
        self.exc_type = exc_type


class AiSchemaError(Exception):
    """Both the primary and fallback model calls produced a result that failed schema validation."""
