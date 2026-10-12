from app.core.config import Settings

from sample_data import fixture_url


def test_cors_origins_accept_comma_separated_env_value() -> None:
    settings = Settings(
        _env_file=None,
        backend_cors_origins=", ".join([fixture_url("example.com", scheme="http"), fixture_url("admin.example.com")]),
    )

    assert settings.backend_cors_origins == [
        fixture_url('example.com', scheme='http'),
        fixture_url('admin.example.com'),
    ]

