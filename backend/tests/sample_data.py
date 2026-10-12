"""Synthetic, parameterized test inputs; never production contacts or endpoints.

SMS tests use fake clients only. Loopback URLs are used by local lifecycle tests;
other service URLs below are consumed by mocks rather than external services.
"""

from urllib.parse import urlunsplit


def synthetic_phone(index: int = 0) -> str:
    """Return a stable, unique, format-valid phone for mocked SMS/auth tests."""
    if not 0 <= index < 100_000_000:
        raise ValueError("Synthetic phone index must fit in eight digits")
    return f"199{index:08d}"


def fixture_url(host: str, path: str = "", *, scheme: str = "https", query: str = "") -> str:
    """Build an explicit test endpoint from its scheme, host and request path.

    Deliberately permits invalid hosts/userinfo for URL-validation test cases.
    """
    return urlunsplit((scheme, host, path, query, ""))
