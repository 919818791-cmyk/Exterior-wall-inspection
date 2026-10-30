"""Check the real launcher + Docker port mapping using a disposable CPU stub."""
from ipaddress import IPv4Address
import json
import os
from pathlib import Path
import socket
import subprocess
from tempfile import TemporaryDirectory
import time
from urllib.parse import urlunsplit
from urllib.request import build_opener, ProxyHandler
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = Path(__file__).with_name("network-smoke.json")


def docker(*args):
    return subprocess.run(["docker", *args], check=True, capture_output=True, text=True, timeout=30).stdout


def main():
    name = "security-part1-smoke-" + uuid4().hex
    results = {"container_name": name, "gpu_used": False}
    try:
        with TemporaryDirectory(prefix="security-part1-smoke-") as directory:
            stub = Path(directory) / "version_server.py"
            stub.write_text('from fastapi import FastAPI\napp = FastAPI()\n@app.get("/health")\ndef health():\n    return {"ready": True, "test_stub": True}\n')
            docker("run", "-d", "--name", name, "--read-only", "--memory", "256m", "--cpus", "1",
                "--user", str(os.getuid()) + ":" + str(os.getgid()),
                "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--publish", "127.0.0.1::9002",
                "--mount", "type=bind,src=" + str(ROOT / "algorithm-model/serve_version.py") + ",dst=/runtime/serve_version.py,readonly",
                "--mount", "type=bind,src=" + str(stub) + ",dst=/runtime/version_server.py,readonly",
                "--workdir", "/runtime", "--entrypoint", "python",
                "building-exterior-algorithm-model:cuda", "/runtime/serve_version.py")
            deadline = time.monotonic() + 20
            while True:
                info = json.loads(docker("inspect", name))[0]
                ports = info["NetworkSettings"]["Ports"].get("9002/tcp")
                if ports:
                    break
                if not info["State"]["Running"] or time.monotonic() > deadline:
                    raise RuntimeError("Temporary container did not publish its port")
                time.sleep(0.1)
            assert len(ports) == 1 and ports[0]["HostIp"] == "127.0.0.1"
            port = int(ports[0]["HostPort"])
            results["host_mapping"] = ports
            networks = list(info["NetworkSettings"]["Networks"].values())
            assert len(networks) == 1
            results["container_ip"] = networks[0]["IPAddress"]
            url = urlunsplit(("http", "127.0.0.1:" + str(port), "/health", "", ""))
            client = build_opener(ProxyHandler({}))
            deadline = time.monotonic() + 20
            while True:
                try:
                    with client.open(url, timeout=1) as response:
                        health = json.loads(response.read())
                    assert health == {"ready": True, "test_stub": True}
                    results["loopback_health"] = "passed"
                    break
                except OSError:
                    if time.monotonic() > deadline:
                        raise
                    time.sleep(0.1)
            table = docker("exec", name, "python", "-c", "from pathlib import Path; print(Path('/proc/net/tcp').read_text())")
            rows = (line.split() for line in table.splitlines()[1:])
            listeners = [int(fields[1].split(":")[0], 16) for fields in rows
                if len(fields) >= 4 and fields[3] == "0A" and int(fields[1].split(":")[1], 16) == 9002]
            expected = int.from_bytes(IPv4Address(results["container_ip"]).packed, "little")
            assert listeners == [expected] and 0 not in listeners
            results["explicit_interface_listener"] = "passed"
            addresses = json.loads(subprocess.run(["ip", "-j", "address"], check=True, capture_output=True, text=True).stdout)
            probes = []
            for interface in addresses:
                for address in interface.get("addr_info", []):
                    if address["family"] == "inet" and address.get("scope") == "global":
                        ip = address["local"]
                        try:
                            with socket.create_connection((ip, port), timeout=1):
                                raise AssertionError("Published model port accessible on a non-loopback host interface")
                        except OSError:
                            probes.append({"host_interface": ip, "result": "connection rejected"})
            results["host_non_loopback_probes"] = probes
            results["docker_server_version"] = docker("version", "--format", "{{.Server.Version}}").strip()
            results["independent_external_node_probe"] = "not performed"
            results["result"] = "passed"
    except BaseException as error:
        results["error_type"] = type(error).__name__
        results["startup_logs"] = subprocess.run(["docker", "logs", name], capture_output=True, text=True, timeout=30).stderr
        raise
    finally:
        subprocess.run(["docker", "rm", "-f", name], capture_output=True, text=True, timeout=30)
        results["temporary_container_removed"] = not json.loads(docker("ps", "-a", "--filter", "name=" + name, "--format", "json") or "null")
        OUTPUT.write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
