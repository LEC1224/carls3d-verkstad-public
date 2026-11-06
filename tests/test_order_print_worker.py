"""Offline worker integration tests: all network and builder calls are mocked."""
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
spec = importlib.util.spec_from_file_location("order_print_worker", SCRIPTS / "order_print_worker.py")
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="carls3d-worker-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.output = self.root / "orders"
        self.order = {"id": 7, "orderNumber": "SP-2026-000007-TEST", "name": "Testkund", "type": "standard",
                      "items": [{"filename": "part.stl", "copies": 2, "material": "PLA", "color": "red"}]}
        self.calls = []
        self.fail_download = False
        self.fail_ack = False
        self.fail_poll = False
        self.jobs = [self.order]
        self.config = {"ORDER_WORKFLOW_URL": "https://example.test/api/order-workflow", "ORDER_WORKFLOW_TOKEN": "test-only-token",
                       "ORDER_PRINT_ROOT": str(self.output)}
        self.start_patch(patch.object(worker, "ROOT", self.root))
        self.start_patch(patch.object(worker, "load_config", return_value=self.config))
        opener = self.start_patch(patch.object(worker.urllib.request, "build_opener"))
        opener.return_value.open.side_effect = self.network
        self.build = self.start_patch(patch.object(worker.subprocess, "run", side_effect=self.build_success))
        self.start_patch(patch.object(worker.logging, "exception"))

    def start_patch(self, patcher):
        result = patcher.start()
        self.addCleanup(patcher.stop)
        return result

    @property
    def staging(self):
        return self.root / "data" / "print-worker" / "7"

    def network(self, request, timeout):
        self.assertEqual(request.get_header("Authorization"), "Bearer test-only-token")
        self.assertEqual(timeout, 120)
        payload = json.loads(request.data) if request.data else None
        self.calls.append((request.full_url, payload))
        if payload:
            if self.fail_ack:
                raise ConnectionError("offline acknowledgment")
            return io.BytesIO(b'{"ok":true}')
        if "?" in request.full_url:
            if self.fail_download:
                raise ConnectionError("offline download")
            return io.BytesIO(b"test mesh bytes")
        if self.fail_poll:
            raise ConnectionError("offline polling")
        return io.BytesIO(json.dumps(self.jobs).encode())

    def build_success(self, command, **kwargs):
        self.assertIsInstance(command, list)
        self.assertNotIn("shell", kwargs)
        project = self.output / "007-Testkund" / "order.3mf"
        project.parent.mkdir(parents=True, exist_ok=True)
        project.write_bytes(b"mock 3mf")
        return subprocess.CompletedProcess(command, 0, json.dumps({"project": str(project)}), "")

    def test_success_downloads_expected_files_and_persists_ack(self):
        worker.run_once()
        self.assertEqual((self.staging / "part.stl").read_bytes(), b"test mesh bytes")
        saved = json.loads((self.staging / "result.json").read_text())
        self.assertEqual(saved["state"], "complete")
        self.assertEqual(saved["id"], 7)
        self.assertEqual(self.calls[-1][1], saved)
        self.build.assert_called_once()

    def test_ack_failure_retries_without_download_or_regeneration(self):
        self.fail_ack = True
        worker.run_once()
        first = (self.staging / "result.json").read_text()
        self.fail_ack = False
        self.calls.clear()
        worker.run_once()
        self.build.assert_called_once()
        self.assertEqual(len(self.calls), 2)  # Poll, then saved acknowledgment.
        self.assertEqual(self.calls[-1][1], json.loads(first))
        self.assertEqual((self.staging / "result.json").read_text(), first)

    def test_offline_download_remains_pending_and_next_run_recovers(self):
        self.fail_download = True
        worker.run_once()
        self.assertFalse((self.staging / "result.json").exists())
        self.build.assert_not_called()
        self.fail_download = False
        worker.run_once()
        self.assertEqual(json.loads((self.staging / "result.json").read_text())["state"], "complete")

    def test_poll_failure_does_not_run_builder_or_write_result(self):
        self.fail_poll = True
        with self.assertRaises(ConnectionError):
            worker.run_once()
        self.build.assert_not_called()
        self.assertFalse((self.staging / "result.json").exists())

    def test_failed_generation_preserves_existing_customer_folder(self):
        existing = self.output / "007-Testkund"
        existing.mkdir(parents=True)
        (existing / "order.json").write_text("user-edited manifest")
        (existing / "hand-edited.3mf").write_bytes(b"preserve")
        self.build.side_effect = None
        self.build.return_value = subprocess.CompletedProcess([], 1, "", "unsupported model")
        worker.run_once()
        self.assertEqual((existing / "order.json").read_text(), "user-edited manifest")
        self.assertEqual((existing / "hand-edited.3mf").read_bytes(), b"preserve")
        saved = json.loads((self.staging / "result.json").read_text())
        self.assertEqual(saved["state"], "review")
        review = Path(saved["output"])
        self.assertEqual(review, self.staging / "review")
        self.assertTrue((review / "REVIEW.txt").is_file())
        self.assertTrue((review / "part.stl").is_file())

    def test_download_path_traversal_is_rejected(self):
        self.order["items"][0]["filename"] = "../escaped.stl"
        worker.run_once()
        self.build.assert_not_called()
        self.assertFalse((self.staging.parent / "escaped.stl").exists())
        self.assertEqual(len(self.calls), 1)
        self.assertFalse((self.staging / "result.json").exists())

    def test_missing_project_is_not_acknowledged_as_complete(self):
        self.build.side_effect = None
        self.build.return_value = subprocess.CompletedProcess([], 0, json.dumps({"project": str(self.output / "missing.3mf")}), "")
        worker.run_once()
        self.assertFalse((self.staging / "result.json").exists())
        self.assertTrue(all(payload is None for _, payload in self.calls))

    def test_https_is_required_before_credentials_are_used(self):
        self.config["ORDER_WORKFLOW_URL"] = "http://example.test/api/order-workflow"
        with self.assertRaisesRegex(ValueError, "HTTPS"):
            worker.run_once()
        self.assertEqual(self.calls, [])
        self.build.assert_not_called()


if __name__ == "__main__":
    unittest.main()
