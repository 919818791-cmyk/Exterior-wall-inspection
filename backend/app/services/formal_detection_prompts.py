from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Sequence

from app.models.tables import SystemSetting


FacadeType = Literal["tile", "coating", "plaster", "panel", "curtain_wall"]

PROMPT_DIRECTORY = Path(__file__).resolve().parents[3] / "docs" / "提示词"
FACADE_TYPE_NAMES: dict[FacadeType, str] = {
    "tile": "饰面砖",
    "coating": "涂饰",
    "plaster": "抹灰",
    "panel": "饰面板",
    "curtain_wall": "幕墙",
}
FACADE_DEFECT_TYPES: dict[FacadeType, frozenset[str]] = {
    "tile": frozenset({"crack", "detachment", "hollow"}),
    "coating": frozenset({"crack", "peeling", "hollow"}),
    "plaster": frozenset({"crack", "spalling", "hollow"}),
    "panel": frozenset({"damage", "detachment"}),
    "curtain_wall": frozenset({"damage"}),
}
VISIBLE_PROMPT_VARIANTS = {
    frozenset({"crack"}): "crack_prompt",
    frozenset({"spalling"}): "spalling_prompt",
    frozenset({"crack", "spalling"}): "visible_prompt",
    frozenset({"peeling"}): "peeling_prompt",
    frozenset({"crack", "peeling"}): "crack_peeling_prompt",
    frozenset({"detachment"}): "detachment_prompt",
    frozenset({"crack", "detachment"}): "crack_detachment_prompt",
}
FORMAL_PROMPT_FILES = {
    "tile_crack_prompt": "饰面砖裂缝.txt",
    "tile_detachment_prompt": "饰面砖脱落.txt",
    "tile_crack_detachment_prompt": "饰面砖裂缝+脱落.txt",
    "tile_thermal_prompt": "饰面砖空鼓.txt",
    "coating_crack_prompt": "涂饰裂缝.txt",
    "coating_peeling_prompt": "涂饰起皮.txt",
    "coating_crack_peeling_prompt": "涂饰裂缝+起皮.txt",
    "coating_thermal_prompt": "涂饰空鼓.txt",
    "plaster_crack_prompt": "抹灰裂缝.txt",
    "plaster_spalling_prompt": "抹灰剥落.txt",
    "plaster_visible_prompt": "抹灰裂缝+剥落.txt",
    "plaster_thermal_prompt": "抹灰空鼓.txt",
    "panel_damage_prompt": "饰面板—面板破损.txt",
    "panel_detachment_prompt": "饰面板—脱落.txt",
    "curtain_wall_damage_prompt": "幕墙—面板破损.txt",
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
    visible_prompts: dict[str, str]
    visible_files: dict[str, str]


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
    unsupported_models = selected_models.difference(FACADE_DEFECT_TYPES[facade_type])
    if unsupported_models:
        unsupported = ", ".join(sorted(unsupported_models))
        raise ValueError(f"{facade_name}外墙不支持以下检测类型：{unsupported}")
    dedicated_visible_keys = (
        {
            defect_type: f"{facade_type}_{defect_type}_prompt"
            for defect_type in ("damage", "detachment")
            if defect_type in selected_models
        }
        if facade_type in {"panel", "curtain_wall"}
        else {}
    )
    visible_variant = (
        VISIBLE_PROMPT_VARIANTS.get(
            frozenset(
                selected_models.intersection(
                    {"crack", "spalling", "peeling", "detachment"}
                )
            )
        )
        if not dedicated_visible_keys
        else None
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
    visible_prompts = {
        defect_type: _prompt_value(db, prompt_key)
        for defect_type, prompt_key in dedicated_visible_keys.items()
    }
    visible_files = {
        defect_type: f"docs/提示词/{FORMAL_PROMPT_FILES[prompt_key]}"
        for defect_type, prompt_key in dedicated_visible_keys.items()
    }
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
        visible_prompts=visible_prompts,
        visible_files=visible_files,
    )
