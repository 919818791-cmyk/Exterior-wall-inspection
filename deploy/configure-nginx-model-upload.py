#!/usr/bin/env python3
"""Allow YOLO uploads through the existing API proxy; run with sudo."""

import argparse
from datetime import datetime
import os
from pathlib import Path
import pwd
import re
import shutil
import subprocess


BEGIN = "# BEGIN managed YOLO model upload"
END = "# END managed YOLO model upload"
CLIENT_BODY_TEMP_PATH = Path("/var/lib/nginx/yolo-model-upload-body")


def api_block(text: str):
    api = re.compile(r"^([ \t]*location\s+(?:\^~\s+)?/api/\s*\{)[ \t]*$", re.MULTILINE)
    matches = list(api.finditer(text))
    if len(matches) != 1:
        raise ValueError("需要且只能有一个 location /api/ 代理块，请检查指定的站点配置。")
    start = matches[0].end()
    depth, end = 1, start
    while depth and end < len(text):
        depth += (text[end] == "{") - (text[end] == "}")
        end += 1
    if depth:
        raise ValueError("API 配置块未闭合。")
    targets = []
    depth = 1
    for line in text[start:end - 1].splitlines():
        code = line.split("#", 1)[0]
        match = re.fullmatch(r"\s*proxy_pass\s+(https?://[^/\s;]+)\s*;\s*", code)
        if depth == 1 and match:
            targets.append(match.group(1))
        depth += code.count("{") - code.count("}")
    if len(targets) != 1:
        raise ValueError("API 块需要唯一且不带 URI 路径的 proxy_pass，请手动检查配置。")
    return api, start, end - 1, targets[0]


def configure(text: str, max_upload_bytes: int) -> str:
    managed = re.compile(re.escape(BEGIN) + r".*?" + re.escape(END), re.DOTALL)
    if BEGIN in text or END in text:
        if text.count(BEGIN) != 1 or text.count(END) != 1 or len(managed.findall(text)) != 1:
            raise ValueError("模型上传配置标记不完整或不唯一，请检查站点配置。")
    base = managed.sub("", text)
    if re.search(r"\blocation\s+[^\n{]*?/api/yolo-models", base):
        raise ValueError("已有模型接口 location，请直接调整其 client_max_body_size，避免重复配置。")
    api, _, _, target = api_block(base)
    # The application limit covers the file; Nginx counts the multipart envelope too.
    request_limit = max_upload_bytes + 1024 * 1024
    block = (
        f"{BEGIN}\n"
        # A proxy prefix ending in '/' automatically redirects its bare path.
        # Restrict this regex to uploads so /api/yolo-models stays on the API proxy.
        "        location ~ ^/api/yolo-models/[^/]+/versions/?$ {\n"
        f"            client_max_body_size {request_limit};\n"
        f"            client_body_temp_path {CLIENT_BODY_TEMP_PATH};\n"
        "            proxy_read_timeout 300s;\n"
        f"            proxy_pass {target};\n"
        "        }\n"
        f"        {END}"
    )
    if managed.search(text):
        return managed.sub(lambda _: block, text, count=1)
    # Inherit headers, but explicitly install the proxy content handler.
    return api.sub(lambda match: match.group(1) + "\n        " + block, text, count=1)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site", type=Path, default=Path("/etc/nginx/sites-available/building-exterior"))
    parser.add_argument("--max-upload-bytes", type=int, default=1024 ** 3,
                        help="与后端 YOLO_MODEL_MAX_UPLOAD_BYTES 一致，默认 1 GiB")
    args = parser.parse_args()
    if args.max_upload_bytes < 1:
        parser.error("--max-upload-bytes 必须为正整数")
    if os.geteuid() != 0:
        parser.error("请使用 sudo python3 执行，以修改配置并重载 Nginx。")

    site = args.site.resolve(strict=True)
    original = site.read_text()
    updated = configure(original, args.max_upload_bytes)
    # The installed Nginx build may default to an inaccessible /var/cache/nginx
    # directory. Give this upload route its own spool directory, owned by the
    # configured worker account, rather than changing shared cache permissions.
    nginx_config = Path("/etc/nginx/nginx.conf").read_text()
    worker = re.search(r"^[ \t]*user\s+([^\s;]+)(?:\s+[^\s;]+)?\s*;", nginx_config, re.MULTILINE)
    if worker is None:
        parser.error("/etc/nginx/nginx.conf 中未找到 user 配置，请先明确 Nginx worker 用户。")
    account = pwd.getpwnam(worker.group(1))
    CLIENT_BODY_TEMP_PATH.mkdir(parents=True, exist_ok=True)
    CLIENT_BODY_TEMP_PATH.chmod(0o700)
    os.chown(CLIENT_BODY_TEMP_PATH, account.pw_uid, account.pw_gid)
    backup = None
    if updated != original:
        backup = site.with_name(site.name + datetime.now().strftime(".bak-%Y%m%d-%H%M%S-%f"))
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
            print(f"操作失败，已恢复原配置；备份：{backup}")
        raise
    print(f"模型接口上传限制已生效：文件 {args.max_upload_bytes} 字节，另预留 1 MiB 表单开销。")
    print(f"上传临时目录：{CLIENT_BODY_TEMP_PATH}，所属用户：{account.pw_name}")
    if backup:
        print(f"原配置备份：{backup}")


if __name__ == "__main__":
    main()
