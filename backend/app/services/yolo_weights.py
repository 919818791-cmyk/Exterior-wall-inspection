"""Untrusted YOLO checkpoint boundary, shared with the standalone runtime.

The API uses only the standard-library preflight. It never unpickles uploads.
The runtime additionally uses a patched, restricted PyTorch unpickler; preflight
alone must never be treated as permission to use ordinary pickle/torch.load.
"""
from collections import OrderedDict
import hashlib
from importlib import import_module
import pickletools
from pathlib import PurePosixPath
from threading import Lock
import zipfile


class UnsafeYoloWeights(ValueError):
    pass


POLICY_VERSION = "restricted-pickle-v1"
MAX_PICKLE_BYTES = 16 * 1024 * 1024
MAX_ARCHIVE_MEMBERS = 20000
_LOAD_LOCK = Lock()

# Explicit inference classes, never a module-prefix wildcard or a list supplied
# by the checkpoint. Extending these requires a code review of the new classes.
TRUSTED_CLASSES = {
    "torch.nn.modules.activation": ("SiLU", "ReLU", "ReLU6", "LeakyReLU", "Hardswish", "Sigmoid"),
    "torch.nn.modules.batchnorm": ("BatchNorm2d",),
    "torch.nn.modules.container": ("Sequential", "ModuleList"),
    "torch.nn.modules.conv": ("Conv2d", "ConvTranspose2d"),
    "torch.nn.modules.linear": ("Identity", "Linear"),
    "torch.nn.modules.pooling": ("MaxPool2d", "AvgPool2d", "AdaptiveAvgPool2d"),
    "torch.nn.modules.upsampling": ("Upsample",),
    "ultralytics.nn.tasks": ("DetectionModel",),
    "ultralytics.nn.modules.conv": ("Conv", "Conv2", "DWConv", "DWConvTranspose2d", "ConvTranspose", "Concat", "Focus", "GhostConv", "RepConv"),
    "ultralytics.nn.modules.block": ("Bottleneck", "C1", "C2", "C2f", "C3", "C3k", "C3k2", "C2PSA", "C2fPSA", "PSA", "PSABlock", "Attention", "DFL", "SPP", "SPPF", "GhostBottleneck", "C3Ghost"),
    "ultralytics.nn.modules.head": ("Detect",),
}
ALLOWED_GLOBALS = {
    f"{module}.{name}" for module, names in TRUSTED_CLASSES.items() for name in names
} | {
    "__builtin__.set", "builtins.set", "collections.OrderedDict",
    "torch.Tensor", "torch.Size", "torch.nn.parameter.Parameter",
    "torch.FloatStorage", "torch.HalfStorage", "torch.DoubleStorage",
    "torch.LongStorage", "torch.IntStorage", "torch.ShortStorage",
    "torch.ByteStorage", "torch.CharStorage", "torch.BoolStorage", "torch.BFloat16Storage",
    "torch._utils._rebuild_tensor", "torch._utils._rebuild_tensor_v2",
    "torch._utils._rebuild_tensor_v3", "torch._utils._rebuild_parameter",
}
CLASS_GLOBALS = {f"{module}.{name}" for module, names in TRUSTED_CLASSES.items() for name in names}
REDUCERS = {
    "__builtin__.set", "builtins.set", "collections.OrderedDict",
    "torch.Size",
    "torch._utils._rebuild_tensor", "torch._utils._rebuild_tensor_v2",
    "torch._utils._rebuild_tensor_v3", "torch._utils._rebuild_parameter",
}


def _validate_pickle(data):
    # Symbolically follow stack/memo operations; never construct Python objects.
    # A class allowlist alone is insufficient: REDUCE could call DetectionModel's
    # constructor with attacker-controlled YAML (including an activation eval).
    # Classes may ONLY be allocated via NEWOBJ with empty arguments.
    value, mark, empty_args = object(), object(), object()
    stack, memo = [], {}
    last_position = -1

    def pop_mark():
        index = len(stack) - 1
        while index >= 0 and stack[index] is not mark:
            index -= 1
        if index < 0:
            raise UnsafeYoloWeights("模型 pickle 栈无效。")
        count = len(stack) - index - 1
        del stack[index:]
        return count

    for count, (opcode, argument, last_position) in enumerate(pickletools.genops(data)):
        if count > 1_000_000 or len(stack) > 200_000 or len(memo) > 200_000:
            raise UnsafeYoloWeights("模型 pickle 结构过于复杂。")
        name = opcode.name
        if name == "PROTO":
            if argument != 2 or last_position != 0:
                raise UnsafeYoloWeights("模型 pickle 协议不受支持。")
        elif name == "GLOBAL":
            module, symbol = argument.split(" ", 1)
            global_name = f"{module}.{symbol}"
            if global_name not in ALLOWED_GLOBALS:
                raise UnsafeYoloWeights("模型包含未获准的 Python 类型或函数，已拒绝加载。")
            stack.append(global_name)
        elif name == "MARK":
            stack.append(mark)
        elif name == "EMPTY_TUPLE":
            stack.append(empty_args)
        elif name in {"NONE", "NEWTRUE", "NEWFALSE", "BININT", "BININT1", "BININT2", "LONG1", "LONG4",
                      "BINFLOAT", "BINUNICODE", "BINSTRING", "SHORT_BINSTRING", "EMPTY_DICT", "EMPTY_LIST"}:
            stack.append(value)
        elif name in {"BINPUT", "LONG_BINPUT"}:
            memo[argument] = stack[-1]
        elif name in {"BINGET", "LONG_BINGET"}:
            stack.append(memo[argument])
        elif name == "TUPLE":
            stack.append(value if pop_mark() else empty_args)
        elif name in {"TUPLE1", "TUPLE2", "TUPLE3"}:
            size = int(name[-1])
            if len(stack) < size:
                raise UnsafeYoloWeights("模型 pickle 栈无效。")
            del stack[-size:]
            stack.append(value)
        elif name in {"APPENDS", "SETITEMS"}:
            pop_mark()
            if stack[-1] is not value:
                raise UnsafeYoloWeights("模型 pickle 容器无效。")
        elif name in {"APPEND", "SETITEM"}:
            size = 1 if name == "APPEND" else 2
            del stack[-size:]
            if stack[-1] is not value:
                raise UnsafeYoloWeights("模型 pickle 容器无效。")
        elif name == "REDUCE":
            stack.pop()  # arguments
            target = stack.pop()
            if not isinstance(target, str) or target not in REDUCERS:
                raise UnsafeYoloWeights("模型包含未获准的 pickle 构造调用。")
            stack.append(value)
        elif name == "NEWOBJ":
            arguments, target = stack.pop(), stack.pop()
            if arguments is not empty_args or not isinstance(target, str) or target not in CLASS_GLOBALS:
                raise UnsafeYoloWeights("模型包含未获准的 pickle 对象构造。")
            stack.append(value)
        elif name == "BUILD":
            stack.pop()  # state; weights_only validates its actual type
            if stack[-1] is not value:
                raise UnsafeYoloWeights("模型 pickle 对象状态无效。")
        elif name == "BINPERSID":
            stack.pop()
            stack.append(value)
        elif name == "STOP":
            if len(stack) != 1 or stack[0] is not value:
                raise UnsafeYoloWeights("模型 pickle 结果无效。")
        else:
            raise UnsafeYoloWeights("模型包含不支持的 pickle 指令。")
    if last_position != len(data) - 1:
        raise UnsafeYoloWeights("模型 pickle 元数据包含尾随内容。")


def validate_yolo_weights(source) -> None:
    """Inspect bounded pickle metadata without importing/executing its globals.

    Only torch.save's ZIP/protocol-2 checkpoint format is accepted. TorchScript,
    legacy tar/raw pickle, extension opcodes and dynamic globals fail closed.
    Restore the stream for object storage and the subsequent restricted loader.
    """
    position = source.tell()
    try:
        source.seek(0)
        with zipfile.ZipFile(source) as archive:
            members = archive.infolist()
            if not members or len(members) > MAX_ARCHIVE_MEMBERS:
                raise UnsafeYoloWeights("模型归档条目数量无效。")
            names = set()
            metadata = []
            roots = set()
            for member in members:
                path = PurePosixPath(member.filename)
                if (member.filename in names or path.is_absolute() or ".." in path.parts
                        or "\\" in member.filename or len(path.parts) < 2
                        or member.flag_bits & 1 or member.compress_type != zipfile.ZIP_STORED):
                    raise UnsafeYoloWeights("模型归档结构不受支持。")
                names.add(member.filename)
                roots.add(path.parts[0])
                relative = "/".join(path.parts[1:])
                if relative == "data.pkl":
                    metadata.append(member)
                elif not (relative in {"version", "byteorder", ".data/serialization_id", ".format_version", ".storage_alignment"}
                          or (relative.startswith("data/") and relative[5:].isdigit())):
                    raise UnsafeYoloWeights("仅支持标准 YOLO 检测权重，不支持 TorchScript 或附加代码。")
            if len(roots) != 1 or len(metadata) != 1 or metadata[0].file_size > MAX_PICKLE_BYTES:
                raise UnsafeYoloWeights("模型元数据缺失或过大。")
            data = archive.read(metadata[0])
        if not data.startswith(b"\x80\x02"):
            raise UnsafeYoloWeights("仅支持标准 torch.save protocol=2 的 YOLO 检测权重。")
        _validate_pickle(data)
    except UnsafeYoloWeights:
        raise
    except (ValueError, EOFError, IndexError, KeyError, UnicodeError, zipfile.BadZipFile, NotImplementedError) as error:
        raise UnsafeYoloWeights("无法识别 YOLO 权重格式，请上传标准检测模型 .pt 文件。") from error
    finally:
        source.seek(position)


def load_safe_yolo(path, expected_sha256):
    """Load approved detection classes without Ultralytics' unsafe load fallback."""
    import torch
    from packaging.version import Version
    from ultralytics import YOLO
    from ultralytics.cfg import DEFAULT_CFG_DICT
    from ultralytics.nn.tasks import DetectionModel

    # CVE-2025-32434 and CVE-2026-24747 also affected weights_only=True.
    if Version(torch.__version__.split("+")[0]) < Version("2.10.0"):
        raise UnsafeYoloWeights("安全加载 YOLO 权重需要 PyTorch >= 2.10.0，请重建运行镜像。")
    classes = [set, OrderedDict]
    for module, names in TRUSTED_CLASSES.items():
        trusted_module = import_module(module)
        classes.extend(getattr(trusted_module, name) for name in names if hasattr(trusted_module, name))

    with open(path, "rb") as source:
        if hashlib.file_digest(source, "sha256").hexdigest() != expected_sha256:
            raise UnsafeYoloWeights("YOLO 权重 SHA256 校验失败。")
        source.seek(0)
        validate_yolo_weights(source)
        # Runtime startup is single-model; exclude ambient library additions
        # (including PyTorch's nested tensor registrations) from this load.
        with _LOAD_LOCK:
            previous_globals = torch.serialization.get_safe_globals()
            torch.serialization.clear_safe_globals()
            try:
                with torch.serialization.safe_globals(classes):
                    # Never retry unrestricted or auto-allowlist an error.
                    checkpoint = torch.load(source, map_location="cpu", weights_only=True)
            finally:
                torch.serialization.clear_safe_globals()
                torch.serialization.add_safe_globals(previous_globals)
    if type(checkpoint) is not dict:
        raise UnsafeYoloWeights("仅支持包含检测模型的 YOLO checkpoint。")
    candidate = checkpoint.get("ema")
    if candidate is None:
        candidate = checkpoint.get("model")
    if type(candidate) is not DetectionModel:
        raise UnsafeYoloWeights("仅支持标准 Ultralytics DetectionModel 检测权重。")
    # Do not use train_args/yaml from the upload to create a model, import a
    # module, install dependencies, select a task or configure the predictor.
    candidate.args = {**DEFAULT_CFG_DICT, "task": "detect"}
    candidate.task = "detect"
    candidate.pt_path = str(path)
    candidate = candidate.float().eval()
    for module in candidate.modules():
        if hasattr(module, "inplace"):
            module.inplace = True
        if isinstance(module, torch.nn.Upsample) and not hasattr(module, "recompute_scale_factor"):
            module.recompute_scale_factor = None

    class RestrictedYOLO(YOLO):
        def _load(self, weights, task=None):
            self.model = candidate
            self.ckpt = {}
            self.task = "detect"
            self.ckpt_path = str(path)
            self.overrides = {"model": str(path), "task": "detect"}
            self.model_name = str(path)

    return RestrictedYOLO(str(path), task="detect")
