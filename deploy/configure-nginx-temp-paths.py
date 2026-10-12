#!/usr/bin/env python3
"""Use writable worker-owned Nginx spool directories; run with sudo."""
import argparse
from datetime import datetime
import os
from pathlib import Path
import pwd
import re
import shutil
import subprocess


DIRECTORIES = {"client_body_temp_path": "body", "proxy_temp_path": "proxy",
               "fastcgi_temp_path": "fastcgi", "uwsgi_temp_path": "uwsgi", "scgi_temp_path": "scgi"}


def configure(text, root=Path("/var/lib/nginx")):
    lines = text.splitlines(keepends=True)
    starts = [i for i, line in enumerate(lines) if re.fullmatch(r"\s*http\s*\{\s*", line)]
    if len(starts) != 1:
        raise ValueError("需要且只能有一个 http 配置块。")
    start = starts[0]
    depth = 1
    output = lines[:start + 1]
    output += [f"    {directive} {root / folder};\n" for directive, folder in DIRECTORIES.items()]
    for line in lines[start + 1:]:
        code = line.split("#", 1)[0]
        match = re.match(r"\s*(\w+_temp_path)\s+[^;]+;\s*$", code)
        if depth != 1 or match is None or match.group(1) not in DIRECTORIES:
            output.append(line)
        depth += code.count("{") - code.count("}")
    return "".join(output)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=Path("/etc/nginx/nginx.conf"))
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error("请使用 sudo python3 执行。")
    config = args.config.resolve(strict=True)
    original = config.read_text()
    updated = configure(original)
    worker = re.search(r"^[ \t]*user\s+([^\s;]+)(?:\s+[^\s;]+)?\s*;", original, re.MULTILINE)
    if worker is None:
        parser.error("未找到 Nginx worker 的 user 配置。")
    account = pwd.getpwnam(worker.group(1))
    for folder in DIRECTORIES.values():
        directory = Path("/var/lib/nginx") / folder
        directory.mkdir(parents=True, exist_ok=True)
        directory.chmod(0o700)
        os.chown(directory, account.pw_uid, account.pw_gid)
    backup = None
    if updated != original:
        backup = config.with_name(config.name + datetime.now().strftime(".bak-temp-paths-%Y%m%d-%H%M%S-%f"))
        shutil.copy2(config, backup)
        config.write_text(updated)
    try:
        subprocess.run(["nginx", "-t"], check=True)
        subprocess.run(["systemctl", "reload", "nginx"], check=True)
    except (OSError, subprocess.CalledProcessError):
        if backup:
            shutil.copy2(backup, config)
            subprocess.run(["nginx", "-t"], check=False)
            subprocess.run(["systemctl", "reload", "nginx"], check=False)
            print(f"操作失败，已恢复配置；备份：{backup}")
        raise
    print(f"Nginx 通用临时目录已切换到 /var/lib/nginx，所属用户：{account.pw_name}")
    if backup:
        print(f"原配置备份：{backup}")


if __name__ == "__main__":
    main()
