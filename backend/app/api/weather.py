from __future__ import annotations

from typing import Callable, Literal, TypeVar

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.dependencies import get_current_user
from app.services.qweather import (
    QWeatherAPIError,
    QWeatherClient,
    QWeatherConfigError,
    QWeatherDailyForecastResponse,
    QWeatherHourlyForecastResponse,
    QWeatherNowResponse,
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
) -> QWeatherNowResponse:
    return _call_qweather(lambda client: client.get_weather_now(location=location, lang=lang))


@router.get("/daily", response_model=QWeatherDailyForecastResponse, response_model_by_alias=False)
def get_weather_daily(
    location: str = Query(..., min_length=3, description="QWeather LocationID or longitude,latitude."),
    days: ForecastDays = Query(default="7d"),
    lang: str | None = Query(default=None, min_length=2, max_length=16),
) -> QWeatherDailyForecastResponse:
    return _call_qweather(lambda client: client.get_weather_daily(location=location, days=days, lang=lang))


@router.get("/hourly", response_model=QWeatherHourlyForecastResponse, response_model_by_alias=False)
def get_weather_hourly(
    location: str = Query(..., min_length=3, description="QWeather LocationID or longitude,latitude."),
    hours: ForecastHours = Query(default="24h"),
    lang: str | None = Query(default=None, min_length=2, max_length=16),
) -> QWeatherHourlyForecastResponse:
    return _call_qweather(lambda client: client.get_weather_hourly(location=location, hours=hours, lang=lang))


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
