#!/usr/bin/env python3
"""Check Nginx worker permissions as well as syntax, without exposing secrets."""
import os
from pathlib import Path
import re
import subprocess


def main():
    if os.geteuid() != 0:
        raise SystemExit("请使用 sudo python3 执行。")
    result = subprocess.run(["nginx", "-T"], capture_output=True, text=True)
    if result.returncode:
        raise SystemExit(result.stderr)
    worker = re.search(r"^\s*user\s+(\S+?)(?:\s+\S+)?;", result.stdout, re.MULTILINE)
    if not worker:
        raise SystemExit("未找到 Nginx worker 用户。")
    worker = worker.group(1)
    failures = []
    config = result.stdout
    expected = ("client_body_temp_path", "proxy_temp_path", "fastcgi_temp_path",
                "uwsgi_temp_path", "scgi_temp_path")
    global_paths = set()
    depth = 0
    in_http = False
    for line in config.splitlines():
        code = line.split("#", 1)[0]
        if not in_http:
            if re.fullmatch(r"\s*http\s*\{\s*", code):
                in_http, depth = True, 1
            continue
        if depth == 1:
            match = re.match(r"\s*(\w+_temp_path)\s+", code)
            if match:
                global_paths.add(match.group(1))
        depth += code.count("{") - code.count("}")
        if depth == 0:
            break
    for name in expected:
        if name not in global_paths:
            failures.append(f"{name} 未在主配置的 http 层显式配置，将依赖安装包默认目录")
        paths = re.findall(r"^\s*" + name + r"\s+([^;\s]+)", config, re.MULTILINE)
        for path in set(paths):
            for mode in ("-w", "-x"):
                check = subprocess.run(["runuser", "-u", worker, "--", "test", mode, path])
                if check.returncode:
                    failures.append(f"{worker} 无法访问临时目录 {path} ({mode})")
    for root in set(re.findall(r"^\s*root\s+([^;\s]+)\s*;", config, re.MULTILINE)):
        if "$" in root:
            failures.append(f"动态 root 需要人工核对：{root}")
            continue
        if not Path(root).is_dir():
            failures.append(f"站点静态目录不存在：{root}")
            continue
        for mode in ("-r", "-x"):
            check = subprocess.run(["runuser", "-u", worker, "--", "test", mode, root])
            if check.returncode:
                failures.append(f"{worker} 无法访问静态目录 {root} ({mode})")
        # Test the actual worker's access, including every ancestor directory.
        for path in (Path(root), *Path(root).rglob("*")):
            if path.is_file():
                check = subprocess.run(["runuser", "-u", worker, "--", "test", "-r", str(path)])
                if check.returncode:
                    failures.append(f"{worker} 无法读取静态文件 {path}")
    if failures:
        raise SystemExit("\n".join(failures))
    print(f"Nginx 检查通过：配置合法；{worker} 可写全部临时目录、可读全部站点静态文件。")


if __name__ == "__main__":
    main()
