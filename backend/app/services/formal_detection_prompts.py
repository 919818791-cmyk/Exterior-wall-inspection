from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Sequence

from app.models.tables import SystemSetting


FacadeType = Literal["tile", "coating", "stone"]

PROMPT_DIRECTORY = Path(__file__).resolve().parents[3] / "docs" / "提示词"
FACADE_TYPE_NAMES: dict[FacadeType, str] = {
    "tile": "面砖",
    "coating": "涂料",
    "stone": "石材",
}
VISIBLE_PROMPT_VARIANTS = {
    frozenset({"crack"}): "crack_prompt",
    frozenset({"spalling"}): "spalling_prompt",
    frozenset({"crack", "spalling"}): "visible_prompt",
}
FORMAL_PROMPT_FILES = {
    "tile_crack_prompt": "面砖裂缝.txt",
    "tile_spalling_prompt": "面砖剥落.txt",
    "tile_visible_prompt": "面砖裂缝+剥落.txt",
    "tile_thermal_prompt": "面砖空鼓.txt",
    "coating_crack_prompt": "涂料裂缝.txt",
    "coating_spalling_prompt": "涂料剥落.txt",
    "coating_visible_prompt": "涂料裂缝+剥落.txt",
    "coating_thermal_prompt": "涂料空鼓.txt",
    "stone_crack_prompt": "石材裂缝.txt",
    "stone_spalling_prompt": "石材剥落.txt",
    "stone_visible_prompt": "石材裂缝+剥落.txt",
    "stone_thermal_prompt": "石材空鼓.txt",
}
FORMAL_PROMPT_SETTING_KEYS = {
    prompt_key: f"formal_{prompt_key}"
    for prompt_key in FORMAL_PROMPT_FILES
}


@dataclass(frozen=True, slots=True)
class FormalDetectionPromptSelection:
    visible_prompt: str | None
    thermal_prompt: str | None
    visible_file: str | None
    thermal_file: str | None


def _read_prompt(filename: str) -> str:
    prompt_path = PROMPT_DIRECTORY / filename
    try:
        prompt = prompt_path.read_text(encoding="utf-8-sig").strip()
    except OSError as exc:
        raise RuntimeError(f"无法读取专业检测提示词：{prompt_path}") from exc
    if not prompt:
        raise RuntimeError(f"专业检测提示词为空：{prompt_path}")
    return prompt


def _prompt_value(db: object | None, prompt_key: str) -> str:
    setting_key = FORMAL_PROMPT_SETTING_KEYS[prompt_key]
    getter = getattr(db, "get", None)
    setting = getter(SystemSetting, setting_key) if callable(getter) else None
    if setting is not None and isinstance(setting.value, str) and setting.value.strip():
        return setting.value.strip()
    return _read_prompt(FORMAL_PROMPT_FILES[prompt_key])


def formal_prompt_values(db: object | None = None) -> dict[str, str]:
    return {
        prompt_key: _prompt_value(db, prompt_key)
        for prompt_key in FORMAL_PROMPT_FILES
    }


def formal_detection_prompts(
    facade_type: FacadeType,
    model_types: Sequence[str],
    *,
    db: object | None = None,
) -> FormalDetectionPromptSelection:
    facade_name = FACADE_TYPE_NAMES.get(facade_type)
    if facade_name is None:
        raise ValueError(f"Unsupported facade type: {facade_type}")

    selected_models = set(model_types)
    visible_variant = VISIBLE_PROMPT_VARIANTS.get(
        frozenset(selected_models.intersection({"crack", "spalling"}))
    )
    visible_key = (
        f"{facade_type}_{visible_variant}"
        if visible_variant is not None
        else None
    )
    thermal_key = (
        f"{facade_type}_thermal_prompt"
        if "hollow" in selected_models
        else None
    )
    visible_filename = FORMAL_PROMPT_FILES.get(visible_key) if visible_key else None
    thermal_filename = FORMAL_PROMPT_FILES.get(thermal_key) if thermal_key else None
    return FormalDetectionPromptSelection(
        visible_prompt=(
            _prompt_value(db, visible_key)
            if visible_key is not None
            else None
        ),
        thermal_prompt=(
            _prompt_value(db, thermal_key)
            if thermal_key is not None
            else None
        ),
        visible_file=(
            f"docs/提示词/{visible_filename}"
            if visible_filename is not None
            else None
        ),
        thermal_file=(
            f"docs/提示词/{thermal_filename}"
            if thermal_filename is not None
            else None
        ),
    )
