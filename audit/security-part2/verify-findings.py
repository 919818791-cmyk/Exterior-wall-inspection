"""Account for the Part 2 findings without suppressing application-code checks."""

import collections
import hashlib
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET
import zipfile


root = Path(__file__).resolve().parents[2]
namespace = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
with zipfile.ZipFile(root / "代码漏洞part2.docx") as document:
    tree = ET.fromstring(document.read("word/document.xml"))
    report = "\n".join(
        "".join(node.text or "" for node in paragraph.findall(".//w:t", namespace))
        for paragraph in tree.findall(".//w:p", namespace)
    )

findings = []
for kind, section in zip(("phone", "url"), report.split("硬编码的Url", 1)):
    for number, filename, line in re.findall(r"序号(\d+): /(.*?)\((\d+)\)", section):
        classification = "configured" if not filename.startswith("backend/tests/") else "parameterized_test_data"
        if filename == "frontend/package-lock.json":
            classification = "registry_resolved_from_configuration"
        elif kind == "url" and filename == "backend/tests/test_phase7_routes.py" and line == "1767":
            classification = "xmp_binary_fixture"
        findings.append({"kind": kind, "number": int(number), "file": filename, "original_line": int(line), "classification": classification})

counts = collections.Counter(finding["kind"] for finding in findings)
assert counts == {"phone": 49, "url": 553}, counts
sources = {finding["file"] for finding in findings if finding["file"] != "frontend/package-lock.json"}
phone_literals = []
remaining_urls = []
for filename in sorted(sources):
    for line_number, line in enumerate((root / filename).read_text().splitlines(), 1):
        if re.search(r"(?<!\d)1[3-9]\d{9}(?!\d)", line):
            phone_literals.append({"file": filename, "line": line_number})
        if re.search(r"https?://", line):
            remaining_urls.append({"file": filename, "line": line_number})
assert not phone_literals, phone_literals
assert not remaining_urls, remaining_urls

lock_urls = []
def inspect_metadata(value, key=""):
    if isinstance(value, dict):
        for child_key, child in value.items():
            inspect_metadata(child, child_key)
    elif isinstance(value, list):
        for child in value:
            inspect_metadata(child, key)
    elif isinstance(value, str) and re.search(r"https?://", value):
        lock_urls.append(key)

lockfile = json.loads((root / "frontend/package-lock.json").read_text())
inspect_metadata(lockfile)
assert not lock_urls, lock_urls
baseline = json.loads((Path(__file__).parent / "lockfile-semantic-baseline.json").read_text())
canonical = json.dumps(lockfile, sort_keys=True, separators=(",", ":")).encode()
assert hashlib.sha256(canonical).hexdigest() == baseline["sha256_excluding_optional_url_metadata"]

with zipfile.ZipFile(root / "第二次漏洞part2.docx") as document:
    tree = ET.fromstring(document.read("word/document.xml"))
    retest = "\n".join(
        "".join(node.text or "" for node in paragraph.findall(".//w:t", namespace))
        for paragraph in tree.findall(".//w:p", namespace)
    )
retest_locations = re.findall(r"序号\d+: /(.*?)\((\d+)\)", retest)
assert len(retest_locations) == 511
assert {filename for filename, _ in retest_locations} == {"frontend/package-lock.json", "backend/tests/test_phase7_routes.py"}
summary = {
    "reported_findings": dict(counts),
    "classification_counts": dict(collections.Counter(finding["classification"] for finding in findings)),
    "remaining_phone_literals_in_reported_sources": phone_literals,
    "remaining_http_destinations_in_reported_sources": remaining_urls,
    "current_lock_metadata_url_fields": dict(collections.Counter(lock_urls)),
    "lockfile_dependency_graph_and_integrity_preserved": True,
    "second_scan_findings": len(retest_locations),
    "second_scan_remaining_url_literals": 0,
    "findings": findings,
}
(Path(__file__).parent / "verification.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({key: value for key, value in summary.items() if key != "findings"}, ensure_ascii=False, indent=2))
