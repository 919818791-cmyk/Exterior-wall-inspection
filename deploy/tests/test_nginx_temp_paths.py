import importlib.util
from pathlib import Path
import re
import unittest


spec = importlib.util.spec_from_file_location(
    "nginx_temp_paths", Path(__file__).resolve().parents[1] / "configure-nginx-temp-paths.py")
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class TempPathTests(unittest.TestCase):
    def test_replaces_existing_http_rules_and_preserves_route_specific_paths(self):
        source = """user www-data;
events {}
http {
    client_body_temp_path /unwritable/client;
    proxy_temp_path /unwritable/proxy 1 2;
    server {
        location /upload {
            client_body_temp_path /private/model-upload;
        }
    }
}
"""
        result = installer.configure(source)
        self.assertNotIn("/unwritable", result)
        self.assertIn("client_body_temp_path /private/model-upload;", result)
        for name, folder in installer.DIRECTORIES.items():
            self.assertEqual(result.count(f"{name} /var/lib/nginx/{folder};"), 1)
        self.assertEqual(installer.configure(result), result)

    def test_missing_or_duplicate_http_blocks_are_rejected(self):
        for source in ("events {}\n", "http {\n}\nhttp {\n}\n"):
            with self.assertRaises(ValueError):
                installer.configure(source)

    def test_default_host_configuration_can_be_repaired_without_duplicate_directives(self):
        source = Path("/etc/nginx/nginx.conf").read_text()
        result = installer.configure(source)
        for name, folder in installer.DIRECTORIES.items():
            self.assertEqual(len(re.findall(rf"^\s*{name}\s+", result, re.MULTILINE)), 1)
        self.assertEqual(installer.configure(result), result)


if __name__ == "__main__":
    unittest.main()
