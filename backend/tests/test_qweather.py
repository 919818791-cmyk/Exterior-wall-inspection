import base64
import json

import httpx
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, NoEncryption, PrivateFormat

from app.core.config import Settings
from app.services.qweather import (
    QWeatherClient,
    QWeatherDailyForecastResponse,
    QWeatherHourlyForecastResponse,
    QWeatherNowResponse,
    calculate_qweather_public_key_sha256,
    generate_qweather_jwt,
)


def test_generate_qweather_jwt_uses_expected_header_and_payload(tmp_path) -> None:
    private_key_path = tmp_path / "ed25519-private.pem"
    private_key_path.write_bytes(
        Ed25519PrivateKey.generate().private_bytes(
            encoding=Encoding.PEM,
            format=PrivateFormat.PKCS8,
            encryption_algorithm=NoEncryption(),
        )
    )

    token = generate_qweather_jwt(
        credential_id="K9GYAW4XH9",
        project_id="36E5G4T7X7",
        private_key_path=private_key_path,
        ttl_seconds=900,
        issued_at=1000,
    )

    header, payload, signature = token.split(".")

    assert json.loads(_decode_base64url(header)) == {"alg": "EdDSA", "kid": "K9GYAW4XH9"}
    assert json.loads(_decode_base64url(payload)) == {
        "sub": "36E5G4T7X7",
        "iat": 1000,
        "exp": 1900,
    }
    assert signature


def test_calculate_qweather_public_key_sha256_matches_console_trim_rule(tmp_path) -> None:
    public_key_path = tmp_path / "ed25519-public.pem"
    public_key_path.write_text("  -----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----\n", encoding="utf-8")

    assert calculate_qweather_public_key_sha256(public_key_path) == (
        "aa96bb5174dcd4dfced92e51c8c48094e2ee122cb1e4667295607abb82a93c6b"
    )


def test_qweather_now_response_parses_recommendation_fields() -> None:
    weather = QWeatherNowResponse.model_validate(_weather_now_payload())

    assert weather.code == "200"
    assert weather.now.temp_c == 24
    assert weather.now.feels_like_c == 26
    assert weather.now.wind_speed_kmh == 3
    assert weather.now.humidity_percent == 72
    assert weather.now.precip_mm == 0.0
    assert weather.now.pressure_hpa == 1003
    assert weather.now.visibility_km == 16
    assert weather.now.cloud_percent == 10
    assert weather.now.dew_c == 21


def test_qweather_daily_response_parses_forecast_fields() -> None:
    weather = QWeatherDailyForecastResponse.model_validate(_weather_daily_payload())
    day = weather.daily[0]

    assert weather.code == "200"
    assert day.fx_date.isoformat() == "2026-07-07"
    assert day.temp_max_c == 33
    assert day.temp_min_c == 27
    assert day.humidity_percent == 76
    assert day.precip_mm == 0.0
    assert day.pressure_hpa == 1001
    assert day.cloud_percent == 35
    assert day.wind_speed_day_kmh == 8
    assert day.wind360_night == 135


def test_qweather_hourly_response_parses_forecast_fields() -> None:
    weather = QWeatherHourlyForecastResponse.model_validate(_weather_hourly_payload())
    hour = weather.hourly[0]

    assert weather.code == "200"
    assert hour.fx_time.isoformat() == "2026-07-07T09:00:00+08:00"
    assert hour.temp_c == 29
    assert hour.wind_speed_kmh == 7
    assert hour.humidity_percent == 72
    assert hour.pop_percent == 20
    assert hour.precip_mm == 0.0
    assert hour.pressure_hpa == 1002
    assert hour.cloud_percent == 40
    assert hour.dew_c == 23


def test_qweather_client_requests_now_endpoint_with_bearer_token(tmp_path) -> None:
    private_key_path = tmp_path / "ed25519-private.pem"
    private_key_path.write_bytes(
        Ed25519PrivateKey.generate().private_bytes(
            encoding=Encoding.PEM,
            format=PrivateFormat.PKCS8,
            encryption_algorithm=NoEncryption(),
        )
    )
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["authorization"] = request.headers["authorization"]
        return httpx.Response(200, json=_weather_now_payload())

    settings = Settings(
        _env_file=None,
        qweather_api_host="example.qweatherapi.com",
        qweather_project_id="36E5G4T7X7",
        qweather_credential_id="K9GYAW4XH9",
        qweather_private_key_path=str(private_key_path),
        qweather_test_location="116.41,39.92",
    )
    client = QWeatherClient(settings=settings, http_client=httpx.Client(transport=httpx.MockTransport(handler)))

    weather = client.get_weather_now()

    assert weather.now.text == "多云"
    assert seen["url"] == "https://example.qweatherapi.com/v7/weather/now?location=116.41%2C39.92&lang=zh"
    assert seen["authorization"].startswith("Bearer ")


def test_qweather_client_prefers_api_key_header() -> None:
    seen: dict[str, str | None] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["api_key"] = request.headers.get("x-qw-api-key")
        seen["authorization"] = request.headers.get("authorization")
        return httpx.Response(200, json=_weather_now_payload())

    settings = Settings(
        _env_file=None,
        qweather_api_host="example.qweatherapi.com",
        qweather_api_key="weather-test-key",
        qweather_project_id="project-for-records-only",
    )
    client = QWeatherClient(
        settings=settings,
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    weather = client.get_weather_now(location="116.41,39.92")

    assert weather.now.text == "多云"
    assert seen == {
        "api_key": "weather-test-key",
        "authorization": None,
    }


def test_qweather_client_requests_daily_endpoint_with_bearer_token(tmp_path) -> None:
    private_key_path = tmp_path / "ed25519-private.pem"
    private_key_path.write_bytes(
        Ed25519PrivateKey.generate().private_bytes(
            encoding=Encoding.PEM,
            format=PrivateFormat.PKCS8,
            encryption_algorithm=NoEncryption(),
        )
    )
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["authorization"] = request.headers["authorization"]
        return httpx.Response(200, json=_weather_daily_payload())

    settings = Settings(
        _env_file=None,
        qweather_api_host="example.qweatherapi.com",
        qweather_project_id="36E5G4T7X7",
        qweather_credential_id="K9GYAW4XH9",
        qweather_private_key_path=str(private_key_path),
    )
    client = QWeatherClient(settings=settings, http_client=httpx.Client(transport=httpx.MockTransport(handler)))

    weather = client.get_weather_daily(location="114.10,22.57", days="7d")

    assert weather.daily[0].text_day == "多云"
    assert seen["url"] == "https://example.qweatherapi.com/v7/weather/7d?location=114.10%2C22.57&lang=zh"
    assert seen["authorization"].startswith("Bearer ")


def test_qweather_client_requests_hourly_endpoint_with_bearer_token(tmp_path) -> None:
    private_key_path = tmp_path / "ed25519-private.pem"
    private_key_path.write_bytes(
        Ed25519PrivateKey.generate().private_bytes(
            encoding=Encoding.PEM,
            format=PrivateFormat.PKCS8,
            encryption_algorithm=NoEncryption(),
        )
    )
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["authorization"] = request.headers["authorization"]
        return httpx.Response(200, json=_weather_hourly_payload())

    settings = Settings(
        _env_file=None,
        qweather_api_host="example.qweatherapi.com",
        qweather_project_id="36E5G4T7X7",
        qweather_credential_id="K9GYAW4XH9",
        qweather_private_key_path=str(private_key_path),
    )
    client = QWeatherClient(settings=settings, http_client=httpx.Client(transport=httpx.MockTransport(handler)))

    weather = client.get_weather_hourly(location="114.10,22.57", hours="168h")

    assert weather.hourly[0].text == "多云"
    assert seen["url"] == "https://example.qweatherapi.com/v7/weather/168h?location=114.10%2C22.57&lang=zh"
    assert seen["authorization"].startswith("Bearer ")


def _decode_base64url(value: str) -> str:
    padded = value + "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8")


def _weather_now_payload() -> dict:
    return {
        "code": "200",
        "updateTime": "2020-06-30T22:00+08:00",
        "fxLink": "https://www.qweather.com/weather/beijing-101010100.html",
        "now": {
            "obsTime": "2020-06-30T21:40+08:00",
            "temp": "24",
            "feelsLike": "26",
            "icon": "101",
            "text": "多云",
            "wind360": "123",
            "windDir": "东南风",
            "windScale": "1",
            "windSpeed": "3",
            "humidity": "72",
            "precip": "0.0",
            "pressure": "1003",
            "vis": "16",
            "cloud": "10",
            "dew": "21",
        },
        "refer": {
            "sources": ["https://developer.qweather.com/attribution.html"],
            "license": ["QWeather Developers License"],
        },
    }


def _weather_daily_payload() -> dict:
    return {
        "code": "200",
        "updateTime": "2026-07-06T16:00+08:00",
        "fxLink": "https://www.qweather.com/weather/shenzhen-101280601.html",
        "daily": [
            {
                "fxDate": "2026-07-07",
                "sunrise": "05:45",
                "sunset": "19:12",
                "moonrise": "23:10",
                "moonset": "10:42",
                "moonPhase": "亏凸月",
                "moonPhaseIcon": "805",
                "tempMax": "33",
                "tempMin": "27",
                "iconDay": "101",
                "textDay": "多云",
                "iconNight": "150",
                "textNight": "晴",
                "wind360Day": "120",
                "windDirDay": "东南风",
                "windScaleDay": "1-3",
                "windSpeedDay": "8",
                "wind360Night": "135",
                "windDirNight": "东南风",
                "windScaleNight": "1-3",
                "windSpeedNight": "6",
                "humidity": "76",
                "precip": "0.0",
                "pressure": "1001",
                "vis": "20",
                "cloud": "35",
                "uvIndex": "8",
            }
        ],
        "refer": {
            "sources": ["https://developer.qweather.com/attribution.html"],
            "license": ["QWeather Developers License"],
        },
    }


def _weather_hourly_payload() -> dict:
    return {
        "code": "200",
        "updateTime": "2026-07-06T16:00+08:00",
        "fxLink": "https://www.qweather.com/weather/shenzhen-101280601.html",
        "hourly": [
            {
                "fxTime": "2026-07-07T09:00+08:00",
                "temp": "29",
                "icon": "101",
                "text": "多云",
                "wind360": "126",
                "windDir": "东南风",
                "windScale": "1-3",
                "windSpeed": "7",
                "humidity": "72",
                "pop": "20",
                "precip": "0.0",
                "pressure": "1002",
                "cloud": "40",
                "dew": "23",
                "uvIndex": "2",
            }
        ],
        "refer": {
            "sources": ["https://developer.qweather.com/attribution.html"],
            "license": ["QWeather Developers License"],
        },
    }
