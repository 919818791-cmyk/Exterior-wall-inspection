from types import SimpleNamespace

from app.core.config import Settings
from app.services.sms_verification import SmsVerificationService


def _settings() -> Settings:
    return Settings(
        sms_verification_enabled=True,
        aliyun_dypns_access_key_id="test-access-key",
        aliyun_dypns_access_key_secret="test-access-secret",
        sms_verification_sign_name="测试签名",
        sms_verification_template_code="100001",
        sms_verification_valid_seconds=300,
        sms_verification_code_length=4,
        sms_verification_send_interval_seconds=60,
    )


def test_send_code_uses_provider_generated_numeric_code() -> None:
    class FakeClient:
        request = None

        def send_sms_verify_code(self, request: object) -> object:
            self.request = request
            return SimpleNamespace(
                body=SimpleNamespace(
                    success=True,
                    code="OK",
                    request_id="outer-request",
                    model=SimpleNamespace(biz_id="biz-id", request_id="request-id"),
                )
            )

    client = FakeClient()
    result = SmsVerificationService(_settings(), client=client).send_code("13800000000")

    request = client.request
    assert request.phone_number == "13800000000"
    assert request.sign_name == "测试签名"
    assert request.template_code == "100001"
    assert request.template_param == '{"code":"##code##","min":"5"}'
    assert request.code_type == 1
    assert request.code_length == 4
    assert request.valid_time == 300
    assert request.duplicate_policy == 1
    assert request.interval == 60
    assert request.return_verify_code is False
    assert result.biz_id == "biz-id"
    assert result.request_id == "request-id"


def test_verify_code_requires_pass_result() -> None:
    class FakeClient:
        verify_result = "PASS"
        request = None

        def check_sms_verify_code(self, request: object) -> object:
            self.request = request
            return SimpleNamespace(
                body=SimpleNamespace(
                    success=True,
                    code="OK",
                    model=SimpleNamespace(verify_result=self.verify_result),
                )
            )

    client = FakeClient()
    service = SmsVerificationService(_settings(), client=client)

    assert service.verify_code("13800000000", "1234") is True
    assert client.request.phone_number == "13800000000"
    assert client.request.verify_code == "1234"
    assert client.request.case_auth_policy == 2

    client.verify_result = "UNKNOWN"
    assert service.verify_code("13800000000", "9999") is False


def test_verify_code_maps_provider_invalid_code_response_to_false() -> None:
    class FakeClient:
        def check_sms_verify_code(self, request: object) -> object:
            return SimpleNamespace(
                body=SimpleNamespace(
                    success=False,
                    code="SmsCodeVerifyFail",
                    model=None,
                )
            )

    service = SmsVerificationService(_settings(), client=FakeClient())

    assert service.verify_code("13800000000", "9999") is False
