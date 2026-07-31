import os

import pytest


os.environ["APP_ENV"] = "test"
os.environ["SECURITY_STORE_BACKEND"] = "memory"
os.environ["SECURITY_FAIL_CLOSED"] = "false"
os.environ["AUTH_SEED_DEMO_USERS"] = "true"
os.environ["TRIAL_GENERATE_LIMIT_PER_USER"] = "10000"
os.environ["TRIAL_UPLOAD_LIMIT_PER_USER"] = "10000"
os.environ["LOGIN_RATE_LIMIT_PER_IDENTITY"] = "10000"
os.environ["TRIAL_APPLICATION_LIMIT_PER_IDENTITY"] = "10000"
os.environ["WEATHER_RATE_LIMIT_PER_USER"] = "10000"
os.environ["PHOTO_GUARD_ENABLED"] = "false"


@pytest.fixture(autouse=True)
def reset_security_usage_store():
    from app.services.usage_control import reset_usage_store

    reset_usage_store()
    yield
    reset_usage_store()
