from app.main import app


def test_weather_routes_are_registered() -> None:
    paths = {route.path for route in app.routes}

    assert "/api/weather/now" in paths
    assert "/api/weather/daily" in paths
    assert "/api/weather/hourly" in paths
