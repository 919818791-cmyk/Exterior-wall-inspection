#!/usr/bin/env python3
"""Replace public AMap forwarding with the authenticated backend gateway."""
import argparse
from datetime import datetime
import importlib.util
import os
from pathlib import Path
import re
import shutil
import subprocess

spec = importlib.util.spec_from_file_location("nginx_api_block", Path(__file__).with_name("configure-nginx-model-upload.py"))
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
BEGIN = "# BEGIN authenticated AMap gateway"
END = "# END authenticated AMap gateway"


def configure(text: str) -> str:
    managed = re.compile(r"^[ \t]*" + re.escape(BEGIN) + r".*?" + re.escape(END) + r"\n?", re.S | re.M)
    if BEGIN in text or END in text:
        if text.count(BEGIN) != 1 or text.count(END) != 1 or len(managed.findall(text)) != 1:
            raise ValueError("高德配置标记不完整。")
    text = managed.sub("", text)
    # Remove all legacy map locations, including the more specific style proxy.
    locations = re.compile(r"^[ \t]*location\s+[^\n{]*(?:/_AMapService|/api/maps/session)[^\n{]*\{", re.M)
    while match := locations.search(text):
        start, index, depth = match.start(), match.end(), 1
        quote = None
        comment = False
        escaped = False
        while index < len(text) and depth:
            char = text[index]
            if comment:
                comment = char != "\n"
            elif escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif quote:
                if char == quote:
                    quote = None
            elif char in "\"'":
                quote = char
            elif char == "#":
                comment = True
            elif char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
            index += 1
        if depth:
            raise ValueError("高德 location 未闭合。")
        text = text[:start] + text[index:]
    if "_AMapService" in text or re.search(r"(?i)jscode\s*=", text):
        raise ValueError("仍存在未识别的旧高德配置，请手动合并，禁止保留直通上游规则。")
    api, _, _, target = helper.api_block(text)
    blocks = [BEGIN]
    for location in ("^~ /_AMapService", "= /api/maps/session"):
        blocks.append(f'''        location {location} {{
            proxy_pass {target};
            proxy_set_header Host $http_host;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header X-Forwarded-For $remote_addr;
            proxy_http_version 1.1;
            proxy_read_timeout 15s;
            proxy_cache off;
            proxy_hide_header Access-Control-Allow-Origin;
            proxy_hide_header Access-Control-Allow-Credentials;
            proxy_hide_header Access-Control-Allow-Methods;
            proxy_hide_header Access-Control-Allow-Headers;
            add_header Cache-Control "private, no-store" always;
            add_header X-Content-Type-Options nosniff always;
            add_header Cross-Origin-Resource-Policy same-origin always;
            # SDK query strings may contain the public Web Key. Do not log them.
            access_log off;
            error_log /var/log/nginx/amap-error.log crit;
        }}''')
    blocks.append("        " + END)
    return api.sub(lambda match: "\n        ".join(blocks) + "\n" + match.group(0), text, count=1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site", type=Path, default=Path("/etc/nginx/sites-available/building-exterior"))
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error("请使用 sudo python3 执行。")
    site = args.site.resolve(strict=True)
    original = site.read_text()
    updated = configure(original)
    backup = site.with_name(site.name + datetime.now().strftime(".bak-amap-%Y%m%d-%H%M%S-%f"))
    shutil.copy2(site, backup)
    backup.chmod(0o600)
    site.write_text(updated)
    try:
        subprocess.run(["nginx", "-t"], check=True)
        subprocess.run(["systemctl", "reload", "nginx"], check=True)
    except (OSError, subprocess.CalledProcessError):
        shutil.copy2(backup, site)
        subprocess.run(["nginx", "-t"], check=False)
        subprocess.run(["systemctl", "reload", "nginx"], check=False)
        raise
    print(f"高德请求已改为后端鉴权代理。原配置备份（含旧密钥，请限制访问）：{backup}")


if __name__ == "__main__":
    main()
