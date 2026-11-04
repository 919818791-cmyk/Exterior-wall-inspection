#!/usr/bin/env python3
"""Align the existing API proxy with supported uploads; run with sudo."""
import argparse
from datetime import datetime
import importlib.util
import os
from pathlib import Path
import re
import shutil
import subprocess

spec = importlib.util.spec_from_file_location(
    "nginx_model_upload", Path(__file__).with_name("configure-nginx-model-upload.py"))
model_upload = importlib.util.module_from_spec(spec)
spec.loader.exec_module(model_upload)

BEGIN = "# BEGIN managed application uploads"
END = "# END managed application uploads"
UPLOAD_ROUTE = r"^/api/projects/[^/]+/(?:building-model|building-model-images)/?$"
API_DIRECTIVES = {"proxy_http_version": "1.1", "proxy_connect_timeout": "30s",
                  "proxy_send_timeout": "900s", "proxy_read_timeout": "900s",
                  "send_timeout": "900s", "client_body_timeout": "300s"}


def configure(text: str) -> str:
    managed = re.compile(re.escape(BEGIN) + r".*?" + re.escape(END), re.DOTALL)
    if BEGIN in text or END in text:
        if text.count(BEGIN) != 1 or text.count(END) != 1 or len(managed.findall(text)) != 1:
            raise ValueError("应用上传配置标记不完整或不唯一。")
    base = managed.sub("", text)
    if re.search(r"\blocation\s+[^\n{]*(?:building-model|trial/(?:generate|results))", base):
        raise ValueError("已有应用上传 location，请先合并，避免代理规则冲突。")
    _, start, end, target = model_upload.api_block(base)
    block = (
        f"{BEGIN}\n"
        "        # GLB: 1 GiB file; building image multipart batches: 1 GiB total.\n"
        f"        location ~ {UPLOAD_ROUTE} {{\n"
        f"            client_max_body_size {1024 ** 3 + 1024 ** 2};\n"
        f"            proxy_pass {target};\n"
        "        }\n"
        f"        {END}"
    )
    # Replace authoritative API-level directives, preserving nested routes and
    # unrelated settings (including credentials in the map proxy).
    _, actual_start, actual_end, _ = model_upload.api_block(text)
    body = text[actual_start:actual_end]
    closing_indent = re.search(r"[ \t]*$", body).group(0)
    if closing_indent:
        body = body[:-len(closing_indent)]
    depth = 1
    output = []
    for line in body.splitlines(keepends=True):
        code = line.split("#", 1)[0]
        match = re.fullmatch(r"\s*(\w+)\s+[^;]+;\s*", code)
        if not (depth == 1 and match and match.group(1) in API_DIRECTIVES):
            output.append(line)
        depth += code.count("{") - code.count("}")
    directives = "".join(f"        {name} {value};\n" for name, value in API_DIRECTIVES.items())
    result = text[:actual_start] + "".join(output) + directives + closing_indent + text[actual_end:]
    if managed.search(result):
        return managed.sub(lambda _: block, result, count=1)
    api, _, _, _ = model_upload.api_block(result)
    return api.sub(lambda match: match.group(1) + "\n        " + block, result, count=1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site", type=Path, default=Path("/etc/nginx/sites-available/building-exterior"))
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error("请使用 sudo python3 执行。")
    site = args.site.resolve(strict=True)
    original = site.read_text()
    updated = configure(original)
    backup = None
    if updated != original:
        backup = site.with_name(site.name + datetime.now().strftime(".bak-app-%Y%m%d-%H%M%S-%f"))
        shutil.copy2(site, backup)
        site.write_text(updated)
    try:
        subprocess.run(["nginx", "-t"], check=True)
        subprocess.run(["systemctl", "reload", "nginx"], check=True)
    except (OSError, subprocess.CalledProcessError):
        if backup:
            shutil.copy2(backup, site)
            subprocess.run(["nginx", "-t"], check=False)
            subprocess.run(["systemctl", "reload", "nginx"], check=False)
            print(f"操作失败，已恢复配置；备份：{backup}")
        raise
    print("GLB 与建筑批量图片上传：1 GiB + 1 MiB 表单开销；API 响应等待：900 秒。")
    print("已明确上游 HTTP 1.1，保留其他接口的站点上传限制及后端校验。")
    if backup:
        print(f"原配置备份：{backup}")


if __name__ == "__main__":
    main()
