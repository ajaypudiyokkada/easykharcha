class AiProviderCallError(Exception):
    """The call to the AI provider itself failed — network, auth, rate limit, timeout. Not retried
    with the fallback model (see provider/base.py): a failure at this level almost always means the
    fallback would fail the same way, so there's nothing to gain by spending a second call."""


class AiSchemaError(Exception):
    """Both the primary and fallback model calls produced a result that failed schema validation."""
