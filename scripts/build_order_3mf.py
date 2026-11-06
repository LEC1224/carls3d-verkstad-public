"""Build a reviewable Bambu Studio P1S project from a trusted order manifest.

Uses only Python's standard library and the installed Bambu Studio CLI. No
printer is contacted and no G-code is executed. Every input is auto-oriented
by Bambu Studio, then packed into plates grouped by material and colour.
"""
import argparse
import hashlib
import itertools
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile

VERSION = 1
CORE = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
PROD = "http://schemas.microsoft.com/3dmanufacturing/production/2015/06"
IDENTITY = (1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0)
MACHINE = "Bambu Lab P1S 0.4 nozzle"
PROCESS = "0.20mm Standard @BBL X1C"
DEFAULT_OUTPUT = Path(r"D:\Documents\3D-prints\Beställningar")
DEFAULT_BAMBU = Path(r"C:\Program Files\Bambu Studio\bambu-studio.exe")
MAX_COPIES = 500
MAX_PLATES = 36
MAX_FILE_BYTES = 100 * 1024 * 1024


class PackageError(ValueError):
    pass


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def write_json(path, data):
    Path(path).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def safe_name(value, limit=90):
    value = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", str(value))
    value = re.sub(r"\s+", " ", value).strip(" .")[:limit].rstrip(" .")
    if not value or value in (".", ".."):
        return "Kund"
    if re.fullmatch(r"(?i)(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?", value):
        value = "_" + value
    return value


def order_folder_name(order):
    order_id = order.get("id")
    if isinstance(order_id, bool) or not isinstance(order_id, int) or order_id < 1:
        raise PackageError("A positive numeric order id is required")
    return "%03d-%s" % (order_id, safe_name(order.get("name", "Kund")))


def trusted_source(uploads, filename):
    # Order metadata must never select arbitrary files or paths on the host.
    if not filename or Path(filename).name != filename or any(c in filename for c in ("/", "\\", ":")):
        raise PackageError("Invalid uploaded filename")
    root = Path(uploads).resolve(strict=True)
    source = (root / filename).resolve(strict=True)
    if source.parent != root or not source.is_file():
        raise PackageError("Source file is outside the upload directory")
    if source.suffix.lower() not in (".stl", ".obj"):
        raise PackageError("A printable STL/OBJ source is required: " + filename)
    if not 0 < source.stat().st_size <= MAX_FILE_BYTES:
        raise PackageError("Source file is empty or exceeds 100 MB: " + filename)
    return source


def site_colors(repo):
    # Keep project colours tied to the same palette as the website.
    source = (Path(repo) / "src/lib/colors.ts").read_text(encoding="utf-8")
    colors = dict(re.findall(r'value:\s*"([^"]+)"[^}]*?hex:\s*"(#[0-9a-fA-F]{6})"', source))
    if not colors:
        raise PackageError("Cannot read website colour palette")
    return {key: value.upper() for key, value in colors.items()}


def resolve_profile(profiles, kind, name, seen=()):
    if name in seen or len(seen) > 20:
        raise PackageError("Circular Bambu profile inheritance")
    if Path(name).name != name or any(c in name for c in ("/", "\\")):
        raise PackageError("Invalid Bambu profile name")
    location = Path(profiles) / kind / (name + ".json")
    if not location.is_file():
        raise PackageError("Missing installed Bambu profile: " + name)
    child = read_json(location)
    result = resolve_profile(profiles, kind, child["inherits"], seen + (name,)) if child.get("inherits") else {}
    for include in child.get("include", []):
        result.update(resolve_profile(profiles, kind, include, seen + (name,)))
    result.update(child)
    result.pop("inherits", None)
    result.pop("include", None)
    return result


def prepare_profiles(profiles, target, filaments):
    machine = resolve_profile(profiles, "machine", MACHINE)
    machine["printer_settings_id"] = MACHINE
    process = resolve_profile(profiles, "process", PROCESS)
    process.update({
        "print_settings_id": "Carl's 3D - 0.20mm Gyroid",
        "name": "Carl's 3D - 0.20mm Gyroid",
        "sparse_infill_pattern": "gyroid", "sparse_infill_density": "15%",
        "wall_loops": "3", "enable_support": "1", "support_type": "tree(auto)",
        "support_threshold_angle": "30", "support_on_build_plate_only": "0",
        "curr_bed_type": "Textured PEI Plate", "enable_prime_tower": "0",
    })
    machine_file, process_file = Path(target) / "machine.json", Path(target) / "process.json"
    write_json(machine_file, machine)
    write_json(process_file, process)
    filament_files = []
    for index, (material, color, hex_color) in enumerate(filaments):
        profile = resolve_profile(profiles, "filament", "Generic " + material)
        if MACHINE not in profile.get("compatible_printers", []):
            raise PackageError("Filament profile does not support the P1S: " + material)
        profile.update({"filament_colour": [hex_color], "filament_settings_id": ["Generic " + material]})
        filename = Path(target) / ("filament-%d.json" % (index + 1))
        write_json(filename, profile)
        filament_files.append(filename)
    return machine_file, process_file, filament_files


def bambu_export(executable, source, destination, machine, process, filaments, log, orient=False):
    args = [str(executable), "--debug", "2", "--arrange", "1" if orient else "0",
            "--load-settings", str(machine) + ";" + str(process),
            "--load-filaments", ";".join(map(str, filaments)),
            "--export-3mf", str(destination)]
    if orient:
        args.extend(["--orient", "1"])
    args.append(str(source))
    # An argument array (never a shell) prevents filenames becoming commands.
    run = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                         timeout=600, creationflags=0x08000000 if os.name == "nt" else 0)
    Path(log).write_bytes(run.stdout)
    if run.returncode != 0 or not Path(destination).is_file():
        raise PackageError("Bambu Studio could not export the project (exit %s). See %s" % (run.returncode, log))


def transform_point(point, matrix):
    x, y, z = point
    return (x * matrix[0] + y * matrix[3] + z * matrix[6] + matrix[9],
            x * matrix[1] + y * matrix[4] + z * matrix[7] + matrix[10],
            x * matrix[2] + y * matrix[5] + z * matrix[8] + matrix[11])


def parse_transform(value):
    result = tuple(float(x) for x in value.split()) if value else IDENTITY
    if len(result) != 12 or not all(math.isfinite(x) for x in result):
        raise PackageError("Invalid 3MF transformation")
    return result


def extract_mesh(project):
    """Flatten the single source exported by Bambu, including auto-orientation."""
    vertices, triangles = [], []
    with zipfile.ZipFile(project) as archive:
        models = {}

        def read_model(filename):
            if filename not in models:
                model = ET.fromstring(archive.read(filename))
                if model.attrib.get("unit", "millimeter") != "millimeter":
                    raise PackageError("Expected millimeter Bambu output")
                models[filename] = model
            return models[filename]

        def walk(filename, object_id, transforms, depth=0):
            if depth > 32:
                raise PackageError("3MF component nesting is too deep")
            obj = read_model(filename).find("{%s}resources/{%s}object[@id='%s']" % (CORE, CORE, object_id))
            if obj is None:
                raise PackageError("3MF references a missing object")
            mesh = obj.find("{%s}mesh" % CORE)
            if mesh is not None:
                start = len(vertices)
                mesh_vertices = mesh.findall("{%s}vertices/{%s}vertex" % (CORE, CORE))
                for vertex in mesh_vertices:
                    point = tuple(float(vertex.attrib[key]) for key in ("x", "y", "z"))
                    for transform in reversed(transforms):
                        point = transform_point(point, transform)
                    if not all(math.isfinite(x) for x in point):
                        raise PackageError("Mesh contains non-finite coordinates")
                    vertices.append(point)
                for triangle in mesh.findall("{%s}triangles/{%s}triangle" % (CORE, CORE)):
                    indices = tuple(int(triangle.attrib[key]) for key in ("v1", "v2", "v3"))
                    if any(i < 0 or i >= len(mesh_vertices) for i in indices):
                        raise PackageError("Mesh has an invalid triangle")
                    triangles.append(tuple(i + start for i in indices))
            for component in obj.findall("{%s}components/{%s}component" % (CORE, CORE)):
                child_file = component.attrib.get("{%s}path" % PROD, filename).lstrip("/")
                walk(child_file, component.attrib["objectid"], transforms + [parse_transform(component.attrib.get("transform"))], depth + 1)

        model = read_model("3D/3dmodel.model")
        for item in model.findall("{%s}build/{%s}item" % (CORE, CORE)):
            if item.attrib.get("printable", "1") != "0":
                walk("3D/3dmodel.model", item.attrib["objectid"], [parse_transform(item.attrib.get("transform"))])
    if not triangles or not vertices:
        raise PackageError("Bambu Studio produced an empty mesh")
    minimum = tuple(min(v[i] for v in vertices) for i in range(3))
    normalized = [tuple(v[i] - minimum[i] for i in range(3)) for v in vertices]
    dimensions = tuple(max(v[i] for v in normalized) for i in range(3))
    if any(d < 0.001 for d in dimensions):
        raise PackageError("The source does not contain a three-dimensional part")
    return {"vertices": normalized, "triangles": triangles, "dimensions": dimensions}


def pack_plates(items):
    """Conservative bounding-box shelves, 5mm edges, 8mm between parts.

    Respect the P1S front-left 18x28mm excluded area. Plates contain only one
    filament, so incompatible materials never share a print and TPU can use
    the external spool. No scaling or automatic part splitting is performed.
    """
    plates = []
    for item_index, item in enumerate(items):
        w, h, depth = item["mesh"]["dimensions"]
        if depth > 250 or w > 246 or h > 246:
            raise PackageError("Part exceeds usable P1S volume after orientation: " + item["filename"])
        if w > 228 and h > 218:
            raise PackageError("Part overlaps the P1S excluded bed area; manual orientation needed: " + item["filename"])
        for copy_index in range(item["copies"]):
            placed = False
            for plate in plates:
                if plate["filament"] != item["filament"]:
                    continue
                x, y, row_height = plate["cursor"]
                if x + w > 251:
                    y += row_height + 8
                    x, row_height = (23 if y < 33 else 5), 0
                if x + w <= 251 and y + h <= 251:
                    plate["instances"].append({"item": item_index, "copy": copy_index, "x": x, "y": y})
                    plate["cursor"] = (x + w + 8, y, max(row_height, h))
                    placed = True
                    break
            if not placed:
                if len(plates) >= MAX_PLATES:
                    raise PackageError("Order needs more than 36 plates; manual preparation required")
                x, y = (5, 33) if w > 228 else (23, 5)
                plates.append({"filament": item["filament"], "instances": [{"item": item_index, "copy": copy_index, "x": x, "y": y}],
                               "cursor": (x + w + 8, y, h)})
    return plates


def metadata(parent, key, value):
    ET.SubElement(parent, "metadata", {"key": key, "value": str(value)})


def xml_bytes(element):
    return ET.tostring(element, encoding="utf-8", xml_declaration=True)


def combined_settings(native_projects, filament_configs):
    configs = []
    for project in native_projects:
        with zipfile.ZipFile(project) as archive:
            configs.append(json.loads(archive.read("Metadata/project_settings.config")))
    settings = dict(configs[0])
    # Mirror Bambu's PresetBundle::construct_full_config: concatenate filament
    # vectors, including per-extruder-variant vectors, but keep printer/process
    # vectors intact. Correct self indices are essential with Studio 2.7.
    keys = set().union(*(set(profile) for profile in filament_configs))
    keys.update(key for key in settings if key.startswith("filament_"))
    for key in keys:
        if isinstance(settings.get(key), list) and key != "compatible_printers":
            settings[key] = [value for config in configs for value in config.get(key, [])]
    settings["filament_self_index"] = [str(index + 1) for index, config in enumerate(configs)
                                        for _ in config.get("filament_extruder_variant", [""])]
    settings["inherits_group"] = [""] * (len(configs) + 2)
    settings["different_settings_to_system"] = [""] * (len(configs) + 2)
    settings["flush_volumes_matrix"] = ["0" if i == j else "140" for i in range(len(configs)) for j in range(len(configs))]
    return settings


def write_intermediate(destination, items, plates, filament_configs, native_projects):
    # Core 3MF components keep one mesh per uploaded file, with multiple build
    # instances preserving the requested quantities without duplicating data.
    model = ET.Element("model", {"unit": "millimeter", "xmlns": CORE, "xmlns:p": PROD, "requiredextensions": "p"})
    ET.SubElement(model, "metadata", {"name": "Application"}).text = "BambuStudio-02.07.01.62"
    ET.SubElement(model, "metadata", {"name": "BambuStudio:3mfVersion"}).text = "1"
    resources = ET.SubElement(model, "resources")
    config = ET.Element("config")
    mesh_models = []
    for index, item in enumerate(items):
        mesh_id, object_id = str(2 * index + 1), str(2 * index + 2)
        mesh_model = ET.Element("model", {"unit": "millimeter", "xmlns": CORE})
        mesh_models.append(mesh_model)
        obj = ET.SubElement(ET.SubElement(mesh_model, "resources"), "object", {"id": mesh_id, "type": "model"})
        mesh = ET.SubElement(obj, "mesh")
        vertices = ET.SubElement(mesh, "vertices")
        for vertex in item["mesh"]["vertices"]:
            ET.SubElement(vertices, "vertex", dict(zip(("x", "y", "z"), (format(v, ".9g") for v in vertex))))
        triangles = ET.SubElement(mesh, "triangles")
        for triangle in item["mesh"]["triangles"]:
            ET.SubElement(triangles, "triangle", dict(zip(("v1", "v2", "v3"), map(str, triangle))))
        wrapper = ET.SubElement(resources, "object", {"id": object_id, "type": "model"})
        ET.SubElement(ET.SubElement(wrapper, "components"), "component", {"objectid": mesh_id, "p:path": "/3D/Objects/object_%d.model" % index, "transform": "1 0 0 0 1 0 0 0 1 0 0 0"})
        obj_config = ET.SubElement(config, "object", {"id": object_id})
        metadata(obj_config, "name", item["filename"])
        metadata(obj_config, "extruder", item["filament"])
        functional = item.get("purpose") == "functional"
        metadata(obj_config, "wall_loops", 4 if functional else 3)
        metadata(obj_config, "sparse_infill_density", "25%" if functional else "15%")
        metadata(obj_config, "sparse_infill_pattern", "gyroid")
        metadata(obj_config, "enable_support", "0" if item.get("supports") is False else "1")
        metadata(obj_config, "support_type", "tree(auto)")
        ET.SubElement(obj_config, "metadata", {"face_count": str(len(item["mesh"]["triangles"]))})
        part = ET.SubElement(obj_config, "part", {"id": mesh_id, "subtype": "normal_part"})
        metadata(part, "name", item["filename"])
        metadata(part, "extruder", item["filament"])
        metadata(part, "matrix", "1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1")
    build = ET.SubElement(model, "build")
    cols = math.ceil(math.sqrt(len(plates)))
    for plate_index, plate in enumerate(plates):
        plate_config = ET.SubElement(config, "plate")
        metadata(plate_config, "plater_id", plate_index + 1)
        metadata(plate_config, "plater_name", "Filament %d" % plate["filament"])
        metadata(plate_config, "locked", "false")
        for instance in plate["instances"]:
            object_id = str(2 * instance["item"] + 2)
            x = instance["x"] + (plate_index % cols) * 307.2
            y = instance["y"] - (plate_index // cols) * 307.2
            ET.SubElement(build, "item", {"objectid": object_id, "transform": "1 0 0 0 1 0 0 0 1 %.9g %.9g 0" % (x, y), "printable": "1"})
            instance_config = ET.SubElement(plate_config, "model_instance")
            metadata(instance_config, "object_id", object_id)
            metadata(instance_config, "instance_id", instance["copy"])
            metadata(instance_config, "identify_id", 1000 * (instance["item"] + 1) + instance["copy"])
    settings = combined_settings(native_projects, filament_configs)
    settings.update({"printer_settings_id": MACHINE, "printer_model": "Bambu Lab P1S", "nozzle_diameter": ["0.4"],
                "filament_colour": [p["filament_colour"][0] for p in filament_configs],
                "filament_type": [p["filament_type"][0] for p in filament_configs],
                "filament_settings_id": [p["filament_settings_id"][0] for p in filament_configs]})
    with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("3D/3dmodel.model", xml_bytes(model))
        for index, mesh_model in enumerate(mesh_models):
            archive.writestr("3D/Objects/object_%d.model" % index, xml_bytes(mesh_model))
        relationships = ET.Element("Relationships", {"xmlns": "http://schemas.openxmlformats.org/package/2006/relationships"})
        for index in range(len(mesh_models)):
            ET.SubElement(relationships, "Relationship", {"Target": "/3D/Objects/object_%d.model" % index, "Id": "rel%d" % index, "Type": "http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"})
        archive.writestr("3D/_rels/3dmodel.model.rels", xml_bytes(relationships))
        archive.writestr("Metadata/model_settings.config", xml_bytes(config))
        archive.writestr("Metadata/project_settings.config", json.dumps(settings))
        archive.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>')
        archive.writestr("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>')


def validate_project(project, items, plates, filaments):
    with zipfile.ZipFile(project) as archive:
        settings = json.loads(archive.read("Metadata/project_settings.config"))
        model = ET.fromstring(archive.read("3D/3dmodel.model"))
        config = ET.fromstring(archive.read("Metadata/model_settings.config"))
        actual = model.findall("{%s}build/{%s}item" % (CORE, CORE))
        if len(actual) != sum(i["copies"] for i in items):
            raise PackageError("Bambu re-export changed the number of copies")
        if settings.get("printer_model") != "Bambu Lab P1S" or settings.get("nozzle_diameter") != ["0.4"]:
            raise PackageError("Bambu re-export did not preserve the P1S 0.4 profile")
        if settings.get("filament_type") != [f[0] for f in filaments]:
            raise PackageError("Bambu re-export changed filament types")
        if [s.upper() for s in settings.get("filament_colour", [])] != [f[2] for f in filaments]:
            raise PackageError("Bambu re-export changed filament colours")
        if settings.get("sparse_infill_pattern") != "gyroid":
            raise PackageError("Bambu re-export changed the 3D infill pattern")
        if len(config.findall("plate")) != len(plates):
            raise PackageError("Bambu re-export changed the number of plates")
        objects = config.findall("object")
        assignments = {}
        for plate_index, plate in enumerate(config.findall("plate")):
            for instance in plate.findall("model_instance"):
                values = {m.attrib.get("key"): m.attrib.get("value") for m in instance.findall("metadata")}
                identity = (values.get("object_id"), values.get("instance_id"))
                if identity in assignments:
                    raise PackageError("A copy is assigned to more than one plate")
                assignments[identity] = plate_index
        if len(assignments) != len(actual):
            raise PackageError("Some copies are not assigned to a plate")
        validate_native_layout(archive, model, actual, assignments, len(plates))
        for item in items:
            found = [obj for obj in objects if obj.find("metadata[@key='name']") is not None and obj.find("metadata[@key='name']").attrib["value"] == item["filename"]]
            if len(found) != 1:
                raise PackageError("Bambu re-export changed source object identity")
            values = {m.attrib.get("key"): m.attrib.get("value") for m in found[0].findall("metadata")}
            object_id = found[0].attrib["id"]
            copies = [instance for instance in actual if instance.attrib["objectid"] == object_id]
            if len(copies) != item["copies"]:
                raise PackageError("Bambu re-export changed copies for " + item["filename"])
            for copy_index in range(item["copies"]):
                plate_index = assignments.get((object_id, str(copy_index)))
                if plate_index is None or plates[plate_index]["filament"] != item["filament"]:
                    raise PackageError("A copy is assigned to the wrong material plate")
            if values.get("extruder") != str(item["filament"]):
                raise PackageError("Bambu re-export changed an object's filament assignment")
            if item.get("purpose") == "functional" and (values.get("wall_loops") != "4" or values.get("sparse_infill_density") != "25%"):
                raise PackageError("Bambu re-export changed the functional part settings")
            if item.get("supports") is False and values.get("enable_support") != "0":
                raise PackageError("Bambu re-export changed an explicit supports override")


def validate_native_layout(archive, model, build_items, assignments, plate_count):
    """Validate actual exported geometry/instances, not just our intended plan."""
    models = {"3D/3dmodel.model": model}
    bounds_cache = {}

    def bounds(filename, object_id, depth=0):
        key = (filename, object_id)
        if key in bounds_cache:
            return bounds_cache[key]
        if depth > 32:
            raise PackageError("3MF component nesting is too deep")
        if filename not in models:
            models[filename] = ET.fromstring(archive.read(filename))
        obj = models[filename].find("{%s}resources/{%s}object[@id='%s']" % (CORE, CORE, object_id))
        if obj is None:
            raise PackageError("Export references a missing mesh")
        low, high = [float("inf")] * 3, [float("-inf")] * 3

        def add(point):
            if not all(math.isfinite(v) for v in point):
                raise PackageError("Exported mesh has non-finite coordinates")
            for axis in range(3):
                low[axis], high[axis] = min(low[axis], point[axis]), max(high[axis], point[axis])

        for vertex in obj.findall("{%s}mesh/{%s}vertices/{%s}vertex" % (CORE, CORE, CORE)):
            add(tuple(float(vertex.attrib[k]) for k in ("x", "y", "z")))
        for component in obj.findall("{%s}components/{%s}component" % (CORE, CORE)):
            child_file = component.attrib.get("{%s}path" % PROD, filename).lstrip("/")
            child_low, child_high = bounds(child_file, component.attrib["objectid"], depth + 1)
            matrix = parse_transform(component.attrib.get("transform"))
            for corner in itertools.product(*zip(child_low, child_high)):
                add(transform_point(corner, matrix))
        if not all(math.isfinite(v) for v in low + high):
            raise PackageError("Exported mesh has no geometry")
        bounds_cache[key] = (low, high)
        return low, high

    columns = math.ceil(math.sqrt(plate_count))
    counters, rectangles = {}, {}
    tolerance = 0.02
    for item in build_items:
        object_id = item.attrib["objectid"]
        instance_id = counters.get(object_id, 0)
        counters[object_id] = instance_id + 1
        plate = assignments.get((object_id, str(instance_id)))
        if plate is None:
            raise PackageError("Exported instance is missing its plate")
        low, high = bounds("3D/3dmodel.model", object_id)
        points = [transform_point(corner, parse_transform(item.attrib.get("transform"))) for corner in itertools.product(*zip(low, high))]
        low = [min(point[i] for point in points) for i in range(3)]
        high = [max(point[i] for point in points) for i in range(3)]
        origin_x, origin_y = (plate % columns) * 307.2, -(plate // columns) * 307.2
        low[0], high[0] = low[0] - origin_x, high[0] - origin_x
        low[1], high[1] = low[1] - origin_y, high[1] - origin_y
        if low[0] < 5 - tolerance or low[1] < 5 - tolerance or high[0] > 251 + tolerance or high[1] > 251 + tolerance or abs(low[2]) > tolerance or high[2] > 250 + tolerance:
            raise PackageError("Exported geometry is outside its P1S plate or not on the bed")
        if low[0] < 23 - tolerance and low[1] < 33 - tolerance:
            raise PackageError("Exported geometry intersects the excluded bed area")
        rectangle = (low[0], low[1], high[0], high[1])
        for other in rectangles.get(plate, []):
            if not (rectangle[2] <= other[0] + tolerance or other[2] <= rectangle[0] + tolerance or rectangle[3] <= other[1] + tolerance or other[3] <= rectangle[1] + tolerance):
                raise PackageError("Exported copies overlap")
        rectangles.setdefault(plate, []).append(rectangle)


def build_package(manifest, uploads, output_root=DEFAULT_OUTPUT, executable=DEFAULT_BAMBU, profiles=None, repo=None):
    repo = Path(repo or Path(__file__).resolve().parents[1])
    executable = Path(executable).resolve(strict=True)
    profiles = Path(profiles or executable.parent / "resources/profiles/BBL")
    if manifest.get("type", "standard") != "standard":
        raise PackageError("This order needs product-specific source models before a print project can be built")
    order_id = manifest.get("id")
    if isinstance(order_id, bool) or not isinstance(order_id, int) or order_id < 1:
        raise PackageError("A positive numeric order id is required")
    if not manifest.get("name") or not manifest.get("orderNumber"):
        raise PackageError("Order number and customer name are required")
    raw_items = manifest.get("items")
    if not isinstance(raw_items, list) or not raw_items:
        raise PackageError("Order has no printable files")
    palette, items, filaments = site_colors(repo), [], []
    for raw in raw_items:
        copies = raw.get("copies")
        if isinstance(copies, bool) or not isinstance(copies, int) or not 1 <= copies <= MAX_COPIES:
            raise PackageError("Copies must be an integer between 1 and 500")
        material, color = str(raw.get("material", "")).upper(), str(raw.get("color", "")).lower()
        if material not in ("PLA", "PETG", "ABS", "ASA", "TPU"):
            raise PackageError("Unsupported filament material: " + material)
        if color not in palette:
            raise PackageError("Unknown filament colour: " + color)
        source = trusted_source(uploads, raw.get("filename", ""))
        filament = (material, color, palette[color])
        if filament not in filaments:
            filaments.append(filament)
        item = {"filename": source.name, "source": str(source), "sha256": sha256(source),
                "material": material, "color": color, "copies": copies,
                "filament": filaments.index(filament) + 1, "purpose": raw.get("purpose", "general"),
                "supports": raw.get("supports", True)}
        if item["purpose"] not in ("general", "functional", "decorative"):
            raise PackageError("Unknown print purpose")
        if not isinstance(item["supports"], bool):
            raise PackageError("supports must be a boolean")
        items.append(item)
    if sum(i["copies"] for i in items) > MAX_COPIES or len(filaments) > 16:
        raise PackageError("Order exceeds automatic project size limits")
    if len(set(i["filename"] for i in items)) != len(items):
        raise PackageError("Each source filename must be unique")
    # Include source bytes and selected settings so a changed manifest cannot
    # silently overwrite either a completed package or a hand-edited project.
    fingerprint = hashlib.sha256(json.dumps({"version": VERSION, "id": order_id,
        "orderNumber": manifest["orderNumber"], "name": manifest["name"], "items": items}, sort_keys=True).encode()).hexdigest()
    output_root = Path(output_root).resolve()
    output_root.mkdir(parents=True, exist_ok=True)
    folder = output_root / order_folder_name(manifest)
    marker = folder / "print-package.json"
    if folder.exists():
        if marker.is_file():
            old = read_json(marker)
            if old.get("fingerprint") == fingerprint and (folder / old.get("project", "missing")).is_file():
                return {"status": "ready", "folder": str(folder), "project": str(folder / old["project"]), "alreadyExists": True}
        raise PackageError("Order folder already exists with different or manual content: " + str(folder))
    stage = Path(tempfile.mkdtemp(prefix=".order-%d-" % order_id, dir=str(output_root))).resolve()
    try:
        work = stage / "_build"
        work.mkdir()
        machine, process, filament_files = prepare_profiles(profiles, work, filaments)
        originals = stage / "Original"
        originals.mkdir()
        for index, item in enumerate(items):
            shutil.copyfile(item["source"], originals / item["filename"])
            oriented = work / ("oriented-%d.3mf" % index)
            bambu_export(executable, item["source"], oriented, machine, process,
                         [filament_files[item["filament"] - 1]], work / ("orient-%d.log" % index), orient=True)
            item["mesh"] = extract_mesh(oriented)
        plates = pack_plates(items)
        intermediate = work / "assembled.3mf"
        native_projects = [work / ("oriented-%d.3mf" % next(index for index, item in enumerate(items) if item["filament"] == filament))
                           for filament in range(1, len(filaments) + 1)]
        write_intermediate(intermediate, items, plates, [read_json(f) for f in filament_files], native_projects)
        project_name = safe_name(manifest["orderNumber"]) + ".3mf"
        project = stage / project_name
        bambu_export(executable, intermediate, project, machine, process, filament_files, work / "export.log")
        validate_project(project, items, plates, filaments)
        report_items = [{**{k: v for k, v in i.items() if k not in ("mesh", "source")},
                         "dimensionsMm": i["mesh"]["dimensions"]} for i in items]
        report = {"version": VERSION, "fingerprint": fingerprint, "orderNumber": manifest["orderNumber"],
            "project": project_name, "printer": MACHINE, "bed": "Textured PEI Plate",
            "orientation": "Bambu Studio automatic orientation", "status": "ready_for_review",
            "items": report_items, "plates": [{"number": index + 1, "filament": p["filament"], "copies": len(p["instances"])} for index, p in enumerate(plates)],
            "filaments": [{"slot": index + 1, "material": f[0], "color": f[1], "hex": f[2], "profile": "Generic " + f[0]} for index, f in enumerate(filaments)],
            "review": ["Check orientation against the intended load direction and visible surfaces.",
                       "Slice and review supports, bridges and first layer before printing.",
                       "Match project filaments to actual loaded spools; TPU uses the external spool.",
                       "Generic material presets do not identify the exact filament brand or variant."]}
        write_json(stage / "print-package.json", report)
        write_json(stage / "order.json", manifest)
        (stage / "LAS-MIG.txt").write_text(
            "Öppna " + project_name + " i Bambu Studio.\n"
            "Bambu Lab P1S, 0,4 mm munstycke, Textured PEI Plate, 0,20 mm lager.\n"
            "Alla delar är automatiskt orienterade. Antal, material och färg följer ordern.\n"
            "Varje platta använder ett material och en färg. Infill: gyroid (3D).\n"
            "Standard: 3 väggar / 15 %. Delar märkta funktionella: 4 väggar / 25 %.\n"
            "Automatiska trädstöd är aktiverade om inte delen uttryckligen undantar stöd.\n"
            "Kontrollera orientering, belastningsriktning, stöd och första lager efter skivning.\n"
            "Välj rätt faktisk filamentrulle/AMS-plats före utskrift; TPU på extern spole.\n"
            "Projektet är inte skivat och utskrift startas aldrig automatiskt.\n", encoding="utf-8")
        # Delete only this task-created staging subdirectory, verified resolved
        # beneath its unique staging root. Never remove existing order folders.
        if work.resolve().parent != stage or stage.parent != output_root:
            raise PackageError("Unexpected staging directory")
        shutil.rmtree(str(work))
        stage.rename(folder)
        return {"status": "ready", "folder": str(folder), "project": str(folder / project_name), "plates": len(plates), "copies": sum(i["copies"] for i in items)}
    except Exception:
        # Preserve failed artifacts for diagnosis; no folder is marked complete.
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--uploads-dir", type=Path, default=Path(__file__).resolve().parents[1] / "uploads")
    parser.add_argument("--output-root", type=Path, default=Path(os.environ.get("ORDER_PRINT_OUTPUT", str(DEFAULT_OUTPUT))))
    parser.add_argument("--bambu", type=Path, default=Path(os.environ.get("BAMBU_STUDIO_EXE", str(DEFAULT_BAMBU))))
    parser.add_argument("--profiles", type=Path)
    args = parser.parse_args()
    try:
        result = build_package(read_json(args.manifest), args.uploads_dir, args.output_root, args.bambu, args.profiles)
        print(json.dumps(result, ensure_ascii=True))
    except Exception as error:
        print(json.dumps({"status": "error", "error": str(error)}, ensure_ascii=True), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
