from types import SimpleNamespace

import pytest

from app.api.detection_tasks import _formal_inference_prompts
from app.services.formal_detection_prompts import (
    FACADE_DEFECT_TYPES,
    formal_detection_prompts,
)


def test_every_facade_has_the_expected_distinct_defect_types() -> None:
    assert FACADE_DEFECT_TYPES == {
        "tile": frozenset({"crack", "spalling", "hollow"}),
        "coating": frozenset({"crack", "peeling", "hollow"}),
        "plaster": frozenset({"crack", "spalling", "hollow"}),
        "panel": frozenset({"damage", "spalling"}),
        "curtain_wall": frozenset({"damage"}),
    }


@pytest.mark.parametrize(
    ("facade_type", "models", "prompt_kind", "expected_file", "expected_text"),
    [
        ("tile", ["crack"], "visible", "饰面砖裂缝.txt", "type 只能是 crack"),
        ("tile", ["spalling"], "visible", "饰面砖脱落.txt", "type 只能是 spalling"),
        ("tile", ["crack", "spalling"], "visible", "饰面砖裂缝+脱落.txt", "crack 或 spalling"),
        ("tile", ["hollow"], "thermal", "饰面砖空鼓.txt", "type 只能是 hollow"),
        ("coating", ["crack"], "visible", "涂饰裂缝.txt", "type 只能是 crack"),
        ("coating", ["peeling"], "visible", "涂饰起皮.txt", "type 只能是 peeling"),
        ("coating", ["crack", "peeling"], "visible", "涂饰裂缝+起皮.txt", "crack 或 peeling"),
        ("coating", ["hollow"], "thermal", "涂饰空鼓.txt", "type 只能是 hollow"),
        ("plaster", ["crack"], "visible", "抹灰裂缝.txt", "抹灰层裂缝"),
        ("plaster", ["spalling"], "visible", "抹灰脱落.txt", "抹灰层脱落"),
        ("plaster", ["crack", "spalling"], "visible", "抹灰裂缝+脱落.txt", "crack 或 spalling"),
        ("plaster", ["hollow"], "thermal", "抹灰空鼓.txt", "抹灰层空鼓"),
        ("panel", ["damage"], "visible", "饰面板—面板破损.txt", "饰面板板材本体"),
        ("panel", ["spalling"], "visible", "饰面板—脱落.txt", "暴露出后方基层"),
        ("curtain_wall", ["damage"], "visible", "幕墙—面板破损.txt", "幕墙面板或玻璃本体"),
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

    defect_type = models[0]
    prompt = (
        selection.visible_prompts[defect_type]
        if defect_type in selection.visible_prompts
        else getattr(selection, f"{prompt_kind}_prompt")
    )
    source_file = (
        selection.visible_files[defect_type]
        if defect_type in selection.visible_files
        else getattr(selection, f"{prompt_kind}_file")
    )
    assert expected_text in prompt
    assert source_file == f"docs/提示词/{expected_file}"


def test_coating_facade_rejects_spalling_prompt_selection() -> None:
    with pytest.raises(ValueError, match="涂饰外墙不支持"):
        formal_detection_prompts("coating", ["spalling"])


def test_panel_facade_keeps_each_document_prompt_separate() -> None:
    selection = formal_detection_prompts("panel", ["damage", "spalling"])

    assert selection.visible_prompt is None
    assert selection.visible_prompts["damage"] == (
        formal_detection_prompts("panel", ["damage"]).visible_prompts["damage"]
    )
    assert selection.visible_prompts["spalling"] == (
        formal_detection_prompts("panel", ["spalling"]).visible_prompts["spalling"]
    )


def test_formal_inference_prefers_snapshot_prompts() -> None:
    generic_prompts = SimpleNamespace(
        visible_prompt_for_models=lambda _: "通用可见光提示词",
        thermal_prompt="通用热成像提示词",
    )

    visible_prompt, thermal_prompt = _formal_inference_prompts(
        generic_prompts,
        ["裂缝", "脱落"],
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
            if key == "formal_plaster_visible_prompt":
                return SimpleNamespace(value="设置页保存的抹灰裂缝脱落提示词")
            return None

    selection = formal_detection_prompts(
        "plaster",
        ["crack", "spalling"],
        db=PromptDb(),
    )

    assert selection.visible_prompt == "设置页保存的抹灰裂缝脱落提示词"
