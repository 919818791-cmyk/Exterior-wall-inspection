import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location(
    "nginx_model_upload", Path(__file__).resolve().parents[1] / "configure-nginx-model-upload.py",
)
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class Backend(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200 if self.path.startswith("/api/yolo-models") else 404)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_POST(self):
        remaining = int(self.headers["Content-Length"])
        while remaining:
            chunk = self.rfile.read(min(remaining, 1024 * 1024))
            if not chunk:
                return
            remaining -= len(chunk)
        self.send_response(201)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, *args):
        pass


@unittest.skipUnless(shutil.which("nginx"), "Nginx is required for proxy regression tests")
class ModelUploadProxyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder = tempfile.TemporaryDirectory(prefix="model-upload-proxy-test-")
        cls.addClassCleanup(cls.folder.cleanup)
        root = Path(cls.folder.name)
        cls.backend = ThreadingHTTPServer(("127.0.0.1", 0), Backend)
        cls.addClassCleanup(cls.backend.server_close)
        threading.Thread(target=cls.backend.serve_forever, daemon=True).start()
        cls.addClassCleanup(cls.backend.shutdown)
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            cls.port = listener.getsockname()[1]
        cls.source = f"""pid {root}/nginx.pid;
error_log {root}/error.log;
events {{ worker_connections 32; }}
http {{
    access_log off;
    client_body_temp_path {root}/body;
    proxy_temp_path {root}/proxy;
    fastcgi_temp_path {root}/fastcgi;
    uwsgi_temp_path {root}/uwsgi;
    scgi_temp_path {root}/scgi;
    server {{
        listen 127.0.0.1:{cls.port};
        client_max_body_size 50M;
        location /api/ {{
            proxy_pass http://127.0.0.1:{cls.backend.server_port};
            proxy_set_header Host $host;
        }}
    }}
}}
"""
        patcher = patch.object(installer, "CLIENT_BODY_TEMP_PATH", root / "upload-body")
        patcher.start()
        cls.addClassCleanup(patcher.stop)
        cls.updated = installer.configure(cls.source, 1024 ** 3)
        config = root / "nginx.conf"
        config.write_text(cls.updated)
        command = [shutil.which("nginx"), "-e", str(root / "startup.log"), "-p", str(root) + "/", "-c", str(config)]
        subprocess.run([*command, "-t"], check=True, capture_output=True)
        cls.process = subprocess.Popen([*command, "-g", "daemon off;"])
        cls.addClassCleanup(cls.stop_nginx)
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            try:
                with socket.create_connection(("127.0.0.1", cls.port), timeout=0.1):
                    return
            except OSError:
                time.sleep(0.05)
        raise RuntimeError("Test Nginx failed to start")

    @classmethod
    def stop_nginx(cls):
        cls.process.terminate()
        cls.process.wait(timeout=5)

    def request(self, method, path, size=0, send_body=False):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        self.addCleanup(connection.close)
        connection.putrequest(method, path)
        connection.putheader("Content-Length", str(size))
        connection.endheaders()
        if send_body:
            chunk = b"0" * (1024 * 1024)
            remaining = size
            while remaining:
                part = chunk[:min(remaining, len(chunk))]
                connection.send(part)
                remaining -= len(part)
        response = connection.getresponse()
        response.read()
        return response.status

    def test_catalog_has_no_automatic_slash_redirect(self):
        for path in ("/api/yolo-models", "/api/yolo-models?test=1"):
            with self.subTest(path=path):
                self.assertEqual(self.request("GET", path), 200)

    def test_large_model_upload_reaches_backend(self):
        self.assertEqual(self.request("POST", "/api/yolo-models/test-model/versions", 136720634, True), 201)

    def test_upload_limits_remain_scoped(self):
        self.assertEqual(self.request("POST", "/api/photos", 136720634), 413)
        self.assertEqual(self.request("POST", "/api/yolo-models/test-model/versions", 1074790401), 413)

    def test_updates_replace_old_prefix_and_are_idempotent(self):
        old = self.updated.replace("location ~ ^/api/yolo-models/[^/]+/versions/?$", "location /api/yolo-models/")
        self.assertEqual(installer.configure(old, 1024 ** 3), self.updated)
        self.assertEqual(installer.configure(self.updated, 1024 ** 3), self.updated)


if __name__ == "__main__":
    unittest.main()
