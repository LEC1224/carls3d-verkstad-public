"""Run with python -m unittest discover -s tests -p test_order_3mf.py.

The integration test runs the real installed Bambu CLI without printing.
"""
import importlib.util
import json
import os
from pathlib import Path
import struct
import tempfile
import unittest
import xml.etree.ElementTree as ET
import zipfile

REPO = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("order_3mf", REPO / "scripts/build_order_3mf.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


def cube_stl(filename, size):
    points = [(0, 0, 0), (size, 0, 0), (size, size, 0), (0, size, 0),
              (0, 0, size), (size, 0, size), (size, size, size), (0, size, size)]
    faces = [(0, 2, 1), (0, 3, 2), (4, 5, 6), (4, 6, 7), (0, 1, 5), (0, 5, 4),
             (1, 2, 6), (1, 6, 5), (2, 3, 7), (2, 7, 6), (3, 0, 4), (3, 4, 7)]
    with Path(filename).open("wb") as stream:
        stream.write(b"Order automation test".ljust(80, b"\0"))
        stream.write(struct.pack("<I", len(faces)))
        for face in faces:
            coords = [coordinate for index in face for coordinate in points[index]]
            a, b, c = [points[index] for index in face]
            u, v = [b[i] - a[i] for i in range(3)], [c[i] - a[i] for i in range(3)]
            normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
            length = sum(n * n for n in normal) ** 0.5
            stream.write(struct.pack("<12fH", *(n / length for n in normal), *coords, 0))


class InputAndLayoutTests(unittest.TestCase):
    def test_order_folder_names_cannot_escape_root(self):
        name = builder.order_folder_name({"id": 24, "name": '../../Namn: Åsa\\test'})
        self.assertTrue(name.startswith("024-"))
        self.assertNotIn("/", name)
        self.assertNotIn("\\", name)
        self.assertNotIn(":", name)
        self.assertIn("Åsa", name)

    def test_upload_path_traversal_and_nonmesh_are_rejected(self):
        with tempfile.TemporaryDirectory(prefix="order3mf-test-") as temp:
            root = Path(temp)
            (root / "photo.png").write_bytes(b"photo")
            for filename in ("../secret.stl", r"..\secret.stl", "C:secret.stl", "photo.png"):
                with self.subTest(filename=filename), self.assertRaises(builder.PackageError):
                    builder.trusted_source(root, filename)

    def test_layout_keeps_materials_separate_and_copies_nonoverlapping(self):
        items = [{"filename": "a.stl", "copies": 9, "filament": 1, "mesh": {"dimensions": (80, 80, 80)}},
                 {"filename": "b.stl", "copies": 3, "filament": 2, "mesh": {"dimensions": (10, 10, 10)}}]
        plates = builder.pack_plates(items)
        self.assertEqual(sum(len(p["instances"]) for p in plates), 12)
        for plate in plates:
            rectangles = []
            for placement in plate["instances"]:
                item = items[placement["item"]]
                self.assertEqual(item["filament"], plate["filament"])
                width, height, _ = item["mesh"]["dimensions"]
                x, y = placement["x"], placement["y"]
                self.assertGreaterEqual(x, 5)
                self.assertGreaterEqual(y, 5)
                self.assertLessEqual(x + width, 251)
                self.assertLessEqual(y + height, 251)
                self.assertTrue(x >= 23 or y >= 33)
                rect = (x, y, x + width, y + height)
                for other in rectangles:
                    self.assertTrue(rect[2] <= other[0] or other[2] <= rect[0] or rect[3] <= other[1] or other[3] <= rect[1])
                rectangles.append(rect)

    def test_oversized_parts_are_never_silently_scaled(self):
        with self.assertRaises(builder.PackageError):
            builder.pack_plates([{"filename": "large.stl", "copies": 1, "filament": 1, "mesh": {"dimensions": (260, 20, 20)}}])


@unittest.skipUnless(builder.DEFAULT_BAMBU.is_file(), "Bambu Studio CLI is not installed")
class BambuIntegrationTests(unittest.TestCase):
    def test_native_export_quantities_filaments_overrides_and_idempotency(self):
        with tempfile.TemporaryDirectory(prefix="order3mf-integration-") as temp:
            root = Path(temp)
            uploads = root / "uploads"
            uploads.mkdir()
            cube_stl(uploads / "functional.stl", 10)
            cube_stl(uploads / "large.stl", 80)
            cube_stl(uploads / "flexible.stl", 15)
            manifest = {"id": 42, "orderNumber": "TEST-42", "name": "Åsa Test", "type": "standard", "items": [
                {"filename": "functional.stl", "material": "PLA", "color": "red", "copies": 3, "purpose": "functional"},
                {"filename": "large.stl", "material": "PETG", "color": "blue", "copies": 9},
                {"filename": "flexible.stl", "material": "TPU", "color": "white", "copies": 2, "supports": False},
            ]}
            result = builder.build_package(manifest, uploads, root / "orders", repo=REPO)
            self.assertEqual(result["copies"], 14)
            self.assertEqual(result["plates"], 5)
            project = Path(result["project"])
            with zipfile.ZipFile(project) as archive:
                settings = json.loads(archive.read("Metadata/project_settings.config"))
                model = ET.fromstring(archive.read("3D/3dmodel.model"))
                config = ET.fromstring(archive.read("Metadata/model_settings.config"))
                self.assertEqual(settings["printer_model"], "Bambu Lab P1S")
                self.assertEqual(settings["nozzle_diameter"], ["0.4"])
                self.assertEqual(settings["filament_type"], ["PLA", "PETG", "TPU"])
                self.assertEqual(settings["filament_colour"], ["#EF4444", "#3B82F6", "#FFFFFF"])
                self.assertEqual(settings["sparse_infill_pattern"], "gyroid")
                self.assertEqual(len(model.findall("{%s}build/{%s}item" % (builder.CORE, builder.CORE))), 14)
                objects = [{m.attrib.get("key"): m.attrib.get("value") for m in obj.findall("metadata")} for obj in config.findall("object")]
                functional = next(obj for obj in objects if obj["name"] == "functional.stl")
                self.assertEqual(functional["wall_loops"], "4")
                self.assertEqual(functional["sparse_infill_density"], "25%")
                flexible = next(obj for obj in objects if obj["name"] == "flexible.stl")
                self.assertEqual(flexible["enable_support"], "0")
            digest = builder.sha256(project)
            second = builder.build_package(manifest, uploads, root / "orders", repo=REPO)
            self.assertTrue(second["alreadyExists"])
            self.assertEqual(digest, builder.sha256(project))
            manifest["items"][0]["copies"] = 4
            with self.assertRaises(builder.PackageError):
                builder.build_package(manifest, uploads, root / "orders", repo=REPO)
            self.assertEqual(digest, builder.sha256(project))


if __name__ == "__main__":
    unittest.main()
