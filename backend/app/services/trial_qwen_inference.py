from __future__ import annotations

import asyncio
import base64
import json
import logging
import math
import random
import re
from dataclasses import dataclass
from io import BytesIO
from typing import Any, Literal, Sequence
from uuid import UUID

import httpx
from PIL import Image, ImageOps


logger = logging.getLogger(__name__)


TRIAL_QWEN_PROMPT = """你是建筑外墙缺陷检测助手。
当前输入是一张建筑外墙的局部切片图片，不是完整建筑立面。请只判断该切片中是否存在以下外墙缺陷：
 - crack：墙面、涂层、抹灰层或面砖表面的异常细窄线状裂口；正常瓷砖缝、分格缝、拼缝和构造缝不属于裂缝
 - spalling：外墙瓷砖/面砖、涂层或抹灰层已经发生块状、面状的实体材料脱落缺失
判定顺序必须是：先排除正常构造线，再在剩余候选中识别 crack 或 spalling。不要因为线条细长、颜色较深就直接判定为 crack。
规则：
1. 只输出 JSON 数组，不要输出解释、Markdown、标题或其他文字。
2. 如果没有发现明显缺陷，输出 []。
3. 每个结果必须包含以下字段：
 - type：只能是 crack 或 spalling
 - confidence：0 到 1 的小数
 - bbox：格式为 [x1, y1, x2, y2]
 - description：不超过20字
4. bbox 使用 Qwen3-VL 原生归一化坐标，原点在左上角；每个坐标必须是 0 到 999 的数字，不是像素值。
5. 正常构造线排除具有最高优先级。候选线若与面砖或墙板边界重合，并且整体笔直等宽、边缘完整、没有局部破损/扩宽/错位，或与相邻线等间距重复并组成规则横竖网格，应判定为正常瓷砖缝、分格缝、拼缝或构造缝，禁止输出。即使线条颜色很深也不得输出。
6. 完整、规则、边缘无破损的窗框边缘、装饰线条、伸缩缝、墙体阴阳角和规则板块边界都不是 crack；但其邻近或上覆的异常裂口仍须按规则7至10判断，不能仅因靠近窗框或构件边界而排除。局部切片上下文不足、无法区分裂口和正常接缝时，宁可输出 []。
7. crack 必须具有区别于正常构造缝的异常形态证据，例如不规则走向、宽度明显变化、锯齿破损边缘、分叉、错位，或裂口横跨/延伸进入面砖或墙板表面。仅有笔直细线、普通暗线或“接缝处细纹”不足以判定为 crack。
8. 位于正常接缝上的异常只有在可见局部扩宽、宽度不均、边缘破损、错位、分叉离开接缝或延伸进入板面时，才可输出 crack；description 必须描述该异常证据，不能只写“分格缝”“拼缝裂纹”或“接缝细纹”。
9. 当候选与窗框下沿、面砖缝或板缝邻近或部分重合，但裂口本身连续可见，并有宽度不均、锯齿/破损边缘、局部扩宽、错位、偏离接缝或延伸进入板面等异常证据时，不得仅因其走向较直、靠近构件边界或沿接缝延伸就排除；应输出 crack。
10. 对同一条连续裂缝，bbox 必须覆盖从可确认起点到终点的完整可见长度，包括较细但仍连续的中间段；不得只框最宽、最明显或破损最重的一小段。裂缝不可见的正常接缝不得纳入 bbox。
11. spalling 必须同时具有面状或块状缺损形态，以及至少一种实体材料损失证据：不规则破碎边缘、可见断面或厚度、凹陷阴影、水泥/砂浆基层外露。不得仅根据颜色较深、颜色较浅、纹理变化或模型自己的语义猜测“露出基层”。修补带、补漆或腻子痕迹、矩形色差区域、旧新涂层交界都不是 spalling。
12. 同一候选区域先在 crack 和 spalling 中二选一，不要重复输出两类。完整表面上的污渍、阴影、反光和普通划痕都不是缺陷。
13. 只有当缺陷较明显时才输出；不确定时请降低 confidence，低于 0.50 的目标不要输出。被规则5至6排除的正常构造线无论 confidence 多高都不得输出。
14. 返回前逐项自检：若 description 表示“正常”“非缺陷”，或只表示瓷砖缝、分格缝、拼缝、构造缝、板缝、接缝而没有规则7至9要求的异常证据，必须删除该项。
以下反例都必须输出 []：
 - 三条等间距、等宽、笔直的竖线，与墙板边界重合
 - 一条边缘完整、等宽、无破损的连续横线沿多块面砖或墙板边界延伸
以下正例应输出 crack：
 - 窗框下方一条连续横向裂口，虽邻近窗框或板缝，但可见破损边缘和宽窄变化；bbox 覆盖整条连续可见裂口
输出示例：
[
  {
    "type": "crack",
    "confidence": 0.82,
    "bbox": [120, 80, 360, 130],
    "description": "不规则裂口横跨面砖"
  },
  {
    "type": "spalling",
    "confidence": 0.76,
    "bbox": [420, 210, 560, 360],
    "description": "面砖掉块并露出砂浆"
  }
]"""

TRIAL_QWEN_CRACK_PROMPT = """你是建筑外墙裂缝检测助手。
当前输入是一张建筑外墙的局部切片图片，不是完整建筑立面。请只判断该切片中是否存在以下外墙缺陷：
 - crack：墙面、涂层、抹灰层或面砖表面的异常细窄线状裂口；正常瓷砖缝、分格缝、拼缝和构造缝不属于裂缝
判定顺序必须是：先排除正常构造线，再在剩余候选中识别 crack。不要因为线条细长、颜色较深就直接判定为 crack。
规则：
1. 只输出 JSON 数组，不要输出解释、Markdown、标题或其他文字。
2. 如果没有发现明显裂缝，输出 []。
3. 每个结果必须包含以下字段：
 - type：只能是 crack
 - confidence：0 到 1 的小数
 - bbox：格式为 [x1, y1, x2, y2]
 - description：不超过20字
4. bbox 使用 Qwen3-VL 原生归一化坐标，原点在左上角；每个坐标必须是 0 到 999 的数字，不是像素值。
5. 正常构造线排除具有最高优先级。候选线若与面砖或墙板边界重合，并且整体笔直等宽、边缘完整、没有局部破损/扩宽/错位，或与相邻线等间距重复并组成规则横竖网格，应判定为正常瓷砖缝、分格缝、拼缝或构造缝，禁止输出。即使线条颜色很深也不得输出。
6. 完整、规则、边缘无破损的窗框边缘、装饰线条、伸缩缝、墙体阴阳角和规则板块边界都不是 crack；但其邻近或上覆的异常裂口仍须按规则7至10判断，不能仅因靠近窗框或构件边界而排除。局部切片上下文不足、无法区分裂口和正常接缝时，宁可输出 []。
7. crack 必须具有区别于正常构造缝的异常形态证据，例如不规则走向、宽度明显变化、锯齿破损边缘、分叉、错位，或裂口横跨/延伸进入面砖或墙板表面。仅有笔直细线、普通暗线或“接缝处细纹”不足以判定为 crack。
8. 位于正常接缝上的异常只有在可见局部扩宽、宽度不均、边缘破损、错位、分叉离开接缝或延伸进入板面时，才可输出 crack；description 必须描述该异常证据，不能只写“分格缝”“拼缝裂纹”或“接缝细纹”。
9. 当候选与窗框下沿、面砖缝或板缝邻近或部分重合，但裂口本身连续可见，并有宽度不均、锯齿/破损边缘、局部扩宽、错位、偏离接缝或延伸进入板面等异常证据时，不得仅因其走向较直、靠近构件边界或沿接缝延伸就排除；应输出 crack。
10. 对同一条连续裂缝，bbox 必须覆盖从可确认起点到终点的完整可见长度，包括较细但仍连续的中间段；不得只框最宽、最明显或破损最重的一小段。裂缝不可见的正常接缝不得纳入 bbox。
11. 剥落、空鼓、污渍、阴影、反光、修补带、补漆、腻子痕迹和普通划痕都不是 crack，不要输出其他缺陷类型。
12. 只有当裂缝较明显时才输出；不确定时请降低 confidence，低于 0.50 的目标不要输出。被规则5至6排除的正常构造线无论 confidence 多高都不得输出。
13. 返回前逐项自检：若 description 表示“正常”“非缺陷”，或只表示瓷砖缝、分格缝、拼缝、构造缝、板缝、接缝而没有规则7至9要求的异常证据，必须删除该项。
以下反例都必须输出 []：
 - 三条等间距、等宽、笔直的竖线，与墙板边界重合
 - 一条边缘完整、等宽、无破损的连续横线沿多块面砖或墙板边界延伸
以下正例应输出 crack：
 - 窗框下方一条连续横向裂口，虽邻近窗框或板缝，但可见破损边缘和宽窄变化；bbox 覆盖整条连续可见裂口
输出示例：
[
  {
    "type": "crack",
    "confidence": 0.82,
    "bbox": [120, 80, 360, 130],
    "description": "不规则裂口横跨面砖"
  }
]"""

TRIAL_QWEN_SPALLING_PROMPT = """你是建筑外墙剥落检测助手。
当前输入是一张建筑外墙的局部切片图片，不是完整建筑立面。请只判断该切片中是否存在以下外墙缺陷：
 - spalling：外墙瓷砖/面砖、涂层或抹灰层已经发生块状、面状的实体材料脱落缺失
规则：
1. 只输出 JSON 数组，不要输出解释、Markdown、标题或其他文字。
2. 如果没有发现明显剥落，输出 []。
3. 每个结果必须包含以下字段：
 - type：只能是 spalling
 - confidence：0 到 1 的小数
 - bbox：格式为 [x1, y1, x2, y2]
 - description：不超过20字
4. bbox 使用 Qwen3-VL 原生归一化坐标，原点在左上角；每个坐标必须是 0 到 999 的数字，不是像素值。
5. spalling 必须同时具有面状或块状缺损形态，以及至少一种实体材料损失证据：不规则破碎边缘、可见断面或厚度、凹陷阴影、水泥/砂浆基层外露。
6. 不得仅根据颜色较深、颜色较浅、纹理变化或模型自己的语义猜测“露出基层”。修补带、补漆或腻子痕迹、矩形色差区域、旧新涂层交界都不是 spalling。
7. 完整表面上的污渍、水渍、阴影、反光、普通划痕、广告残留、贴纸或附着物不是 spalling。
8. 正常瓷砖缝、分格缝、拼缝、构造缝、窗框边缘、装饰线条、伸缩缝、墙体阴阳角和规则板块边界都不是 spalling。
9. 裂缝、空鼓和锈蚀不是 spalling，不要输出其他缺陷类型。只有裂纹而没有成片实体材料缺失时必须输出 []。
10. bbox 应紧密包围实际材料脱落区域，不要把大面积完整墙面、阴影或相邻正常接缝框入。
11. 只有当剥落较明显时才输出；不确定时请降低 confidence，低于 0.50 的目标不要输出。
12. 返回前逐项自检：若候选区域没有规则5要求的实体材料损失证据，或 description 只描述色差、污渍、阴影、修补痕迹，必须删除该项。
输出示例：
[
  {
    "type": "spalling",
    "confidence": 0.76,
    "bbox": [420, 210, 560, 360],
    "description": "面砖掉块并露出砂浆"
  }
]"""

TRIAL_QWEN_THERMAL_PROMPT = """你是建筑外墙热成像空鼓检测助手。
当前输入是一张采用 IronRed（铁红）色板的建筑外墙热成像局部切片，不是完整建筑立面。该图片只用于识别空鼓，不检测裂缝、剥落、锈蚀或其他缺陷。
请只判断墙面区域中是否存在以下热异常：
 - hollow：疑似空鼓
判定特征：
 - 目标主体是一块连续、成片且尺寸明显的黑色或近黑色低温区域；
 - 黑色区域的多侧被范围同样明显、颜色相对均匀的紫红色墙面背景包围；
 - 黑色区域与周围紫红色之间存在较清楚的热对比边界，形状可以不规则。
规则：
1. 只输出 JSON 数组，不要输出解释、Markdown、标题或其他文字。
2. 如果没有发现明显的疑似空鼓，输出 []。
3. 每个结果必须包含以下字段：
 - type：只能是 hollow
 - confidence：0 到 1 的小数
 - bbox：格式为 [x1, y1, x2, y2]
 - description：不超过20字
4. bbox 使用 Qwen3-VL 原生归一化坐标，原点在左上角；每个坐标必须是 0 到 999 的数字，不是像素值。
5. bbox 只框住成片的黑色或近黑色热异常主体，不要把大面积紫红色背景一起框入。
6. 很小的黑点、零散噪点、孤立像素、细小斑点不是空鼓；黑色候选区域和包围它的均匀紫红色背景都必须具有明显面积。
7. 可识别的窗户、门洞、通风口、设备、屋檐、墙体边缘、伸缩缝、横竖线条及其低温轮廓不是空鼓。
8. 大面积纯黑边框、贴近图片边缘且无法确认被紫红色墙面包围的区域，以及细长的水平或垂直暗带，不要输出 hollow。
9. 不要输出 crack、spalling、corrosion 或其他类型，即使图片中看起来存在这些缺陷。
10. 只有当上述热异常特征较明显时才输出；不确定时请降低 confidence，低于 0.40 的目标不要输出。
输出示例：
[
  {
    "type": "hollow",
    "confidence": 0.86,
    "bbox": [430, 180, 560, 290],
    "description": "疑似墙面空鼓"
  }
]"""

TILE_WIDTH = 1280
TILE_HEIGHT = 960
TILE_OVERLAP_RATIO = 0.25
NMS_IOU_THRESHOLD = 0.5
CROSS_TILE_MERGE_IOS_THRESHOLD = 0.60
MAX_QWEN_CONCURRENCY = 10
UPSTREAM_REQUEST_MAX_ATTEMPTS = 3
UPSTREAM_RETRY_BASE_DELAY_SECONDS = 0.5
UPSTREAM_RETRYABLE_STATUS_CODES = frozenset({408, 429, 500, 502, 503, 504})
DEFAULT_MAX_IMAGE_PIXELS = 64_000_000
DEFAULT_INFERENCE_MAX_IMAGE_PIXELS = 64_000_000
DEFAULT_MAX_TILES_PER_IMAGE = 100
DEFAULT_MAX_TILES_PER_REQUEST = 1000
MIN_DETECTION_CONFIDENCE = 0.40
# Applied in the fixed 1280x960 model-input tile space before any mapping back
# to the source image. Thin cracks remain valid as long as their long side is
# large enough; only short, small crack boxes are rejected.
MIN_CRACK_LONG_SIDE_PIXELS = 64.0
QWEN_BBOX_COORDINATE_SCALE = 1000.0
# Qwen3-VL documents coordinates as [0, 999], but tolerate 1000 as an exact
# right/bottom edge because grounding responses commonly round to that value.
QWEN_BBOX_COORDINATE_MAX = 1000.0
DEFECT_TYPE_NAMES = {
    "crack": "裂缝",
    "spalling": "剥落",
    "corrosion": "锈蚀",
    "hollow": "空鼓",
}
SUPPORTED_IMAGE_FORMATS = {"JPEG", "MPO", "PNG"}
VISIBLE_LIGHT_DEFECT_TYPES = frozenset({"crack", "spalling"})
THERMAL_DEFECT_TYPES = frozenset({"hollow"})
VISIBLE_LIGHT_REQUESTED_MODELS = ("crack", "spalling")
THERMAL_REQUESTED_MODELS = ("hollow",)
NORMAL_SEAM_DESCRIPTION_MARKERS = (
    "正常",
    "非缺陷",
    "非裂缝",
    "非裂纹",
    "非裂口",
    "无裂缝",
    "无裂纹",
    "无裂口",
)
NORMAL_SEAM_TERMS = (
    "瓷砖缝",
    "面砖缝",
    "分格缝",
    "拼缝",
    "构造缝",
    "板缝",
    "接缝",
    "横缝",
    "竖缝",
    "墙缝",
)
ABNORMAL_SEAM_EVIDENCE_TERMS = (
    "异常扩宽",
    "局部扩宽",
    "明显扩宽",
    "宽度不均",
    "宽窄不均",
    "锯齿",
    "边缘破损",
    "破碎边缘",
    "材料破损",
    "连续破损",
    "沿缝破损",
    "错位",
    "偏离接缝",
    "偏离窗框",
    "分叉离开",
    "分叉离缝",
    "延伸进入",
    "延伸入板",
    "横跨面砖",
    "横跨墙板",
    "跨越面砖",
    "跨越墙板",
    "贯穿面砖",
    "贯穿墙板",
)


class TrialQwenInferenceError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class TrialQwenImageInput:
    filename: str
    content: bytes
    content_type: str | None = None
    photo_id: UUID | str | None = None
    thermal_imaging_available: bool = False


@dataclass(frozen=True, slots=True)
class _Tile:
    x: int
    y: int
    valid_width: int
    valid_height: int


@dataclass(slots=True)
class _ImageState:
    image_input: TrialQwenImageInput
    width: int
    height: int
    processing_width: int
    processing_height: int
    tiles: list[_Tile]
    tile_detections: list[list[dict[str, Any]] | None]
    tile_token_usages: list[dict[str, Any] | None]


@dataclass(frozen=True, slots=True)
class _TileJob:
    image_index: int
    tile_index: int
    tile: _Tile
    content: bytes


async def infer_trial_images(
    images: Sequence[TrialQwenImageInput],
    *,
    api_key: str,
    base_url: str,
    model: str = "qwen3-vl-plus",
    provider: Literal["qwen", "zhipu"] = "qwen",
    visible_prompt: str = TRIAL_QWEN_PROMPT,
    thermal_prompt: str = TRIAL_QWEN_THERMAL_PROMPT,
    visible_defect_types: Sequence[str] = VISIBLE_LIGHT_REQUESTED_MODELS,
    timeout_seconds: float = 120.0,
    max_concurrency: int = MAX_QWEN_CONCURRENCY,
    max_image_pixels: int = DEFAULT_MAX_IMAGE_PIXELS,
    inference_max_image_pixels: int = DEFAULT_INFERENCE_MAX_IMAGE_PIXELS,
    max_tiles_per_image: int = DEFAULT_MAX_TILES_PER_IMAGE,
    max_tiles_per_request: int = DEFAULT_MAX_TILES_PER_REQUEST,
) -> list[dict[str, Any]]:
    """Run tiled vision inference and return one legacy-compatible result per image."""
    normalized_api_key = api_key.strip()
    normalized_base_url = base_url.strip().rstrip("/")
    normalized_model = model.strip()
    if not normalized_api_key:
        raise ValueError("Qwen API key is required.")
    if not normalized_base_url:
        raise ValueError("Qwen API base URL is required.")
    if not normalized_model:
        raise ValueError("Qwen model is required.")
    if provider not in ("qwen", "zhipu"):
        raise ValueError("Unsupported trial inference provider.")
    if not math.isfinite(timeout_seconds) or timeout_seconds <= 0:
        raise ValueError("Qwen timeout must be a positive finite number.")

    concurrency = _bounded_concurrency(max_concurrency)
    normalized_visible_defect_types = _visible_defect_types(visible_defect_types)
    _validate_image_batch(
        images,
        max_image_pixels=max_image_pixels,
        inference_max_image_pixels=inference_max_image_pixels,
        max_tiles_per_image=max_tiles_per_image,
        max_tiles_per_request=max_tiles_per_request,
    )
    endpoint = (
        normalized_base_url
        if normalized_base_url.endswith("/chat/completions")
        else f"{normalized_base_url}/chat/completions"
    )
    limits = httpx.Limits(
        max_connections=concurrency,
        max_keepalive_connections=concurrency,
    )
    headers = {
        "Authorization": f"Bearer {normalized_api_key}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(
        headers=headers,
        limits=limits,
        timeout=httpx.Timeout(timeout_seconds),
        trust_env=False,
    ) as client:
        states: list[_ImageState] = []
        queue: asyncio.Queue[_TileJob | None] = asyncio.Queue(maxsize=concurrency * 2)
        producer = asyncio.create_task(
            _produce_tile_jobs(
                images,
                queue=queue,
                states=states,
                worker_count=concurrency,
                max_image_pixels=max_image_pixels,
                inference_max_image_pixels=inference_max_image_pixels,
            )
        )
        workers = [
            asyncio.create_task(
                _tile_worker(
                    queue=queue,
                    states=states,
                    client=client,
                    endpoint=endpoint,
                    model=normalized_model,
                    provider=provider,
                    visible_prompt=visible_prompt,
                    thermal_prompt=thermal_prompt,
                    visible_defect_types=normalized_visible_defect_types,
                )
            )
            for _ in range(concurrency)
        ]
        tasks = [producer, *workers]
        try:
            await asyncio.gather(*tasks)
        except BaseException:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            raise
    return [
        _inference_result(
            state,
            model=normalized_model,
            provider=provider,
            concurrency=concurrency,
            visible_requested_models=normalized_visible_defect_types,
        )
        for state in states
    ]


def estimate_trial_api_request_count(
    images: Sequence[TrialQwenImageInput],
    *,
    max_image_pixels: int = DEFAULT_MAX_IMAGE_PIXELS,
    inference_max_image_pixels: int = DEFAULT_INFERENCE_MAX_IMAGE_PIXELS,
    max_tiles_per_image: int = DEFAULT_MAX_TILES_PER_IMAGE,
    max_tiles_per_request: int = DEFAULT_MAX_TILES_PER_REQUEST,
) -> int:
    """Return the exact preflight tile budget used for Qwen API requests."""
    return _validate_image_batch(
        images,
        max_image_pixels=max_image_pixels,
        inference_max_image_pixels=inference_max_image_pixels,
        max_tiles_per_image=max_tiles_per_image,
        max_tiles_per_request=max_tiles_per_request,
    )


def _bounded_concurrency(value: int) -> int:
    if isinstance(value, bool):
        raise ValueError("Qwen max concurrency must be a positive integer.")
    try:
        requested = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("Qwen max concurrency must be a positive integer.") from exc
    if requested <= 0:
        raise ValueError("Qwen max concurrency must be a positive integer.")
    return min(requested, MAX_QWEN_CONCURRENCY)


def _visible_defect_types(values: Sequence[str]) -> frozenset[str]:
    normalized = frozenset(str(value).strip() for value in values)
    if not normalized.issubset(VISIBLE_LIGHT_DEFECT_TYPES):
        raise ValueError("Visible defect types can only contain crack and spalling.")
    return normalized


async def _produce_tile_jobs(
    images: Sequence[TrialQwenImageInput],
    *,
    queue: asyncio.Queue[_TileJob | None],
    states: list[_ImageState],
    worker_count: int,
    max_image_pixels: int,
    inference_max_image_pixels: int,
) -> None:
    for image_input in images:
        source_image = _open_image(image_input, max_image_pixels=max_image_pixels)
        try:
            original_width, original_height = source_image.size
            image = _inference_image(
                source_image,
                max_image_pixels=inference_max_image_pixels,
            )
            try:
                tiles = _image_tiles(image)
                image_index = len(states)
                states.append(
                    _ImageState(
                        image_input=image_input,
                        width=original_width,
                        height=original_height,
                        processing_width=image.width,
                        processing_height=image.height,
                        tiles=tiles,
                        tile_detections=[None] * len(tiles),
                        tile_token_usages=[None] * len(tiles),
                    )
                )
                for tile_index, tile in enumerate(tiles):
                    await queue.put(
                        _TileJob(
                            image_index=image_index,
                            tile_index=tile_index,
                            tile=tile,
                            content=_encode_tile_png(image, tile),
                        )
                    )
            finally:
                if image is not source_image:
                    image.close()
        finally:
            source_image.close()

    for _ in range(worker_count):
        await queue.put(None)


async def _tile_worker(
    *,
    queue: asyncio.Queue[_TileJob | None],
    states: list[_ImageState],
    client: httpx.AsyncClient,
    endpoint: str,
    model: str,
    provider: Literal["qwen", "zhipu"],
    visible_prompt: str,
    thermal_prompt: str,
    visible_defect_types: frozenset[str],
) -> None:
    while True:
        job = await queue.get()
        if job is None:
            return
        image_input = states[job.image_index].image_input
        prompt, allowed_defect_types = _inference_contract(
            image_input,
            provider=provider,
            visible_prompt=visible_prompt,
            thermal_prompt=thermal_prompt,
            visible_defect_types=visible_defect_types,
        )
        response_payload = await _request_tile(
            client,
            endpoint=endpoint,
            model=model,
            provider=provider,
            tile_png=job.content,
            prompt=prompt,
        )
        raw_detections = _response_detection_array(response_payload)
        token_usage = _response_token_usage(response_payload)
        if token_usage is None:
            logger.warning(
                "qwen_usage_missing model=%s image_index=%d tile_index=%d response_keys=%s",
                model,
                job.image_index,
                job.tile_index,
                sorted(response_payload),
            )
        states[job.image_index].tile_token_usages[job.tile_index] = token_usage
        states[job.image_index].tile_detections[job.tile_index] = [
            normalized
            for item in raw_detections
            if (
                normalized := _normalize_detection(
                    item,
                    job.tile,
                    allowed_defect_types=allowed_defect_types,
                )
            ) is not None
        ]


def _inference_contract(
    image_input: TrialQwenImageInput,
    *,
    provider: Literal["qwen", "zhipu"] = "qwen",
    visible_prompt: str = TRIAL_QWEN_PROMPT,
    thermal_prompt: str = TRIAL_QWEN_THERMAL_PROMPT,
    visible_defect_types: frozenset[str] = VISIBLE_LIGHT_DEFECT_TYPES,
) -> tuple[str, frozenset[str]]:
    if image_input.thermal_imaging_available:
        prompt = thermal_prompt
        defect_types = THERMAL_DEFECT_TYPES
    else:
        prompt = visible_prompt
        defect_types = visible_defect_types
    if provider == "zhipu":
        prompt = prompt.replace("Qwen3-VL 原生归一化坐标", "0 到 999 的归一化坐标")
    return prompt, defect_types


def _inference_result(
    state: _ImageState,
    *,
    model: str,
    provider: Literal["qwen", "zhipu"],
    concurrency: int,
    visible_requested_models: frozenset[str] = VISIBLE_LIGHT_DEFECT_TYPES,
) -> dict[str, Any]:
    raw_detections = [
        detection
        for tile_result in state.tile_detections
        if tile_result is not None
        for detection in tile_result
    ]
    cross_tile_merged_detections = _merge_cross_tile_duplicate_boxes(
        raw_detections,
        ios_threshold=CROSS_TILE_MERGE_IOS_THRESHOLD,
    )
    if (
        state.processing_width != state.width
        or state.processing_height != state.height
    ):
        cross_tile_merged_detections = [
            _scale_detection_to_original(detection, state)
            for detection in cross_tile_merged_detections
        ]
    detections = _class_aware_nms(
        cross_tile_merged_detections,
        iou_threshold=NMS_IOU_THRESHOLD,
    )
    detections = [_public_detection(detection) for detection in detections]
    _assign_detection_ids(detections)
    tile_token_usages = [
        {
            "tile_index": tile_index + 1,
            "x": tile.x,
            "y": tile.y,
            "valid_width": tile.valid_width,
            "valid_height": tile.valid_height,
            "token_usage": state.tile_token_usages[tile_index],
        }
        for tile_index, tile in enumerate(state.tiles)
    ]
    return {
        "provider": provider,
        "model_version": model,
        "filename": state.image_input.filename,
        "photo_id": (
            str(state.image_input.photo_id)
            if state.image_input.photo_id is not None
            else None
        ),
        "image": {"width": state.width, "height": state.height},
        "inference": {
            "mode": "tiled",
            "image_size": {"width": TILE_WIDTH, "height": TILE_HEIGHT},
            "source_image_size": {"width": state.width, "height": state.height},
            "processing_image_size": {
                "width": state.processing_width,
                "height": state.processing_height,
            },
            "resized_for_inference": (
                state.processing_width != state.width
                or state.processing_height != state.height
            ),
            "tile_size": {"width": TILE_WIDTH, "height": TILE_HEIGHT},
            "tile_width": TILE_WIDTH,
            "tile_height": TILE_HEIGHT,
            "tile_overlap_ratio": TILE_OVERLAP_RATIO,
            "tile_count": len(state.tiles),
            "api_request_count": len(state.tiles),
            "max_concurrency": concurrency,
            "padding": "white",
            "bbox_coordinate_space": "normalized_0_999",
            "bbox_coordinate_scale": int(QWEN_BBOX_COORDINATE_SCALE),
            "cross_tile_merge_method": "intersection_over_smaller_union",
            "cross_tile_merge_ios_threshold": CROSS_TILE_MERGE_IOS_THRESHOLD,
            "pre_merge_detection_count": len(raw_detections),
            "post_merge_detection_count": len(cross_tile_merged_detections),
            "nms_iou_threshold": NMS_IOU_THRESHOLD,
            "pre_nms_detection_count": len(cross_tile_merged_detections),
            "post_nms_detection_count": len(detections),
        },
        "requested_models": list(
            THERMAL_REQUESTED_MODELS
            if state.image_input.thermal_imaging_available
            else (
                model
                for model in VISIBLE_LIGHT_REQUESTED_MODELS
                if model in visible_requested_models
            )
        ),
        "executed_models": [model],
        "token_usage": _aggregate_token_usages(
            state.tile_token_usages,
            request_count=len(state.tiles),
        ),
        "tile_token_usages": tile_token_usages,
        "detections": detections,
    }


def _validate_image_batch(
    images: Sequence[TrialQwenImageInput],
    *,
    max_image_pixels: int,
    inference_max_image_pixels: int,
    max_tiles_per_image: int,
    max_tiles_per_request: int,
) -> int:
    if (
        max_image_pixels <= 0
        or inference_max_image_pixels <= 0
        or max_tiles_per_image <= 0
        or max_tiles_per_request <= 0
    ):
        raise ValueError("Trial image limits must be positive integers.")

    total_tiles = 0
    for image_input in images:
        if not isinstance(image_input.content, bytes) or not image_input.content:
            raise TrialQwenInferenceError(f"Image is empty: {image_input.filename}")
        try:
            with Image.open(BytesIO(image_input.content)) as source:
                if source.format not in SUPPORTED_IMAGE_FORMATS:
                    raise TrialQwenInferenceError(
                        f"Unsupported image format: {image_input.filename}"
                    )
                width, height = source.size
                if width <= 0 or height <= 0:
                    raise TrialQwenInferenceError(
                        f"Invalid image dimensions: {image_input.filename}"
                    )
                pixels = width * height
                if pixels > max_image_pixels:
                    raise TrialQwenInferenceError(
                        f"Image exceeds {max_image_pixels} pixels: {image_input.filename}"
                    )
                processing_width, processing_height = _scaled_dimensions(
                    width,
                    height,
                    inference_max_image_pixels,
                )
                rotated_width, rotated_height = _scaled_dimensions(
                    height,
                    width,
                    inference_max_image_pixels,
                )
                normal_tiles = _tile_count(processing_width, processing_height)
                rotated_tiles = _tile_count(rotated_width, rotated_height)
                tile_count = max(normal_tiles, rotated_tiles)
                if tile_count > max_tiles_per_image:
                    raise TrialQwenInferenceError(
                        f"Image creates too many tiles: {image_input.filename}"
                    )
                total_tiles += tile_count
                if total_tiles > max_tiles_per_request:
                    raise TrialQwenInferenceError("Trial request creates too many image tiles.")
                source.verify()
        except TrialQwenInferenceError:
            raise
        except Exception as exc:
            raise TrialQwenInferenceError(f"Invalid image file: {image_input.filename}") from exc
    return total_tiles


def _tile_count(width: int, height: int) -> int:
    return len(_tile_starts(width, TILE_WIDTH)) * len(_tile_starts(height, TILE_HEIGHT))


def _scaled_dimensions(width: int, height: int, max_image_pixels: int) -> tuple[int, int]:
    pixels = width * height
    if pixels <= max_image_pixels:
        return width, height
    scale = math.sqrt(max_image_pixels / pixels)
    return max(1, int(width * scale)), max(1, int(height * scale))


def _inference_image(image: Image.Image, *, max_image_pixels: int) -> Image.Image:
    width, height = _scaled_dimensions(image.width, image.height, max_image_pixels)
    if (width, height) == image.size:
        return image
    return image.resize((width, height), Image.Resampling.LANCZOS)


def _scale_detection_to_original(
    detection: dict[str, Any],
    state: _ImageState,
) -> dict[str, Any]:
    bbox = detection.get("bbox")
    if not isinstance(bbox, dict):
        return detection
    scale_x = state.width / state.processing_width
    scale_y = state.height / state.processing_height
    scaled = dict(detection)
    scaled["bbox"] = {
        "x": float(bbox["x"]) * scale_x,
        "y": float(bbox["y"]) * scale_y,
        "width": float(bbox["width"]) * scale_x,
        "height": float(bbox["height"]) * scale_y,
    }
    return scaled


def _open_image(
    image_input: TrialQwenImageInput,
    *,
    max_image_pixels: int = DEFAULT_MAX_IMAGE_PIXELS,
) -> Image.Image:
    if not isinstance(image_input.content, bytes) or not image_input.content:
        raise TrialQwenInferenceError(f"Image is empty: {image_input.filename}")
    try:
        with Image.open(BytesIO(image_input.content)) as source:
            if source.format not in SUPPORTED_IMAGE_FORMATS:
                raise TrialQwenInferenceError(
                    f"Unsupported image format: {image_input.filename}"
                )
            if getattr(source, "n_frames", 1) > 1:
                source.seek(0)
            oriented = ImageOps.exif_transpose(source)
            try:
                if oriented.width * oriented.height > max_image_pixels:
                    raise TrialQwenInferenceError(
                        f"Image exceeds {max_image_pixels} pixels: {image_input.filename}"
                    )
                image = oriented.convert("RGB")
                image.load()
            finally:
                if oriented is not source:
                    oriented.close()
    except TrialQwenInferenceError:
        raise
    except Exception as exc:
        raise TrialQwenInferenceError(f"Invalid image file: {image_input.filename}") from exc
    if image.width <= 0 or image.height <= 0:
        image.close()
        raise TrialQwenInferenceError(f"Invalid image dimensions: {image_input.filename}")
    return image


def _image_tiles(image: Image.Image) -> list[_Tile]:
    return [
        _Tile(
            x=x,
            y=y,
            valid_width=min(TILE_WIDTH, image.width - x),
            valid_height=min(TILE_HEIGHT, image.height - y),
        )
        for y in _tile_starts(image.height, TILE_HEIGHT)
        for x in _tile_starts(image.width, TILE_WIDTH)
    ]


def _tile_starts(length: int, tile_size: int) -> list[int]:
    if length <= tile_size:
        return [0]
    step = max(1, int(round(tile_size * (1.0 - TILE_OVERLAP_RATIO))))
    starts: list[int] = []
    start = 0
    while True:
        starts.append(start)
        if start + tile_size >= length:
            return starts
        start += step


def _encode_tile_png(image: Image.Image, tile: _Tile) -> bytes:
    crop = image.crop(
        (
            tile.x,
            tile.y,
            tile.x + tile.valid_width,
            tile.y + tile.valid_height,
        )
    )
    canvas = Image.new("RGB", (TILE_WIDTH, TILE_HEIGHT), "white")
    canvas.paste(crop, (0, 0))
    output = BytesIO()
    try:
        canvas.save(output, format="PNG")
        return output.getvalue()
    finally:
        output.close()
        canvas.close()
        crop.close()


async def _request_tile(
    client: httpx.AsyncClient,
    *,
    endpoint: str,
    model: str,
    provider: Literal["qwen", "zhipu"] = "qwen",
    tile_png: bytes,
    prompt: str = TRIAL_QWEN_PROMPT,
) -> dict[str, Any]:
    encoded_image = base64.b64encode(tile_png).decode("ascii")
    image_url = (
        encoded_image
        if provider == "zhipu"
        else f"data:image/png;base64,{encoded_image}"
    )
    request_payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": image_url},
                    },
                    {
                        "type": "text",
                        "text": prompt,
                    },
                ],
            }
        ],
        "stream": False,
    }
    if provider == "qwen" and model.lower().startswith("qwen3"):
        request_payload["enable_thinking"] = False
    elif provider == "zhipu":
        # Trial detection needs a short structured answer for every tile. Deep
        # thinking adds substantial latency across large tiled batches without
        # improving the response contract.
        request_payload["thinking"] = {"type": "disabled"}
    provider_label = "Zhipu" if provider == "zhipu" else "Qwen"
    response: httpx.Response | None = None
    for attempt in range(1, UPSTREAM_REQUEST_MAX_ATTEMPTS + 1):
        try:
            response = await client.post(endpoint, json=request_payload)
        except httpx.TransportError as exc:
            if attempt >= UPSTREAM_REQUEST_MAX_ATTEMPTS:
                raise TrialQwenInferenceError(
                    f"{provider_label} request failed after {attempt} attempts: {exc}"
                ) from exc
            await _wait_before_upstream_retry(
                provider_label=provider_label,
                attempt=attempt,
                reason=type(exc).__name__,
            )
            continue
        except httpx.HTTPError as exc:
            raise TrialQwenInferenceError(f"{provider_label} request failed: {exc}") from exc

        if response.is_success:
            break
        detail = _response_error_detail(response)
        if (
            response.status_code not in UPSTREAM_RETRYABLE_STATUS_CODES
            or attempt >= UPSTREAM_REQUEST_MAX_ATTEMPTS
        ):
            raise TrialQwenInferenceError(
                f"{provider_label} request failed with HTTP {response.status_code}: {detail}"
            )
        await _wait_before_upstream_retry(
            provider_label=provider_label,
            attempt=attempt,
            reason=f"HTTP {response.status_code}",
            retry_after=_retry_after_seconds(response),
        )

    if response is None:
        raise TrialQwenInferenceError(f"{provider_label} request failed without a response.")
    try:
        payload = response.json()
    except ValueError as exc:
        raise TrialQwenInferenceError(f"{provider_label} returned a non-JSON API response.") from exc
    if not isinstance(payload, dict):
        raise TrialQwenInferenceError(f"{provider_label} returned an invalid API response object.")
    return payload


async def _wait_before_upstream_retry(
    *,
    provider_label: str,
    attempt: int,
    reason: str,
    retry_after: float | None = None,
) -> None:
    exponential_delay = UPSTREAM_RETRY_BASE_DELAY_SECONDS * (2 ** (attempt - 1))
    jitter = random.uniform(0, UPSTREAM_RETRY_BASE_DELAY_SECONDS)
    delay = min(10.0, retry_after if retry_after is not None else exponential_delay + jitter)
    logger.warning(
        "trial_upstream_request_retry provider=%s attempt=%d next_attempt=%d delay_seconds=%.2f reason=%s",
        provider_label,
        attempt,
        attempt + 1,
        delay,
        reason,
    )
    await asyncio.sleep(delay)


def _retry_after_seconds(response: httpx.Response) -> float | None:
    value = response.headers.get("Retry-After")
    if value is None:
        return None
    try:
        seconds = float(value)
    except ValueError:
        return None
    if not math.isfinite(seconds) or seconds < 0:
        return None
    return min(10.0, seconds)


def _response_error_detail(response: httpx.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        payload = None
    if isinstance(payload, dict):
        error = payload.get("error")
        if isinstance(error, dict) and error.get("message"):
            return str(error["message"])[:500]
        if payload.get("message"):
            return str(payload["message"])[:500]
    detail = response.text.strip().replace("\r", " ").replace("\n", " ")
    return detail[:500] or "Unknown upstream error"


def _response_detection_array(payload: dict[str, Any]) -> list[Any]:
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        raise TrialQwenInferenceError("Qwen response does not contain choices[0].")
    message = choices[0].get("message")
    if not isinstance(message, dict):
        raise TrialQwenInferenceError("Qwen response does not contain choices[0].message.")
    content = _message_content_text(message.get("content"))
    return _parse_json_array(content)


def _response_token_usage(payload: dict[str, Any]) -> dict[str, Any] | None:
    raw_usage = payload.get("usage")
    if not isinstance(raw_usage, dict):
        return None

    usage: dict[str, Any] = {}
    _copy_token_count(raw_usage, usage, "prompt_tokens", "prompt_tokens", "input_tokens")
    _copy_token_count(
        raw_usage,
        usage,
        "completion_tokens",
        "completion_tokens",
        "output_tokens",
    )
    _copy_token_count(raw_usage, usage, "total_tokens", "total_tokens")

    prompt_details = _token_details(
        raw_usage.get("prompt_tokens_details") or raw_usage.get("input_tokens_details"),
        fields=("text_tokens", "image_tokens", "video_tokens", "cached_tokens"),
    )
    top_level_image_tokens = _non_negative_int(raw_usage.get("image_tokens"))
    if top_level_image_tokens is not None and "image_tokens" not in prompt_details:
        prompt_details["image_tokens"] = top_level_image_tokens
    if prompt_details:
        usage["prompt_tokens_details"] = prompt_details

    completion_details = _token_details(
        raw_usage.get("completion_tokens_details") or raw_usage.get("output_tokens_details"),
        fields=("text_tokens", "reasoning_tokens"),
    )
    if completion_details:
        usage["completion_tokens_details"] = completion_details

    if "total_tokens" not in usage:
        prompt_tokens = usage.get("prompt_tokens")
        completion_tokens = usage.get("completion_tokens")
        if isinstance(prompt_tokens, int) and isinstance(completion_tokens, int):
            usage["total_tokens"] = prompt_tokens + completion_tokens
    return usage or None


def _copy_token_count(
    source: dict[str, Any],
    target: dict[str, Any],
    target_key: str,
    *source_keys: str,
) -> None:
    for source_key in source_keys:
        value = _non_negative_int(source.get(source_key))
        if value is not None:
            target[target_key] = value
            return


def _token_details(value: object, *, fields: tuple[str, ...]) -> dict[str, int]:
    if not isinstance(value, dict):
        return {}
    return {
        field: count
        for field in fields
        if (count := _non_negative_int(value.get(field))) is not None
    }


def _non_negative_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int) and value >= 0:
        return value
    return None


def _aggregate_token_usages(
    usages: Sequence[dict[str, Any] | None],
    *,
    request_count: int | None = None,
) -> dict[str, Any]:
    reported_usages = [usage for usage in usages if isinstance(usage, dict)]
    aggregate: dict[str, Any] = {
        "request_count": len(usages) if request_count is None else request_count,
        "reported_request_count": len(reported_usages),
    }
    for field in ("prompt_tokens", "completion_tokens", "total_tokens"):
        values = [
            value
            for usage in reported_usages
            if (value := _non_negative_int(usage.get(field))) is not None
        ]
        if values:
            aggregate[field] = sum(values)

    for detail_key in ("prompt_tokens_details", "completion_tokens_details"):
        detail_fields = {
            field
            for usage in reported_usages
            if isinstance((details := usage.get(detail_key)), dict)
            for field in details
        }
        details_total: dict[str, int] = {}
        for field in detail_fields:
            values = [
                count
                for usage in reported_usages
                if isinstance((details := usage.get(detail_key)), dict)
                and (count := _non_negative_int(details.get(field))) is not None
            ]
            if values:
                details_total[field] = sum(values)
        if details_total:
            aggregate[detail_key] = details_total
    return aggregate


def _message_content_text(content: object) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        fragments = [
            str(item["text"])
            for item in content
            if isinstance(item, dict) and isinstance(item.get("text"), str)
        ]
        if fragments:
            return "".join(fragments)
    raise TrialQwenInferenceError("Qwen response message content is not text.")


def _parse_json_array(content: str) -> list[Any]:
    text = content.strip()
    if not text:
        raise TrialQwenInferenceError("Qwen returned empty message content.")

    candidates = [text]
    fenced_match = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", text, flags=re.IGNORECASE | re.DOTALL)
    if fenced_match:
        candidates.insert(0, fenced_match.group(1).strip())
    for candidate in candidates:
        try:
            decoded = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(decoded, list):
            return decoded
        raise TrialQwenInferenceError("Qwen message JSON must be an array.")

    decoder = json.JSONDecoder()
    empty_array: list[Any] | None = None
    for index, character in enumerate(text):
        if character != "[":
            continue
        try:
            decoded, _ = decoder.raw_decode(text[index:])
        except json.JSONDecodeError:
            continue
        if not isinstance(decoded, list):
            continue
        if decoded and all(isinstance(item, dict) for item in decoded):
            return decoded
        if not decoded and empty_array is None:
            empty_array = decoded
    if empty_array is not None:
        return empty_array
    raise TrialQwenInferenceError("Qwen message content does not contain a JSON array.")


def _normalize_detection(
    item: object,
    tile: _Tile,
    *,
    allowed_defect_types: frozenset[str] = VISIBLE_LIGHT_DEFECT_TYPES,
) -> dict[str, Any] | None:
    if not isinstance(item, dict):
        return None

    raw_type = item.get("type")
    if not isinstance(raw_type, str):
        return None
    defect_type = raw_type.strip().lower()
    if defect_type == "missing":
        defect_type = "spalling"
    if defect_type == "hollowing":
        defect_type = "hollow"
    if defect_type not in allowed_defect_types:
        return None

    confidence = _finite_float(item.get("confidence"))
    if confidence is None or not 0.0 <= confidence <= 1.0:
        return None
    if confidence < MIN_DETECTION_CONFIDENCE:
        return None

    description = item.get("description")
    if not isinstance(description, str):
        return None
    description = description.strip()
    if len(description) > 20:
        return None
    if defect_type == "crack" and _description_indicates_normal_seam(description):
        return None

    bbox = item.get("bbox")
    if not isinstance(bbox, list) or len(bbox) != 4:
        return None
    coordinates = [_finite_float(value) for value in bbox]
    if any(value is None for value in coordinates):
        return None
    normalized_x1, normalized_y1, normalized_x2, normalized_y2 = (
        float(value) for value in coordinates
    )
    if not all(
        0.0 <= value <= QWEN_BBOX_COORDINATE_MAX
        for value in (normalized_x1, normalized_y1, normalized_x2, normalized_y2)
    ):
        return None
    if normalized_x2 <= normalized_x1 or normalized_y2 <= normalized_y1:
        return None

    x1 = normalized_x1 / QWEN_BBOX_COORDINATE_SCALE * TILE_WIDTH
    y1 = normalized_y1 / QWEN_BBOX_COORDINATE_SCALE * TILE_HEIGHT
    x2 = normalized_x2 / QWEN_BBOX_COORDINATE_SCALE * TILE_WIDTH
    y2 = normalized_y2 / QWEN_BBOX_COORDINATE_SCALE * TILE_HEIGHT
    x1 = min(float(tile.valid_width), max(0.0, x1))
    y1 = min(float(tile.valid_height), max(0.0, y1))
    x2 = min(float(tile.valid_width), max(0.0, x2))
    y2 = min(float(tile.valid_height), max(0.0, y2))
    if x2 <= x1 or y2 <= y1:
        return None
    bbox_width = x2 - x1
    bbox_height = y2 - y1
    if (
        defect_type == "crack"
        and max(bbox_width, bbox_height) < MIN_CRACK_LONG_SIDE_PIXELS
    ):
        return None

    return {
        "id": None,
        "type": defect_type,
        "type_name": DEFECT_TYPE_NAMES[defect_type],
        "confidence": confidence,
        "bbox": {
            "x": x1 + tile.x,
            "y": y1 + tile.y,
            "width": bbox_width,
            "height": bbox_height,
        },
        "_source_tile": tile,
        "mask": None,
        "severity": None,
        "description": description,
    }


def _description_indicates_normal_seam(description: str) -> bool:
    normalized = re.sub(r"\s+", "", description)
    if any(marker in normalized for marker in NORMAL_SEAM_DESCRIPTION_MARKERS):
        return True
    if not any(term in normalized for term in NORMAL_SEAM_TERMS):
        return False
    return not any(evidence in normalized for evidence in ABNORMAL_SEAM_EVIDENCE_TERMS)


def _finite_float(value: object) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _merge_cross_tile_duplicate_boxes(
    detections: list[dict[str, Any]],
    *,
    ios_threshold: float,
) -> list[dict[str, Any]]:
    """Union likely duplicate boxes emitted by different overlapping tiles."""
    if len(detections) < 2:
        return list(detections)

    parents = list(range(len(detections)))

    def find(index: int) -> int:
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index

    def union(left_index: int, right_index: int) -> None:
        left_root = find(left_index)
        right_root = find(right_index)
        if left_root != right_root:
            parents[right_root] = left_root

    for left_index, left in enumerate(detections):
        for right_index in range(left_index + 1, len(detections)):
            right = detections[right_index]
            if _is_cross_tile_duplicate(
                left,
                right,
                ios_threshold=ios_threshold,
            ):
                union(left_index, right_index)

    groups: dict[int, list[dict[str, Any]]] = {}
    for index, detection in enumerate(detections):
        groups.setdefault(find(index), []).append(detection)
    return [_union_detection_group(group) for group in groups.values()]


def _is_cross_tile_duplicate(
    left: dict[str, Any],
    right: dict[str, Any],
    *,
    ios_threshold: float,
) -> bool:
    if left.get("type") != right.get("type"):
        return False
    left_tile = left.get("_source_tile")
    right_tile = right.get("_source_tile")
    if (
        not isinstance(left_tile, _Tile)
        or not isinstance(right_tile, _Tile)
        or left_tile == right_tile
        or not _tiles_overlap(left_tile, right_tile)
    ):
        return False
    return (
        _bbox_intersection_over_smaller(left.get("bbox"), right.get("bbox"))
        >= ios_threshold
    )


def _tiles_overlap(left: _Tile, right: _Tile) -> bool:
    return (
        min(left.x + left.valid_width, right.x + right.valid_width)
        > max(left.x, right.x)
        and min(left.y + left.valid_height, right.y + right.valid_height)
        > max(left.y, right.y)
    )


def _union_detection_group(group: list[dict[str, Any]]) -> dict[str, Any]:
    representative = max(
        group,
        key=lambda item: float(item.get("confidence") or 0.0),
    )
    if len(group) == 1:
        return representative

    geometries = [
        geometry
        for detection in group
        if (geometry := _bbox_geometry(detection.get("bbox"))) is not None
    ]
    if len(geometries) != len(group):
        return representative
    left = min(geometry[0] for geometry in geometries)
    top = min(geometry[1] for geometry in geometries)
    right = max(geometry[2] for geometry in geometries)
    bottom = max(geometry[3] for geometry in geometries)
    merged = dict(representative)
    merged["bbox"] = {
        "x": left,
        "y": top,
        "width": right - left,
        "height": bottom - top,
    }
    return merged


def _public_detection(detection: dict[str, Any]) -> dict[str, Any]:
    public = dict(detection)
    public.pop("_source_tile", None)
    return public


def _class_aware_nms(
    detections: list[dict[str, Any]],
    *,
    iou_threshold: float,
) -> list[dict[str, Any]]:
    kept: list[dict[str, Any]] = []
    for candidate in sorted(
        detections,
        key=lambda item: float(item.get("confidence") or 0.0),
        reverse=True,
    ):
        if all(
            candidate.get("type") != current.get("type")
            or _bbox_iou(candidate.get("bbox"), current.get("bbox")) <= iou_threshold
            for current in kept
        ):
            kept.append(candidate)
    return kept


def _bbox_iou(left: object, right: object) -> float:
    left_geometry = _bbox_geometry(left)
    right_geometry = _bbox_geometry(right)
    if left_geometry is None or right_geometry is None:
        return 0.0
    intersection = _geometry_intersection_area(left_geometry, right_geometry)
    union = left_geometry[4] + right_geometry[4] - intersection
    return intersection / union if union > 0 else 0.0


def _bbox_intersection_over_smaller(left: object, right: object) -> float:
    left_geometry = _bbox_geometry(left)
    right_geometry = _bbox_geometry(right)
    if left_geometry is None or right_geometry is None:
        return 0.0
    smaller_area = min(left_geometry[4], right_geometry[4])
    if smaller_area <= 0:
        return 0.0
    return _geometry_intersection_area(left_geometry, right_geometry) / smaller_area


def _bbox_geometry(
    bbox: object,
) -> tuple[float, float, float, float, float] | None:
    if not isinstance(bbox, dict):
        return None
    x = _finite_float(bbox.get("x"))
    y = _finite_float(bbox.get("y"))
    width = _finite_float(bbox.get("width"))
    height = _finite_float(bbox.get("height"))
    if (
        x is None
        or y is None
        or width is None
        or height is None
        or width <= 0
        or height <= 0
    ):
        return None
    return x, y, x + width, y + height, width * height


def _geometry_intersection_area(
    left: tuple[float, float, float, float, float],
    right: tuple[float, float, float, float, float],
) -> float:
    intersection_width = max(0.0, min(left[2], right[2]) - max(left[0], right[0]))
    intersection_height = max(0.0, min(left[3], right[3]) - max(left[1], right[1]))
    return intersection_width * intersection_height


def _assign_detection_ids(detections: list[dict[str, Any]]) -> None:
    counters: dict[str, int] = {}
    for detection in detections:
        defect_type = str(detection["type"])
        counters[defect_type] = counters.get(defect_type, 0) + 1
        detection["id"] = f"{defect_type}-{counters[defect_type]}"
