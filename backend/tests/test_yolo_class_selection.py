"""Exercise model HTTP contracts without loading weights or requiring a GPU."""
import importlib.util
from io import BytesIO
import json
from pathlib import Path
import sys
from types import SimpleNamespace

from fastapi.testclient import TestClient
from PIL import Image
import pytest


@pytest.fixture
def model_servers(monkeypatch):
    monkeypatch.setitem(sys.modules, "torch", SimpleNamespace())
    monkeypatch.setitem(sys.modules, "ultralytics", SimpleNamespace(YOLO=object))
    for key in ("YOLO_VERSION_ID", "YOLO_MODEL_ID", "YOLO_VERSION", "YOLO_WEIGHTS_SHA256"):
        monkeypatch.setenv(key, "test-version")
    folder = Path(__file__).resolve().parents[2] / "algorithm-model"
    modules = []
    for name in ("version_server", "server"):
        spec = importlib.util.spec_from_file_location("selection_test_" + name, folder / f"{name}.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        modules.append(module)
    return modules


def tensor(values):
    return SimpleNamespace(cpu=lambda: SimpleNamespace(tolist=lambda: values))


@pytest.fixture
def runtime(model_servers):
    server, _ = model_servers
    calls = []
    # Non-default class order and two training labels for cracks.
    names = {8: "spalling", 3: "crack", 4: "other", 6: "裂缝"}
    result = SimpleNamespace(names=names, boxes=SimpleNamespace(
        xyxy=tensor([[1, 2, 11, 12]] * 4), conf=tensor([.9] * 4), cls=tensor([8, 3, 4, 6])))

    def predict(image, **kwargs):
        calls.append(kwargs)
        # Deliberately ignore classes to exercise the output guard too.
        return [result]

    server.model = SimpleNamespace(names=names, predict=predict)
    content = BytesIO()
    Image.new("RGB", (32, 32)).save(content, format="PNG")
    return SimpleNamespace(server=server, client=TestClient(server.app), calls=calls,
                           result=result, content=content.getvalue())


def request(runtime, models):
    data = {} if models is None else {"models": models}
    return runtime.client.post("/predict", data=data,
                               files={"file": ("wall.png", runtime.content, "image/png")})


@pytest.mark.parametrize("selected", [["crack"], ["裂缝"], ["crack", "crack"]])
def test_multiclass_weight_only_returns_selected_cracks(runtime, selected):
    response = request(runtime, json.dumps(selected))
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["requested_models"] == payload["executed_models"] == ["crack"]
    assert [box["class_id"] for box in payload["detections"]] == [3, 6]
    assert {box["type"] for box in payload["detections"]} == {"crack"}
    assert runtime.calls[0]["classes"] == [3, 6]


def test_class_selection_changes_between_requests(runtime):
    for selected, expected in [(["crack"], [3, 6]), (["spalling"], [8]),
                               (["crack", "spalling"], [8, 3, 6])]:
        response = request(runtime, json.dumps(selected))
        assert response.status_code == 200
        assert [box["class_id"] for box in response.json()["detections"]] == expected
        assert runtime.calls[-1]["classes"] == expected


@pytest.mark.parametrize("names", [{"0": "spalling", "1": "crack"}, ["spalling", "crack"]])
def test_class_ids_are_resolved_from_dict_or_list_names(runtime, names):
    runtime.server.model.names = names
    runtime.result.boxes = SimpleNamespace(xyxy=tensor([[1, 2, 11, 12]]),
                                         conf=tensor([.9]), cls=tensor([1]))
    response = request(runtime, '["crack"]')
    assert response.status_code == 200
    assert runtime.calls[0]["classes"] == [1]
    assert response.json()["detections"][0]["type"] == "crack"


def test_other_detections_do_not_replace_missing_cracks(runtime):
    runtime.result.boxes = SimpleNamespace(xyxy=tensor([[1, 2, 11, 12]]),
                                         conf=tensor([.99]), cls=tensor([8]))
    response = request(runtime, '["crack"]')
    assert response.status_code == 200
    assert response.json()["detections"] == []


def test_deployed_abscision_label_maps_to_spalling(runtime):
    runtime.server.model.names = {0: "crack", 1: "leakage", 2: "abscision", 3: "corrosion", 4: "bulge"}
    runtime.result.boxes = SimpleNamespace(xyxy=tensor([[1, 2, 11, 12]] * 3),
                                         conf=tensor([.9] * 3), cls=tensor([0, 1, 2]))
    response = request(runtime, '["spalling"]')
    assert response.status_code == 200
    assert runtime.calls[0]["classes"] == [2]
    assert [(box["class_id"], box["class_name"], box["type"])
            for box in response.json()["detections"]] == [(2, "abscision", "spalling")]


@pytest.mark.parametrize("models", [None, "", "[]", "crack", '"crack"', "{}", "null",
                                   '[1]', '[""]', '["other"]', '["peeling"]',
                                   '["crack", "peeling"]'])
def test_invalid_or_unavailable_selection_never_runs_all_classes(runtime, models):
    response = request(runtime, models)
    assert response.status_code == 422
    assert runtime.calls == []


def test_runtime_not_ready_has_explicit_error(runtime):
    runtime.server.model = None
    assert request(runtime, '["crack"]').status_code == 503
    assert runtime.calls == []


@pytest.mark.parametrize("class_id,names", [(0, {}), (None, {0: "crack"}),
                                          (0, {0: "other"}), (0, {0: "spalling"})])
def test_legacy_runtime_never_relabels_unknown_or_unselected_boxes(model_servers, class_id, names):
    _, server = model_servers
    box = SimpleNamespace(cls=class_id)
    result = SimpleNamespace(names=names, boxes=[box])
    assert server._result_detections(result, "crack", 0) == []
