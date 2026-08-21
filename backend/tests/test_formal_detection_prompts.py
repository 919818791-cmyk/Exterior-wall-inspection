from types import SimpleNamespace

import pytest

from app.api.detection_tasks import _formal_inference_prompts
from app.services.formal_detection_prompts import formal_detection_prompts


@pytest.mark.parametrize(
    ("facade_type", "models", "prompt_kind", "expected_file", "expected_text"),
    [
        ("tile", ["crack"], "visible", "面砖裂缝.txt", "面砖外墙"),
        ("tile", ["spalling"], "visible", "面砖剥落.txt", "面砖剥落"),
        ("tile", ["crack", "spalling"], "visible", "面砖裂缝+剥落.txt", "crack 或 spalling"),
        ("tile", ["hollow"], "thermal", "面砖空鼓.txt", "面砖/瓷砖外墙"),
        ("coating", ["crack"], "visible", "涂料裂缝.txt", "涂料外墙"),
        ("coating", ["spalling"], "visible", "涂料剥落.txt", "涂料饰面剥落"),
        ("coating", ["crack", "spalling"], "visible", "涂料裂缝+剥落.txt", "crack 或 spalling"),
        ("coating", ["hollow"], "thermal", "涂料空鼓.txt", "涂料饰面外墙"),
        ("stone", ["crack"], "visible", "石材裂缝.txt", "石材外墙"),
        ("stone", ["spalling"], "visible", "石材剥落.txt", "石材饰面剥落"),
        ("stone", ["crack", "spalling"], "visible", "石材裂缝+剥落.txt", "crack 或 spalling"),
        ("stone", ["hollow"], "thermal", "石材空鼓.txt", "湿贴或粘贴式石材外墙"),
    ],
)
def test_formal_detection_selects_facade_specific_prompt(
    facade_type: str,
    models: list[str],
    prompt_kind: str,
    expected_file: str,
    expected_text: str,
) -> None:
    selection = formal_detection_prompts(facade_type, models)

    prompt = getattr(selection, f"{prompt_kind}_prompt")
    source_file = getattr(selection, f"{prompt_kind}_file")
    assert expected_text in prompt
    assert source_file == f"docs/提示词/{expected_file}"


def test_formal_inference_prefers_snapshot_prompts() -> None:
    generic_prompts = SimpleNamespace(
        visible_prompt_for_models=lambda _: "通用可见光提示词",
        thermal_prompt="通用热成像提示词",
    )

    visible_prompt, thermal_prompt = _formal_inference_prompts(
        generic_prompts,
        ["裂缝", "剥落"],
        {
            "prompts": {
                "visible": "快照可见光提示词",
                "thermal": "快照热成像提示词",
            }
        },
    )

    assert visible_prompt == "快照可见光提示词"
    assert thermal_prompt == "快照热成像提示词"


def test_formal_detection_prefers_saved_prompt_override() -> None:
    class PromptDb:
        def get(self, _model: object, key: str) -> object | None:
            if key == "formal_stone_visible_prompt":
                return SimpleNamespace(value="设置页保存的石材裂缝剥落提示词")
            return None

    selection = formal_detection_prompts(
        "stone",
        ["crack", "spalling"],
        db=PromptDb(),
    )

    assert selection.visible_prompt == "设置页保存的石材裂缝剥落提示词"
