#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import get_settings
from app.services.qweather import QWeatherAPIError, QWeatherClient, QWeatherConfigError


def main() -> int:
    parser = argparse.ArgumentParser(description="QWeather realtime weather connectivity test.")
    parser.add_argument("--location", help="QWeather LocationID or lon,lat, for example 116.41,39.92")
    parser.add_argument("--lang", help="QWeather language code, default comes from QWEATHER_LANGUAGE")
    parser.add_argument("--raw", action="store_true", help="Print the full parsed response as JSON")
    args = parser.parse_args()

    settings = get_settings()
    location = args.location or settings.qweather_test_location

    try:
        weather = QWeatherClient(settings=settings).get_weather_now(location=location, lang=args.lang)
    except (QWeatherConfigError, QWeatherAPIError) as exc:
        print(f"QWeather connectivity test failed: {exc}", file=sys.stderr)
        return 1

    print(json.dumps(weather.to_connectivity_summary(location), ensure_ascii=False, indent=2))
    if args.raw:
        print(json.dumps(weather.model_dump(mode="json"), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
