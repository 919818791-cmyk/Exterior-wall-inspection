from __future__ import annotations

import base64
import hashlib
import json
import time
from datetime import date, datetime
from pathlib import Path
from typing import Any

import httpx
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import load_pem_private_key
from pydantic import BaseModel, ConfigDict, Field

from app.core.config import Settings, get_settings


class QWeatherConfigError(RuntimeError):
    """Raised when required QWeather configuration is missing or invalid."""


class QWeatherAPIError(RuntimeError):
    """Raised when QWeather returns a failed response."""


QWEATHER_DAILY_FORECAST_DAYS = {"3d", "7d", "10d", "15d", "30d"}
QWEATHER_HOURLY_FORECAST_HOURS = {"24h", "72h", "168h"}


class QWeatherRefer(BaseModel):
    sources: list[str] = Field(default_factory=list)
    license: list[str] = Field(default_factory=list)


class QWeatherNowObservation(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    obs_time: datetime = Field(alias="obsTime")
    temp_c: float = Field(alias="temp")
    feels_like_c: float | None = Field(default=None, alias="feelsLike")
    icon: str | None = None
    text: str | None = None
    wind360: int | None = None
    wind_dir: str | None = Field(default=None, alias="windDir")
    wind_scale: str | None = Field(default=None, alias="windScale")
    wind_speed_kmh: float | None = Field(default=None, alias="windSpeed")
    humidity_percent: float | None = Field(default=None, alias="humidity")
    precip_mm: float | None = Field(default=None, alias="precip")
    pressure_hpa: float | None = Field(default=None, alias="pressure")
    visibility_km: float | None = Field(default=None, alias="vis")
    cloud_percent: float | None = Field(default=None, alias="cloud")
    dew_c: float | None = Field(default=None, alias="dew")


class QWeatherNowResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    code: str
    update_time: datetime = Field(alias="updateTime")
    fx_link: str | None = Field(default=None, alias="fxLink")
    now: QWeatherNowObservation
    refer: QWeatherRefer | None = None

    def to_connectivity_summary(self, location: str) -> dict[str, Any]:
        return {
            "code": self.code,
            "location": location,
            "update_time": self.update_time.isoformat(),
            "obs_time": self.now.obs_time.isoformat(),
            "weather_text": self.now.text,
            "temperature_c": self.now.temp_c,
            "feels_like_c": self.now.feels_like_c,
            "wind_dir": self.now.wind_dir,
            "wind360": self.now.wind360,
            "wind_scale": self.now.wind_scale,
            "wind_speed_kmh": self.now.wind_speed_kmh,
            "humidity_percent": self.now.humidity_percent,
            "precip_mm": self.now.precip_mm,
            "pressure_hpa": self.now.pressure_hpa,
            "visibility_km": self.now.visibility_km,
            "cloud_percent": self.now.cloud_percent,
            "dew_c": self.now.dew_c,
            "fx_link": self.fx_link,
        }


class QWeatherDailyForecast(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    fx_date: date = Field(alias="fxDate")
    sunrise: str | None = None
    sunset: str | None = None
    moonrise: str | None = None
    moonset: str | None = None
    moon_phase: str | None = Field(default=None, alias="moonPhase")
    moon_phase_icon: str | None = Field(default=None, alias="moonPhaseIcon")
    temp_max_c: float = Field(alias="tempMax")
    temp_min_c: float = Field(alias="tempMin")
    icon_day: str | None = Field(default=None, alias="iconDay")
    text_day: str | None = Field(default=None, alias="textDay")
    icon_night: str | None = Field(default=None, alias="iconNight")
    text_night: str | None = Field(default=None, alias="textNight")
    wind360_day: int | None = Field(default=None, alias="wind360Day")
    wind_dir_day: str | None = Field(default=None, alias="windDirDay")
    wind_scale_day: str | None = Field(default=None, alias="windScaleDay")
    wind_speed_day_kmh: float | None = Field(default=None, alias="windSpeedDay")
    wind360_night: int | None = Field(default=None, alias="wind360Night")
    wind_dir_night: str | None = Field(default=None, alias="windDirNight")
    wind_scale_night: str | None = Field(default=None, alias="windScaleNight")
    wind_speed_night_kmh: float | None = Field(default=None, alias="windSpeedNight")
    humidity_percent: float | None = Field(default=None, alias="humidity")
    precip_mm: float | None = Field(default=None, alias="precip")
    pressure_hpa: float | None = Field(default=None, alias="pressure")
    visibility_km: float | None = Field(default=None, alias="vis")
    cloud_percent: float | None = Field(default=None, alias="cloud")
    uv_index: float | None = Field(default=None, alias="uvIndex")


class QWeatherDailyForecastResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    code: str
    update_time: datetime = Field(alias="updateTime")
    fx_link: str | None = Field(default=None, alias="fxLink")
    daily: list[QWeatherDailyForecast]
    refer: QWeatherRefer | None = None


class QWeatherHourlyForecast(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    fx_time: datetime = Field(alias="fxTime")
    temp_c: float = Field(alias="temp")
    icon: str | None = None
    text: str | None = None
    wind360: int | None = None
    wind_dir: str | None = Field(default=None, alias="windDir")
    wind_scale: str | None = Field(default=None, alias="windScale")
    wind_speed_kmh: float | None = Field(default=None, alias="windSpeed")
    humidity_percent: float | None = Field(default=None, alias="humidity")
    pop_percent: float | None = Field(default=None, alias="pop")
    precip_mm: float | None = Field(default=None, alias="precip")
    pressure_hpa: float | None = Field(default=None, alias="pressure")
    cloud_percent: float | None = Field(default=None, alias="cloud")
    dew_c: float | None = Field(default=None, alias="dew")
    uv_index: float | None = Field(default=None, alias="uvIndex")


class QWeatherHourlyForecastResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    code: str
    update_time: datetime = Field(alias="updateTime")
    fx_link: str | None = Field(default=None, alias="fxLink")
    hourly: list[QWeatherHourlyForecast]
    refer: QWeatherRefer | None = None


def calculate_qweather_public_key_sha256(public_key_path: str | Path) -> str:
    public_key_text = Path(public_key_path).read_text(encoding="utf-8")
    return hashlib.sha256(public_key_text.strip().encode("utf-8")).hexdigest()


def generate_qweather_jwt(
    *,
    credential_id: str,
    project_id: str,
    private_key_path: str | Path,
    ttl_seconds: int = 900,
    issued_at: int | None = None,
) -> str:
    if ttl_seconds <= 0 or ttl_seconds > 86400:
        raise QWeatherConfigError("QWEATHER_JWT_TTL_SECONDS must be between 1 and 86400")

    private_key_data = Path(private_key_path).read_bytes()
    private_key = load_pem_private_key(private_key_data, password=None)
    if not isinstance(private_key, Ed25519PrivateKey):
        raise QWeatherConfigError("QWEATHER_PRIVATE_KEY_PATH must point to an Ed25519 private key")

    iat = issued_at if issued_at is not None else int(time.time()) - 30
    payload = {
        "sub": project_id,
        "iat": iat,
        "exp": iat + ttl_seconds,
    }
    header = {
        "alg": "EdDSA",
        "kid": credential_id,
    }

    header_payload = ".".join(
        [
            _base64url_json(header),
            _base64url_json(payload),
        ]
    )
    signature = private_key.sign(header_payload.encode("utf-8"))
    return f"{header_payload}.{_base64url(signature)}"


class QWeatherClient:
    def __init__(self, settings: Settings | None = None, http_client: httpx.Client | None = None) -> None:
        self.settings = settings or get_settings()
        self._http_client = http_client

    def get_weather_now(self, location: str | None = None, lang: str | None = None) -> QWeatherNowResponse:
        data = self._request_json("/v7/weather/now", location=location, lang=lang)
        return QWeatherNowResponse.model_validate(data)

    def get_weather_daily(
        self,
        *,
        location: str | None = None,
        days: str = "7d",
        lang: str | None = None,
    ) -> QWeatherDailyForecastResponse:
        if days not in QWEATHER_DAILY_FORECAST_DAYS:
            raise ValueError(f"Unsupported QWeather daily forecast days: {days}")

        data = self._request_json(f"/v7/weather/{days}", location=location, lang=lang)
        return QWeatherDailyForecastResponse.model_validate(data)

    def get_weather_hourly(
        self,
        *,
        location: str | None = None,
        hours: str = "24h",
        lang: str | None = None,
    ) -> QWeatherHourlyForecastResponse:
        if hours not in QWEATHER_HOURLY_FORECAST_HOURS:
            raise ValueError(f"Unsupported QWeather hourly forecast hours: {hours}")

        data = self._request_json(f"/v7/weather/{hours}", location=location, lang=lang)
        return QWeatherHourlyForecastResponse.model_validate(data)

    def _request_json(self, path: str, *, location: str | None = None, lang: str | None = None) -> dict[str, Any]:
        self._validate_config()
        location_value = location or self.settings.qweather_test_location
        lang_value = lang or self.settings.qweather_language

        client = self._http_client or httpx.Client(
            timeout=self.settings.qweather_request_timeout_seconds,
            trust_env=False,
        )
        try:
            response = client.get(
                f"{self._api_base_url()}{path}",
                headers=self._auth_headers(),
                params={
                    "location": location_value,
                    "lang": lang_value,
                },
            )
            response.raise_for_status()
            data = response.json()
        except httpx.HTTPError as exc:
            raise QWeatherAPIError(f"QWeather HTTP request failed: {exc}") from exc
        except ValueError as exc:
            raise QWeatherAPIError("QWeather response is not valid JSON") from exc
        finally:
            if self._http_client is None:
                client.close()

        if data.get("code") != "200":
            raise QWeatherAPIError(f"QWeather request failed with code={data.get('code')}: {data}")

        return data

    def _validate_config(self) -> None:
        if not self.settings.qweather_api_host.strip():
            raise QWeatherConfigError("Missing QWeather config: QWEATHER_API_HOST")

        if self.settings.qweather_api_key.strip():
            return

        jwt_required = {
            "QWEATHER_PROJECT_ID": self.settings.qweather_project_id,
            "QWEATHER_CREDENTIAL_ID": self.settings.qweather_credential_id,
            "QWEATHER_PRIVATE_KEY_PATH": self.settings.qweather_private_key_path,
        }
        missing = [name for name, value in jwt_required.items() if not str(value).strip()]
        if missing:
            raise QWeatherConfigError(
                "Missing QWeather auth config: set QWEATHER_API_KEY, or configure "
                + ", ".join(missing)
            )

        private_key_path = Path(self.settings.qweather_private_key_path)
        if not private_key_path.is_file():
            raise QWeatherConfigError(f"QWEATHER_PRIVATE_KEY_PATH does not exist: {private_key_path}")

        if self.settings.qweather_public_key_path and self.settings.qweather_public_key_sha256:
            actual_sha256 = calculate_qweather_public_key_sha256(self.settings.qweather_public_key_path)
            expected_sha256 = self.settings.qweather_public_key_sha256.lower()
            if actual_sha256 != expected_sha256:
                raise QWeatherConfigError(
                    "QWEATHER_PUBLIC_KEY_SHA256 does not match QWEATHER_PUBLIC_KEY_PATH: "
                    f"expected {expected_sha256}, got {actual_sha256}"
                )

    def _auth_headers(self) -> dict[str, str]:
        api_key = self.settings.qweather_api_key.strip()
        if api_key:
            return {
                "X-QW-Api-Key": api_key,
                "Accept-Encoding": "gzip",
            }

        token = generate_qweather_jwt(
            credential_id=self.settings.qweather_credential_id,
            project_id=self.settings.qweather_project_id,
            private_key_path=self.settings.qweather_private_key_path,
            ttl_seconds=self.settings.qweather_jwt_ttl_seconds,
        )
        return {
            "Authorization": f"Bearer {token}",
            "Accept-Encoding": "gzip",
        }

    def _api_base_url(self) -> str:
        host = self.settings.qweather_api_host.strip().rstrip("/")
        if host.startswith("http://") or host.startswith("https://"):
            return host
        return f"https://{host}"


def _base64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _base64url_json(data: dict[str, Any]) -> str:
    encoded = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return _base64url(encoded)
