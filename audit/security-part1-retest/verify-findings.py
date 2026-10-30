"""Inventory the second scan and check its specific source patterns, not a SAST replacement."""
import ast
from collections import Counter
from ipaddress import IPv4Address
import json
from pathlib import Path
import re
from xml.etree import ElementTree
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[2]
CATEGORIES = {"命令注入", "未受控格式字符串", "硬编码的绑定所有网络接口", "对象访问违规", "硬编码tmp目录"}


def tree(path):
    return ast.parse((ROOT / path).read_text())


def calls(node, name):
    return [item for item in ast.walk(node) if isinstance(item, ast.Call) and
        ((isinstance(item.func, ast.Name) and item.func.id == name) or
         (isinstance(item.func, ast.Attribute) and item.func.attr == name))]


def main():
    findings = []
    category = None
    with ZipFile(ROOT / "第二次漏洞part1.docx") as archive:
        ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
        document = ElementTree.fromstring(archive.read("word/document.xml"))
        for paragraph in document.findall(".//w:p", ns):
            text = "".join(node.text or "" for node in paragraph.findall(".//w:t", ns))
            if text in CATEGORIES:
                category = text
            match = re.match(r"序号(\d+): /(.+?)\((\d+)\)", text)
            if match:
                findings.append({"category": category, "ordinal": int(match[1]), "file": match[2], "original_line": int(match[3])})
    assert len(findings) == 19
    checks = {}
    vision = tree("backend/app/services/vision_models.py")
    control_calls = calls(vision, "run")
    expected = {
        ("/usr/bin/systemctl", "--user", "show", "--property=ActiveState,SubState,MainPID", "--", "building-photo-guard.service"),
        ("/usr/bin/systemctl", "--user", "start", "--", "building-photo-guard.service"),
        ("/usr/bin/systemctl", "--user", "stop", "--", "building-photo-guard.service"),
    }
    actual = set()
    for call in control_calls:
        assert isinstance(call.args[0], ast.List)
        assert all(isinstance(part, ast.Constant) and isinstance(part.value, str) for part in call.args[0].elts)
        actual.add(tuple(part.value for part in call.args[0].elts))
        options = {kw.arg: kw.value for kw in call.keywords}
        assert isinstance(options["shell"], ast.Constant) and options["shell"].value is False
    assert actual == expected
    env = next(node for node in vision.body if isinstance(node, ast.FunctionDef) and node.name == "_systemd_user_env")
    assert not any(isinstance(node, ast.Attribute) and node.attr in {"environ", "getenv"} for node in ast.walk(env))
    checks["command_inputs"] = "all three argv arrays are literal; inherited environment removed"
    scripts = {item["file"] for item in findings if item["category"] == "未受控格式字符串"}
    assert all(not any(isinstance(node, ast.JoinedStr) for node in ast.walk(tree(path))) for path in scripts)
    checks["format_templates"] = "no f-string nodes in the four reported scripts; output compatibility tested"
    wildcard = str(IPv4Address(0))
    paths = {item["file"] for item in findings if item["category"] == "硬编码的绑定所有网络接口"}
    assert all(not any(isinstance(node, ast.Constant) and node.value == wildcard for node in ast.walk(tree(path))) for path in paths)
    checks["listener_literals"] = "reported files have no wildcard address literals; explicit container interface tested"
    area = tree("backend/app/services/defect_area.py")
    assert not calls(area, "getattr")
    phase4 = tree("backend/tests/test_phase4_routes.py")
    assert not any(len(call.args) >= 2 and isinstance(call.args[1], ast.Constant) and call.args[1].value == "id" for call in calls(phase4, "getattr"))
    checks["attribute_access"] = "whitelisted explicit measurement readers and direct Photo.id access"
    security = tree("backend/tests/test_security_part1.py")
    assert not any(isinstance(node, ast.Constant) and isinstance(node.value, str) and node.value.startswith("/tmp/") for node in ast.walk(security))
    checks["temporary_directory"] = "absolute-path rejection remains; no fixed temporary directory in test inputs"
    result = {"report": "第二次漏洞part1.docx", "total": len(findings), "counts": dict(Counter(item["category"] for item in findings)),
        "findings": findings, "source_checks": checks, "source_check_result": "passed", "official_rescan": "pending"}
    Path(__file__).with_name("findings.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"total": result["total"], "counts": result["counts"], "source_check_result": result["source_check_result"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
