"""Run inside the model image: python -m unittest discover -s /tests -v."""
import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image
import torch
from ultralytics import YOLO

import yolo_weights


class MaliciousReduce:
    def __init__(self, marker):
        self.marker = str(marker)

    def __reduce__(self):
        return exec, (f"open({self.marker!r}, 'w').write('executed')",)


class WeightSecurityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "weights.pt"
        self.marker = Path(self.temp.name) / "executed"

    def digest(self):
        with self.path.open("rb") as source:
            return hashlib.file_digest(source, "sha256").hexdigest()

    def test_standard_yolo11_checkpoint_runs_inference_without_unsafe_loader(self):
        # Bundled architecture, no downloads; the uploaded YAML/train_args must
        # never be evaluated or used to configure the prediction task.
        model = YOLO("yolo11n.yaml", task="detect")
        model.model.custom_shape = torch.Size([1, 2])
        torch.save({"model": model.model, "train_args": {"task": "classify", "data": "/untrusted/data.yaml"}}, self.path)
        original_load = torch.load
        with patch.object(torch, "load", wraps=original_load) as load:
            with patch("ultralytics.nn.tasks.torch_safe_load", side_effect=AssertionError("Unsafe loader used")):
                loaded = yolo_weights.load_safe_yolo(self.path, self.digest())
                predictions = loaded.predict(Image.new("RGB", (64, 64)), imgsz=64, device="cpu", verbose=False)
        self.assertEqual(len(predictions), 1)
        self.assertEqual(loaded.task, "detect")
        self.assertNotEqual(loaded.model.args["data"], "/untrusted/data.yaml")
        self.assertEqual(load.call_count, 1)
        self.assertTrue(load.call_args.kwargs["weights_only"])
        self.assertEqual(load.call_args.kwargs["map_location"], "cpu")

    def test_malicious_reduce_never_executes(self):
        torch.save({"model": MaliciousReduce(self.marker)}, self.path)
        with self.assertRaises(yolo_weights.UnsafeYoloWeights):
            yolo_weights.load_safe_yolo(self.path, self.digest())
        self.assertFalse(self.marker.exists())

    def test_allowlisted_model_class_cannot_be_called_by_reduce(self):
        from ultralytics.nn.tasks import DetectionModel
        marker = self.marker

        class ConstructorReduce:
            def __reduce__(self):
                return DetectionModel, ({"nc": 1, "backbone": [], "head": [],
                    "activation": f"__import__('pathlib').Path({str(marker)!r}).write_text('executed')"},)

        torch.save({"model": ConstructorReduce()}, self.path)
        with self.assertRaisesRegex(yolo_weights.UnsafeYoloWeights, "构造调用"):
            yolo_weights.load_safe_yolo(self.path, self.digest())
        self.assertFalse(self.marker.exists())

    def test_restricted_unpickler_blocks_reduce_even_if_preflight_is_bypassed(self):
        torch.save({"model": MaliciousReduce(self.marker)}, self.path)
        original_load = torch.load
        previous = torch.serialization.get_safe_globals()
        torch.serialization.add_safe_globals([exec])
        try:
            with patch.object(yolo_weights, "validate_yolo_weights", return_value=None):
                with patch.object(torch, "load", wraps=original_load) as load:
                    with self.assertRaises(Exception):
                        yolo_weights.load_safe_yolo(self.path, self.digest())
            self.assertEqual(load.call_count, 1)  # no insecure fallback/retry
            self.assertTrue(load.call_args.kwargs["weights_only"])
            self.assertFalse(self.marker.exists())
        finally:
            torch.serialization.clear_safe_globals()
            torch.serialization.add_safe_globals(previous)

    def test_old_torch_versions_fail_closed(self):
        for version in ("2.5.1", "2.9.1+cu128", "2.10.0rc1"):
            with self.subTest(version=version), patch.object(torch, "__version__", version):
                with self.assertRaisesRegex(yolo_weights.UnsafeYoloWeights, "2.10.0"):
                    yolo_weights.load_safe_yolo(self.path, "unused")

    def test_checksum_mismatch_cannot_load(self):
        torch.save({"model": None}, self.path)
        with patch.object(torch, "load", side_effect=AssertionError("Must not deserialize")):
            with self.assertRaisesRegex(yolo_weights.UnsafeYoloWeights, "SHA256"):
                yolo_weights.load_safe_yolo(self.path, "0" * 64)

    def test_non_detection_checkpoint_is_rejected(self):
        for value in ([], {"model": torch.nn.Linear(2, 2)}, {"state_dict": {"x": torch.ones(2)}}):
            with self.subTest(type=type(value)):
                torch.save(value, self.path)
                with self.assertRaises(yolo_weights.UnsafeYoloWeights):
                    yolo_weights.load_safe_yolo(self.path, self.digest())
