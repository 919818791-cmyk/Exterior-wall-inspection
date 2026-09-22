from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

from Tea.exceptions import TeaException
from alibabacloud_dypnsapi20170525 import models as dypns_models
from alibabacloud_dypnsapi20170525.client import Client as DypnsClient
from alibabacloud_tea_openapi import models as open_api_models

from app.core.config import Settings, get_settings


logger = logging.getLogger(__name__)


class SmsVerificationError(RuntimeError):
    """Base error for SMS verification failures safe to map at the API edge."""


class SmsVerificationConfigurationError(SmsVerificationError):
    pass


class SmsVerificationProviderError(SmsVerificationError):
    def __init__(self, message: str, *, code: str | None = None) -> None:
        super().__init__(message)
        self.code = code


def _is_invalid_verification_code(provider_code: str | None) -> bool:
    """Treat provider-level invalid-code responses as a normal failed check."""
    if not provider_code:
        return False
    normalized = provider_code.upper().replace("-", "_").replace(".", "_")
    if any(
        marker in normalized
        for marker in (
            "SMS_CODE_VERIFY_FAIL",
            "SMS_CODE_INVALID",
            "SMS_CODE_ILLEGAL",
            "VERIFY_CODE_ERROR",
            "VERIFY_CODE_INVALID",
            "VERIFICATION_CODE_ERROR",
            "VERIFICATION_CODE_INVALID",
            "VERIFY_CODE_EXPIRED",
        )
    ):
        return True
    return (
        "CODE" in normalized
        and ("VERIFY" in normalized or "VERIFICATION" in normalized)
        and any(marker in normalized for marker in ("FAIL", "ERROR", "INVALID", "ILLEGAL", "EXPIRED", "MISMATCH"))
    )


@dataclass(frozen=True, slots=True)
class SmsSendResult:
    biz_id: str | None
    request_id: str | None


class SmsVerificationService:
    """Server-only Alibaba Cloud Dypnsapi SMS verification integration."""

    def __init__(self, settings: Settings | None = None, *, client: Any | None = None) -> None:
        self.settings = settings or get_settings()
        self._client = client

    def send_code(self, phone: str) -> SmsSendResult:
        minutes = max(1, (self.settings.sms_verification_valid_seconds + 59) // 60)
        request_kwargs: dict[str, Any] = {
            "country_code": "86",
            "phone_number": phone,
            "sign_name": self.settings.sms_verification_sign_name.strip(),
            "template_code": self.settings.sms_verification_template_code.strip(),
            "template_param": json.dumps(
                {"code": "##code##", "min": str(minutes)},
                ensure_ascii=False,
                separators=(",", ":"),
            ),
            "code_length": self.settings.sms_verification_code_length,
            "valid_time": self.settings.sms_verification_valid_seconds,
            "duplicate_policy": 1,
            "interval": self.settings.sms_verification_send_interval_seconds,
            "code_type": 1,
            "return_verify_code": False,
            "auto_retry": 1,
        }
        scheme_name = self.settings.sms_verification_scheme_name.strip()
        if scheme_name:
            request_kwargs["scheme_name"] = scheme_name

        try:
            response = self._get_client().send_sms_verify_code(
                dypns_models.SendSmsVerifyCodeRequest(**request_kwargs)
            )
        except TeaException as exc:
            code = str(getattr(exc, "code", "") or "") or None
            logger.warning("Alibaba Cloud SMS send request failed with code %s", code or "unknown")
            raise SmsVerificationProviderError("短信验证码发送失败。", code=code) from exc
        except Exception as exc:
            logger.exception("Alibaba Cloud SMS send request failed unexpectedly")
            raise SmsVerificationProviderError("短信验证码服务暂时不可用。") from exc

        body = getattr(response, "body", None)
        if body is None or body.success is not True or body.code != "OK":
            code = str(getattr(body, "code", "") or "") or None
            logger.warning("Alibaba Cloud SMS send response was unsuccessful with code %s", code or "unknown")
            raise SmsVerificationProviderError("短信验证码发送失败。", code=code)

        model = getattr(body, "model", None)
        return SmsSendResult(
            biz_id=getattr(model, "biz_id", None),
            request_id=getattr(model, "request_id", None) or getattr(body, "request_id", None),
        )

    def verify_code(self, phone: str, code: str) -> bool:
        request_kwargs: dict[str, Any] = {
            "country_code": "86",
            "phone_number": phone,
            "verify_code": code,
            "case_auth_policy": 2,
        }
        scheme_name = self.settings.sms_verification_scheme_name.strip()
        if scheme_name:
            request_kwargs["scheme_name"] = scheme_name

        try:
            response = self._get_client().check_sms_verify_code(
                dypns_models.CheckSmsVerifyCodeRequest(**request_kwargs)
            )
        except TeaException as exc:
            provider_code = str(getattr(exc, "code", "") or "") or None
            logger.warning(
                "Alibaba Cloud SMS verification request failed with code %s",
                provider_code or "unknown",
            )
            if _is_invalid_verification_code(provider_code):
                return False
            raise SmsVerificationProviderError("短信验证码核验失败。", code=provider_code) from exc
        except Exception as exc:
            logger.exception("Alibaba Cloud SMS verification request failed unexpectedly")
            raise SmsVerificationProviderError("短信验证码服务暂时不可用。") from exc

        body = getattr(response, "body", None)
        if body is None or body.success is not True or body.code != "OK":
            provider_code = str(getattr(body, "code", "") or "") or None
            logger.warning(
                "Alibaba Cloud SMS verification response was unsuccessful with code %s",
                provider_code or "unknown",
            )
            if _is_invalid_verification_code(provider_code):
                return False
            raise SmsVerificationProviderError("短信验证码核验失败。", code=provider_code)

        model = getattr(body, "model", None)
        return str(getattr(model, "verify_result", "") or "").upper() == "PASS"

    def _get_client(self) -> DypnsClient:
        if self._client is not None:
            return self._client
        self._validate_configuration()
        settings = self.settings
        config = open_api_models.Config(
            access_key_id=settings.aliyun_dypns_access_key_id.strip(),
            access_key_secret=settings.aliyun_dypns_access_key_secret.strip(),
            endpoint=settings.aliyun_dypns_endpoint.strip(),
            region_id=settings.aliyun_dypns_region_id.strip(),
            connect_timeout=settings.sms_verification_request_timeout_seconds * 1000,
            read_timeout=settings.sms_verification_request_timeout_seconds * 1000,
        )
        self._client = DypnsClient(config)
        return self._client

    def _validate_configuration(self) -> None:
        settings = self.settings
        if not settings.sms_verification_enabled:
            raise SmsVerificationConfigurationError("短信验证码服务尚未启用。")
        required_values = (
            settings.aliyun_dypns_access_key_id,
            settings.aliyun_dypns_access_key_secret,
            settings.aliyun_dypns_endpoint,
            settings.aliyun_dypns_region_id,
            settings.sms_verification_sign_name,
            settings.sms_verification_template_code,
        )
        if any(not value.strip() for value in required_values):
            raise SmsVerificationConfigurationError("短信验证码服务配置不完整。")


@lru_cache
def get_sms_verification_service() -> SmsVerificationService:
    return SmsVerificationService()
