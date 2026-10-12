import http.client
import importlib.util
from pathlib import Path
import time
import unittest

import test_nginx_model_upload as fixture

spec = importlib.util.spec_from_file_location(
    "nginx_app", Path(__file__).resolve().parents[1] / "configure-nginx-app.py")
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class AppBackend(fixture.Backend):
    do_PUT = fixture.Backend.do_POST

    def do_GET(self):
        if self.path == "/api/slow":
            time.sleep(0.3)
        elif self.path == "/api/buffered":
            body = b"b" * (4 * 1024 * 1024)
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        elif self.path == "/api/stream":
            self.send_response(200)
            self.send_header("X-Accel-Buffering", "no")
            self.send_header("Content-Length", "2")
            self.end_headers()
            self.wfile.write(b"a")
            self.wfile.flush()
            time.sleep(0.6)
            self.wfile.write(b"b")
            return
        elif self.path == "/api/backend-error":
            self.send_response(422)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", "2")
            self.end_headers()
            self.wfile.write(b"{}")
            return
        self.send_response(200)
        self.send_header("Content-Length", "0")
        self.end_headers()


class ApplicationProxyTests(fixture.ModelUploadProxyTests):
    @classmethod
    def setUpClass(cls):
        # Reuse the real Nginx fixture with the application's additional policy.
        from unittest.mock import patch
        old_configure = fixture.installer.configure
        with patch.object(fixture, "Backend", AppBackend), patch.object(
            fixture.installer, "configure", side_effect=lambda text, limit: installer.configure(old_configure(text, limit))
        ):
            super().setUpClass()

    def test_building_model_upload_above_old_site_limit(self):
        self.assertEqual(self.request("PUT", "/api/projects/test-project/building-model", 110 * 1024 ** 2, True), 201)

    def test_batch_upload_limits_are_scoped(self):
        for path in ("/api/projects/p/building-model-images",):
            with self.subTest(path=path):
                self.assertEqual(self.request("PUT", path, 55 * 1024 ** 2, True), 201)
                self.assertEqual(self.request("PUT", path, 1024 ** 3 + 1024 ** 2 + 1), 413)
        self.assertEqual(self.request("POST", "/api/trial/generate", 110 * 1024 ** 2), 413)

    def test_slow_and_buffered_backend_responses(self):
        self.assertEqual(self.request("GET", "/api/slow"), 200)
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        self.addCleanup(connection.close)
        connection.request("GET", "/api/buffered")
        response = connection.getresponse()
        self.assertEqual(response.status, 200)
        self.assertEqual(response.read(), b"b" * (4 * 1024 * 1024))

    def test_streaming_is_not_delayed_by_proxy_buffering(self):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        self.addCleanup(connection.close)
        connection.request("GET", "/api/stream")
        start = time.monotonic()
        response = connection.getresponse()
        self.assertEqual(response.read(1), b"a")
        self.assertLess(time.monotonic() - start, 0.5)
        self.assertEqual(response.read(), b"b")

    def test_backend_errors_are_preserved(self):
        self.assertEqual(self.request("GET", "/api/backend-error"), 422)

    def test_updates_replace_old_prefix_and_are_idempotent(self):
        self.assertEqual(installer.configure(self.updated), self.updated)
        self.assertEqual(fixture.installer.configure(self.updated, 1024 ** 3), self.updated)
        self.assertEqual(self.updated.count("proxy_read_timeout 900s;"), 1)
        changed = self.updated.replace("proxy_read_timeout 900s;", "proxy_read_timeout 60s;")
        self.assertEqual(installer.configure(changed), self.updated)


class InvalidConfigTests(unittest.TestCase):
    def test_conflicting_location_is_refused(self):
        with self.assertRaises(ValueError):
            installer.configure("location /api/projects/p/building-model {\n}\n")


if __name__ == "__main__":
    unittest.main()
