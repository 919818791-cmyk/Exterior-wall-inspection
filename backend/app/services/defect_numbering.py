from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Mapping
from typing import Any


DEFECT_NUMBER_LABELS = {
    "crack": "裂缝",
    "missing": "剥落",
    "spalling": "剥落",
    "moisture": "潮湿",
    "corrosion": "锈蚀",
    "hollow": "空鼓",
}


def defect_number_label(defect_type: Any, sequence: int) -> str:
    raw_type = str(defect_type or "").strip()
    label = DEFECT_NUMBER_LABELS.get(raw_type, raw_type or "缺陷")
    return f"{label}-{max(1, int(sequence)):03d}"


def number_defects(defects: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
    counters: defaultdict[str, int] = defaultdict(int)
    numbered: list[dict[str, Any]] = []
    for defect in defects:
        item = dict(defect)
        raw_type = str(item.get("defect_type") or "").strip()
        label = DEFECT_NUMBER_LABELS.get(raw_type, raw_type or "缺陷")
        counters[label] += 1
        item["defect_no"] = defect_number_label(raw_type, counters[label])
        numbered.append(item)
    return numbered
