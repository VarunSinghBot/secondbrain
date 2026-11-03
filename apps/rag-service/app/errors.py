class ConfigError(Exception):
    """A required setting (API key, URL) is empty. Raised at call time, not startup."""


class ClipUnavailableError(Exception):
    """The in-process CLIP model could not be loaded. Routes map this to 503."""


def require(value: str, name: str) -> str:
    if not value:
        raise ConfigError(f"{name} is not configured")
    return value
