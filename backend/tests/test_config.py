from app.core.config import Settings


def test_cors_origins_accept_comma_separated_env_value() -> None:
    settings = Settings(
        _env_file=None,
        backend_cors_origins="http://example.com,https://admin.example.com",
    )

    assert settings.backend_cors_origins == [
        "http://example.com",
        "https://admin.example.com",
    ]

