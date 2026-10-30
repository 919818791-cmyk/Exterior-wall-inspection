import asyncio
from types import SimpleNamespace

import httpx
import pytest

from app.services import trial_qwen_inference as qwen


@pytest.mark.parametrize("initial_disconnect", [False, True])
def test_connection_can_recover_after_three_failed_attempts(monkeypatch, initial_disconnect):
    attempts = []
    retries = []

    async def post(endpoint, *, json):
        attempts.append(json)
        if initial_disconnect and len(attempts) == 1:
            raise httpx.RemoteProtocolError("Server disconnected without sending a response.")
        if len(attempts) <= 4:
            raise httpx.ConnectError("")
        return SimpleNamespace(is_success=True, json=lambda: {"choices": []})

    async def wait(**kwargs):
        retries.append(kwargs)

    monkeypatch.setattr(qwen, "_wait_before_upstream_retry", wait)
    payload = asyncio.run(qwen._request_tile(
        SimpleNamespace(post=post), endpoint="https://model.invalid/chat/completions",
        model="qwen3-vl-plus", tile_png=b"image",
    ))
    assert payload == {"choices": []}
    assert len(attempts) == 5
    assert all(retry["connection_error"] for retry in retries[1:])
    assert retries[0]["connection_error"] is not initial_disconnect
    assert all(attempt == attempts[0] for attempt in attempts)


@pytest.mark.parametrize(("error", "attempts"), [
    (httpx.ConnectError(""), 6),
    (httpx.ConnectTimeout(""), 6),
    (httpx.RemoteProtocolError("disconnected"), 3),
])
def test_transport_retries_are_bounded_and_empty_errors_keep_their_type(monkeypatch, error, attempts):
    calls = []

    async def post(endpoint, *, json):
        calls.append(json)
        raise error

    async def wait(**kwargs):
        pass

    monkeypatch.setattr(qwen, "_wait_before_upstream_retry", wait)
    with pytest.raises(qwen.TrialQwenInferenceError, match=type(error).__name__):
        asyncio.run(qwen._request_tile(
            SimpleNamespace(post=post), endpoint="https://model.invalid/chat/completions",
            model="qwen3-vl-plus", tile_png=b"image",
        ))
    assert len(calls) == attempts


def test_connection_retry_window_uses_longer_bounded_backoff(monkeypatch):
    delays = []

    async def sleep(delay):
        delays.append(delay)

    monkeypatch.setattr(qwen.asyncio, "sleep", sleep)
    monkeypatch.setattr(qwen.random, "uniform", lambda *_: 0)
    for attempt in range(1, 6):
        asyncio.run(qwen._wait_before_upstream_retry(
            provider_label="Qwen", attempt=attempt, reason="ConnectError", connection_error=True,
        ))
    assert delays == [2, 4, 8, 16, 30]
