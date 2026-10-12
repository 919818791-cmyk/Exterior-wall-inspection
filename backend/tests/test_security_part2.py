"""Behavioral checks for configurable public contacts and service URLs."""

from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.api import dependencies, system_settings
from app.core.config import Settings
from app.models.tables import UserAccount
from sample_data import fixture_url, synthetic_phone


def test_external_addresses_and_demo_phones_have_no_source_defaults(monkeypatch):
    fields = (
        "qwen_api_base_url", "qwen_privacy_policy_url", "minio_public_url",
        "worker_backend_base_url", "backend_cors_origins",
        "auth_demo_customer_phone", "auth_demo_reviewer_phone", "auth_demo_admin_phone",
    )
    for field in fields:
        monkeypatch.delenv(field.upper(), raising=False)
    settings = Settings(_env_file=None)
    assert all(getattr(settings, field) == "" for field in fields[:4])
    assert settings.backend_cors_origins == []
    assert all(getattr(settings, field) is None for field in fields[5:])


def test_phone_and_url_settings_are_loaded_from_environment(monkeypatch):
    phone = synthetic_phone(100)
    endpoint = fixture_url("deployment.invalid", "/v1")
    monkeypatch.setenv("AUTH_DEMO_CUSTOMER_PHONE", f" {phone} ")
    monkeypatch.setenv("AUTH_DEMO_REVIEWER_PHONE", "")
    monkeypatch.setenv("QWEN_API_BASE_URL", f" {endpoint} ")
    settings = Settings(_env_file=None)
    assert settings.auth_demo_customer_phone == phone
    assert settings.auth_demo_reviewer_phone is None
    assert settings.qwen_api_base_url == endpoint


@pytest.mark.parametrize("field", ["auth_demo_customer_phone", "auth_demo_reviewer_phone", "auth_demo_admin_phone"])
def test_invalid_demo_phones_are_rejected(field):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **{field: "invalid-phone"})


@pytest.mark.parametrize("field", ["qwen_api_base_url", "qwen_privacy_policy_url", "minio_public_url", "worker_backend_base_url"])
@pytest.mark.parametrize("value", ["javascript:alert(1)", fixture_url("user:secret@example.invalid", "/v1")])
def test_configured_urls_reject_non_http_schemes_and_embedded_credentials(field, value):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **{field: value})


@pytest.mark.parametrize("enabled", [False, True])
def test_demo_seed_uses_optional_configured_phones_without_overwriting_accounts(monkeypatch, enabled):
    settings = Settings(
        _env_file=None,
        auth_seed_demo_users=enabled,
        auth_demo_customer_phone=synthetic_phone(100),
        auth_demo_reviewer_phone="",
        auth_demo_admin_phone="",
    )
    monkeypatch.setattr(dependencies, "get_settings", lambda: settings)

    class SeedDb:
        accounts = {}

        def get(self, model, identifier):
            assert model is UserAccount
            return self.accounts.get(identifier)

        def add(self, account):
            self.accounts[account.id] = account

    db = SeedDb()
    dependencies.ensure_demo_users(db)
    if not enabled:
        assert db.accounts == {}
        return
    customer = db.accounts[dependencies.DEMO_USERS[0]["id"]]
    assert customer.phone == synthetic_phone(100)
    assert all(db.accounts[account["id"]].phone is None for account in dependencies.DEMO_USERS[1:])
    customer.phone = synthetic_phone(101)
    dependencies.ensure_demo_users(db)
    assert customer.phone == synthetic_phone(101)
    customer.phone = None
    dependencies.ensure_demo_users(db)
    assert customer.phone == synthetic_phone(100)


@pytest.mark.parametrize("policy_url", ["", fixture_url("policy.invalid", "/privacy")])
def test_cloud_disclosure_reads_configured_policy_link(monkeypatch, policy_url):
    from app.services import detection_strategies, vision_models

    monkeypatch.setattr(system_settings, "get_settings", lambda: SimpleNamespace(qwen_privacy_policy_url=policy_url))
    monkeypatch.setattr(detection_strategies, "read_strategies", lambda db: [
        SimpleNamespace(facade_type="general", routing_supported=True, model_kind="cloud_api", model_id="qwen")
    ])
    monkeypatch.setattr(vision_models, "model_config", lambda db, identifier: SimpleNamespace(name="Cloud", api_base_url=""))
    result = system_settings.read_trial_inference_disclosure(None, None)
    assert result.is_cloud is True
    assert result.privacy_policy_url == (policy_url or None)


def test_production_cannot_accept_cloud_key_without_endpoint():
    with pytest.raises(ValidationError, match="QWEN_API_BASE_URL"):
        Settings(
            _env_file=None, app_env="production", debug=False, auth_seed_demo_users=False,
            auth_secret_key="unique-test-secret-with-at-least-32-characters",
            security_store_backend="redis", security_fail_closed=True,
            photo_guard_enabled=False, sms_verification_enabled=False,
            dashscope_api_key="test-cloud-key", qwen_api_base_url="",
            local_qwen_api_base_url="", local_qwen_model="",
        )
