"""Check the three reported test replacements; this is not an official rescan."""
import ast
import hashlib
import json
from pathlib import Path
import re
from xml.etree import ElementTree
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[2]
REPORT = ROOT / "第三次漏洞.docx"
SOURCE = ROOT / "backend/tests/test_detection_strategies.py"
TEST = "test_local_switch_reflects_process_presence_even_when_health_fails"


def main():
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    with ZipFile(REPORT) as archive:
        document = ElementTree.fromstring(archive.read("word/document.xml"))
    findings = []
    for paragraph in document.findall(".//w:p", ns):
        text = "".join(node.text or "" for node in paragraph.findall(".//w:t", ns))
        match = re.fullmatch(r"序号(\d+): /(.+?)\((\d+)\)", text)
        if match:
            findings.append({"ordinal": int(match[1]), "file": match[2], "original_line": int(match[3])})
    assert [(item["ordinal"], item["file"], item["original_line"]) for item in findings] == [
        (ordinal, "backend/tests/test_detection_strategies.py", line)
        for ordinal, line in ((1, 264), (2, 265), (3, 267))
    ]
    function = next(node for node in ast.parse(SOURCE.read_text()).body
                    if isinstance(node, ast.FunctionDef) and node.name == TEST)
    calls = [node for node in ast.walk(function) if isinstance(node, ast.Call)
             and isinstance(node.func, ast.Attribute) and isinstance(node.func.value, ast.Name)
             and node.func.value.id == "monkeypatch"]
    assert len(calls) == 3 and all(node.func.attr == "setitem" for node in calls)
    assert {ast.literal_eval(node.args[1]) for node in calls} == {"os", "local_model_settings", "local_qwen_status"}
    assert all(isinstance(node.args[0], ast.Attribute) and node.args[0].attr == "__dict__"
               and isinstance(node.args[0].value, ast.Name) and node.args[0].value.id == "models" for node in calls)
    cases = ast.literal_eval(function.decorator_list[0].args[1])
    assert cases == [("running", 123, True), ("starting", 123, True),
                     ("error", 123, True), ("error", None, False), ("stopped", None, False)]
    result = {"report": REPORT.name, "report_sha256": hashlib.sha256(REPORT.read_bytes()).hexdigest(),
              "source_sha256": hashlib.sha256(SOURCE.read_bytes()).hexdigest(), "total": len(findings),
              "category": "对象访问违规", "findings": findings, "source_check_result": "passed",
              "replacement_keys": sorted(ast.literal_eval(node.args[1]) for node in calls),
              "preserved_cases": cases, "official_rescan": "pending"}
    Path(__file__).with_name("findings.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"total": len(findings), "source_check_result": "passed", "preserved_cases": len(cases)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
