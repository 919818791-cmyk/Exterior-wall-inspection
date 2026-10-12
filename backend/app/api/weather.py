from __future__ import annotations

import time
from math import isfinite
from typing import Callable, Literal, TypeVar

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from app.api.dependencies import AuthenticatedUser, get_current_user
from app.core.config import get_settings
from app.services.qweather import (
    QWeatherAPIError,
    QWeatherClient,
    QWeatherConfigError,
    QWeatherDailyForecastResponse,
    QWeatherHourlyForecastResponse,
    QWeatherNowResponse,
)
from app.services.usage_control import (
    SecurityStoreUnavailable,
    daily_identity,
    enforce_limit,
    get_usage_store,
    seconds_until_next_day,
)


ForecastDays = Literal["3d", "7d", "10d", "15d", "30d"]
ForecastHours = Literal["24h", "72h", "168h"]
T = TypeVar("T")

router = APIRouter(
    prefix="/weather",
    tags=["weather"],
    dependencies=[Depends(get_current_user)],
)


@router.get("/now", response_model=QWeatherNowResponse, response_model_by_alias=False)
def get_weather_now(
    location: str = Query(..., min_length=3, description="QWeather LocationID or longitude,latitude."),
    lang: str | None = Query(default=None, min_length=2, max_length=16),
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> QWeatherNowResponse:
    normalized_location = _normalized_coordinate(location)
    return _cached_qweather(
        current_user,
        cache_key=f"now:{normalized_location}:{lang or ''}",
        response_type=QWeatherNowResponse,
        ttl_seconds=get_settings().weather_cache_ttl_now_seconds,
        callback=lambda client: client.get_weather_now(location=normalized_location, lang=lang),
    )


@router.get("/daily", response_model=QWeatherDailyForecastResponse, response_model_by_alias=False)
def get_weather_daily(
    location: str = Query(..., min_length=3, description="QWeather LocationID or longitude,latitude."),
    days: ForecastDays = Query(default="7d"),
    lang: str | None = Query(default=None, min_length=2, max_length=16),
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> QWeatherDailyForecastResponse:
    normalized_location = _normalized_coordinate(location)
    return _cached_qweather(
        current_user,
        cache_key=f"daily:{normalized_location}:{days}:{lang or ''}",
        response_type=QWeatherDailyForecastResponse,
        ttl_seconds=get_settings().weather_cache_ttl_forecast_seconds,
        callback=lambda client: client.get_weather_daily(
            location=normalized_location,
            days=days,
            lang=lang,
        ),
    )


@router.get("/hourly", response_model=QWeatherHourlyForecastResponse, response_model_by_alias=False)
def get_weather_hourly(
    location: str = Query(..., min_length=3, description="QWeather LocationID or longitude,latitude."),
    hours: ForecastHours = Query(default="24h"),
    lang: str | None = Query(default=None, min_length=2, max_length=16),
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> QWeatherHourlyForecastResponse:
    normalized_location = _normalized_coordinate(location)
    return _cached_qweather(
        current_user,
        cache_key=f"hourly:{normalized_location}:{hours}:{lang or ''}",
        response_type=QWeatherHourlyForecastResponse,
        ttl_seconds=get_settings().weather_cache_ttl_forecast_seconds,
        callback=lambda client: client.get_weather_hourly(
            location=normalized_location,
            hours=hours,
            lang=lang,
        ),
    )


def _normalized_coordinate(value: str) -> str:
    try:
        longitude_text, latitude_text = [part.strip() for part in value.split(",", maxsplit=1)]
        longitude = float(longitude_text)
        latitude = float(latitude_text)
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="检测位置必须是有效的经度,纬度坐标。",
        ) from exc
    if not (
        isfinite(longitude)
        and isfinite(latitude)
        and -180 <= longitude <= 180
        and -90 <= latitude <= 90
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="检测位置坐标超出有效范围。",
        )
    return f"{longitude:.2f},{latitude:.2f}"


def _cached_qweather(
    current_user: AuthenticatedUser,
    *,
    cache_key: str,
    response_type: type[T],
    ttl_seconds: int,
    callback: Callable[[QWeatherClient], T],
) -> T:
    settings = get_settings()
    store = get_usage_store()
    user_identity = str(current_user.id)
    enforce_limit(
        store,
        "weather:request:user",
        user_identity,
        limit=settings.weather_rate_limit_per_user,
        ttl_seconds=settings.weather_rate_window_seconds,
        detail="天气查询过于频繁，请稍后重试。",
    )

    try:
        cached = store.cache_get("qweather", cache_key)
    except SecurityStoreUnavailable as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    if cached is not None:
        return response_type.model_validate(cached)  # type: ignore[return-value,union-attr]

    try:
        lock_token = store.acquire_lock("weather:upstream", cache_key, ttl_seconds=30)
    except SecurityStoreUnavailable as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    if lock_token is None:
        for _ in range(5):
            time.sleep(0.1)
            cached = store.cache_get("qweather", cache_key)
            if cached is not None:
                return response_type.model_validate(cached)  # type: ignore[return-value,union-attr]
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="相同位置的天气数据正在更新，请稍后重试。",
            headers={"Retry-After": "2"},
        )

    try:
        enforce_limit(
            store,
            "weather:upstream:user",
            daily_identity(user_identity),
            limit=settings.weather_daily_upstream_limit_per_user,
            ttl_seconds=seconds_until_next_day(),
            detail="今天的检测时段查询次数已达到上限。",
        )
        result = _call_qweather(callback)
        if not isinstance(result, BaseModel):
            raise TypeError("QWeather callback must return a Pydantic model.")
        store.cache_set(
            "qweather",
            cache_key,
            result.model_dump(mode="json", by_alias=False),
            ttl_seconds=ttl_seconds,
        )
        return result
    except SecurityStoreUnavailable as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    finally:
        store.release_lock("weather:upstream", cache_key, lock_token)


def _call_qweather(callback: Callable[[QWeatherClient], T]) -> T:
    try:
        return callback(QWeatherClient())
    except QWeatherConfigError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except QWeatherAPIError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc
