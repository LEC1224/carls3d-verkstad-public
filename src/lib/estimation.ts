import fs from "fs";
import { RequestError } from "./requestErrors";

type Point3 = { x: number; y: number; z: number };
type Triangle = { a: Point3; b: Point3; c: Point3 };
type Bounds = { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number };
type Segment2 = { x1: number; y1: number; x2: number; y2: number; length: number };
type MeshData = { triangles: Triangle[]; triangleCount: number; bounds: Bounds; volumeMm3: number };

export type VolumeResult = {
  volumeMm3: number;
  grams: number;
  source: "pseudo" | "volume";
  fallbackReason?: string;
  layerCount?: number;
  layerHeight?: number;
  xyStep?: number;
  wallCount?: number;
  topBottomLayers?: number;
  infillDensity?: number;
  shellVolumeMm3?: number;
  solidVolumeMm3?: number;
  infillVolumeMm3?: number;
  shellFactor?: number;
  solidFactor?: number;
};

const DEFAULT_FILL_FACTOR = Number(process.env.FILL_FACTOR || "0.25");
const MIN_GRAMS_PER_FILE = Number(process.env.MIN_GRAMS_PER_FILE || "5");
const DEFAULT_LAYER_HEIGHT_MM = Number(process.env.QUOTE_LAYER_HEIGHT_MM || "0.2");
const DEFAULT_LINE_WIDTH_MM = Number(process.env.QUOTE_LINE_WIDTH_MM || "0.45");
const DEFAULT_WALL_COUNT = Number(process.env.QUOTE_WALL_COUNT || "2");
const DEFAULT_TOP_BOTTOM_LAYERS = Number(process.env.QUOTE_TOP_BOTTOM_LAYERS || "5");
const DEFAULT_INFILL_DENSITY = Number(process.env.QUOTE_INFILL_DENSITY || "0.15");
const TARGET_TOTAL_CELLS = Number(process.env.QUOTE_TARGET_TOTAL_CELLS || "12000000");
const DEFAULT_SHELL_FACTOR = Number(process.env.QUOTE_SHELL_FACTOR || "0.9");
const DEFAULT_SOLID_FACTOR = Number(process.env.QUOTE_SOLID_FACTOR || "0.88");
const LARGE_PART_RESOLUTION_FACTOR = Number(process.env.QUOTE_LARGE_PART_RESOLUTION_FACTOR || "0.85");
const MAX_LAYER_COUNT = Number(process.env.QUOTE_MAX_LAYER_COUNT || "2500");
const MAX_LAYER_CELLS = Number(process.env.QUOTE_MAX_LAYER_CELLS || "1000000");
const MAX_TRIANGLES = Number(process.env.QUOTE_MAX_TRIANGLES || "300000");

const DENSITY_G_CM3: Record<string, number> = {
  PLA: 1.24,
  PETG: 1.27,
  ABS: 1.04,
  ASA: 1.07,
  TPU: 1.21,
};

function dot(a: Point3, b: Point3) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Point3, b: Point3): Point3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function triSignedVolume(tri: Triangle) {
  return dot(tri.a, cross(tri.b, tri.c)) / 6.0;
}

function triangleArea2D(seg: Segment2) {
  return seg.length;
}

function makeEmptyBounds(): Bounds {
  return {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
  };
}

function expandBounds(bounds: Bounds, p: Point3) {
  if (p.x < bounds.minX) bounds.minX = p.x;
  if (p.y < bounds.minY) bounds.minY = p.y;
  if (p.z < bounds.minZ) bounds.minZ = p.z;
  if (p.x > bounds.maxX) bounds.maxX = p.x;
  if (p.y > bounds.maxY) bounds.maxY = p.y;
  if (p.z > bounds.maxZ) bounds.maxZ = p.z;
}

function isProbablyBinarySTL(buf: Buffer) {
  if (buf.length < 84) return false;
  const header = buf.slice(0, 80).toString("utf8");
  if (/^\s*solid\b/i.test(header)) {
    const tri = buf.readUInt32LE(80);
    const expected = 84 + tri * 50;
    return expected === buf.length;
  }
  return true;
}

function parseStlBinary(buf: Buffer): MeshData {
  const bounds = makeEmptyBounds();
  const triangles: Triangle[] = [];
  if (buf.length < 84) return { triangles, triangleCount: 0, bounds: zeroBounds(), volumeMm3: 0 };
  const triCount = buf.readUInt32LE(80);
  if (84 + triCount * 50 !== buf.length) {
    throw new RequestError("STL-filen är skadad eller ofullständig. Exportera modellen igen och försök på nytt.");
  }
  let off = 84;
  let volumeMm3 = 0;
  let triangleCount = 0;

  for (let i = 0; i < triCount && off + 50 <= buf.length; i++) {
    const a = { x: buf.readFloatLE(off + 12), y: buf.readFloatLE(off + 16), z: buf.readFloatLE(off + 20) };
    const b = { x: buf.readFloatLE(off + 24), y: buf.readFloatLE(off + 28), z: buf.readFloatLE(off + 32) };
    const c = { x: buf.readFloatLE(off + 36), y: buf.readFloatLE(off + 40), z: buf.readFloatLE(off + 44) };
    validatePoint(a); validatePoint(b); validatePoint(c);
    const tri = { a, b, c };
    triangleCount++;
    // Large meshes use the existing volume fallback, so retaining their triangles is unnecessary.
    if (triCount <= MAX_TRIANGLES) triangles.push(tri);
    expandBounds(bounds, a);
    expandBounds(bounds, b);
    expandBounds(bounds, c);
    volumeMm3 += triSignedVolume(tri);
    off += 50;
  }

  return { triangles, triangleCount, bounds: sanitizeBounds(bounds), volumeMm3: Math.abs(volumeMm3) };
}

function parseStlAscii(txt: string): MeshData {
  const bounds = makeEmptyBounds();
  const triangles: Triangle[] = [];
  let volumeMm3 = 0;
  let triangleCount = 0;
  const verts: Point3[] = [];

  for (const raw of txt.split(/\r?\n/)) {
    const m = raw.trim().match(/^vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/);
    if (!m) continue;
    const p = { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) };
    validatePoint(p);
    verts.push(p);
    if (verts.length === 3) {
      const tri = { a: verts[0], b: verts[1], c: verts[2] };
      triangleCount++;
      if (triangleCount <= MAX_TRIANGLES) triangles.push(tri);
      else if (triangleCount === Math.floor(MAX_TRIANGLES) + 1) triangles.length = 0;
      expandBounds(bounds, tri.a);
      expandBounds(bounds, tri.b);
      expandBounds(bounds, tri.c);
      volumeMm3 += triSignedVolume(tri);
      verts.length = 0;
    }
  }

  return { triangles, triangleCount, bounds: sanitizeBounds(bounds), volumeMm3: Math.abs(volumeMm3) };
}

function parseObj(txt: string): MeshData {
  const bounds = makeEmptyBounds();
  const triangles: Triangle[] = [];
  const vs: Point3[] = [];
  let volumeMm3 = 0;
  let triangleCount = 0;

  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^v\s/.test(line)) {
      const [, xs, ys, zs] = line.split(/\s+/);
      const p = { x: Number(xs), y: Number(ys), z: Number(zs) };
      validatePoint(p);
      vs.push(p);
      expandBounds(bounds, p);
      continue;
    }

    if (!/^f\s/.test(line)) continue;
    const parts = line.split(/\s+/).slice(1);
    const idxs = parts.map((part) => {
      const n = parseInt(part.split("/")[0], 10);
      return n > 0 ? n - 1 : vs.length + n;
    });

    for (let i = 1; i + 1 < idxs.length; i++) {
      const a = vs[idxs[0]];
      const b = vs[idxs[i]];
      const c = vs[idxs[i + 1]];
      if (!a || !b || !c) continue;
      const tri = { a, b, c };
      triangleCount++;
      if (triangleCount <= MAX_TRIANGLES) triangles.push(tri);
      else if (triangleCount === Math.floor(MAX_TRIANGLES) + 1) triangles.length = 0;
      volumeMm3 += triSignedVolume(tri);
    }
  }

  return { triangles, triangleCount, bounds: sanitizeBounds(bounds), volumeMm3: Math.abs(volumeMm3) };
}

function zeroBounds(): Bounds {
  return { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
}

function validatePoint(point: Point3) {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) {
    throw new RequestError("3D-filen innehåller ogiltiga koordinater. Exportera modellen igen och försök på nytt.");
  }
}

function sanitizeBounds(bounds: Bounds) {
  if (!Number.isFinite(bounds.minX)) return zeroBounds();
  return bounds;
}

function readMesh(filePath: string): MeshData {
  const buf = fs.readFileSync(filePath);
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".stl")) {
    return isProbablyBinarySTL(buf) ? parseStlBinary(buf) : parseStlAscii(buf.toString("utf8"));
  }
  if (lower.endsWith(".obj")) {
    return parseObj(buf.toString("utf8"));
  }
  return { triangles: [], triangleCount: 0, bounds: zeroBounds(), volumeMm3: 0 };
}

function estimateGridStep(bounds: Bounds, layerCount: number) {
  const width = Math.max(bounds.maxX - bounds.minX, DEFAULT_LINE_WIDTH_MM);
  const depth = Math.max(bounds.maxY - bounds.minY, DEFAULT_LINE_WIDTH_MM);
  const adaptive = Math.sqrt((width * depth * Math.max(layerCount, 1)) / Math.max(TARGET_TOTAL_CELLS, 1));
  const largePartFactor = width * depth > 40000 ? LARGE_PART_RESOLUTION_FACTOR : 1;
  return Math.max(DEFAULT_LINE_WIDTH_MM * 0.75, (width / 320) * largePartFactor, (depth / 320) * largePartFactor, adaptive * largePartFactor);
}

function segmentAtZ(tri: Triangle, z: number): Segment2 | null {
  const pts: Array<{ x: number; y: number }> = [];
  const eps = 1e-9;
  const edges: Array<[Point3, Point3]> = [
    [tri.a, tri.b],
    [tri.b, tri.c],
    [tri.c, tri.a],
  ];

  for (const [p1, p2] of edges) {
    const dz = p2.z - p1.z;
    if (Math.abs(dz) < eps) continue;
    const t = (z - p1.z) / dz;
    if (t < 0 || t >= 1) continue;
    const x = p1.x + (p2.x - p1.x) * t;
    const y = p1.y + (p2.y - p1.y) * t;
    if (!pts.some((p) => Math.abs(p.x - x) < eps && Math.abs(p.y - y) < eps)) {
      pts.push({ x, y });
    }
  }

  if (pts.length !== 2) return null;
  const dx = pts[1].x - pts[0].x;
  const dy = pts[1].y - pts[0].y;
  const length = Math.hypot(dx, dy);
  return length > eps ? { x1: pts[0].x, y1: pts[0].y, x2: pts[1].x, y2: pts[1].y, length } : null;
}

function createLayerSegmentBuilder(triangles: Triangle[]) {
  // Sweep upward through the mesh. Typed arrays bound the index to 32 bytes per triangle;
  // the active linked list avoids allocating a triangle list for every layer.
  const minZs = new Float64Array(triangles.length);
  const maxZs = new Float64Array(triangles.length);
  const indices = new Uint32Array(triangles.length);
  let count = 0;
  for (let index = 0; index < triangles.length; index++) {
    const triangle = triangles[index];
    minZs[index] = Math.min(triangle.a.z, triangle.b.z, triangle.c.z);
    maxZs[index] = Math.max(triangle.a.z, triangle.b.z, triangle.c.z);
    if (maxZs[index] > minZs[index]) indices[count++] = index;
  }
  const starts = indices.subarray(0, count).sort((a, b) => minZs[a] - minZs[b]);
  const ends = starts.slice().sort((a, b) => maxZs[a] - maxZs[b]);
  const next = new Int32Array(triangles.length).fill(-1);
  const previous = new Int32Array(triangles.length).fill(-1);
  let head = -1;
  let nextStart = 0;
  let nextEnd = 0;

  return (z: number) => {
    while (nextStart < starts.length && minZs[starts[nextStart]] <= z) {
      const index = starts[nextStart++];
      next[index] = head;
      if (head !== -1) previous[head] = index;
      head = index;
    }
    while (nextEnd < ends.length && maxZs[ends[nextEnd]] <= z) {
      const index = ends[nextEnd++];
      if (previous[index] === -1) head = next[index];
      else next[previous[index]] = next[index];
      if (next[index] !== -1) previous[next[index]] = previous[index];
    }
    const segments: Segment2[] = [];
    let perimeter = 0;
    for (let index = head; index !== -1; index = next[index]) {
      const segment = segmentAtZ(triangles[index], z);
      if (!segment) continue;
      segments.push(segment);
      perimeter += triangleArea2D(segment);
    }
    return { segments, perimeter };
  };
}

function rasterizeLayer(segments: Segment2[], bounds: Bounds, step: number, nx: number, ny: number) {
  const occ = new Uint8Array(nx * ny);
  let occupied = 0;

  for (let row = 0; row < ny; row++) {
    const y = bounds.minY + (row + 0.5) * step;
    const xs: number[] = [];

    for (const seg of segments) {
      const minY = Math.min(seg.y1, seg.y2);
      const maxY = Math.max(seg.y1, seg.y2);
      const dy = seg.y2 - seg.y1;
      if (Math.abs(dy) < 1e-9 || y < minY || y >= maxY) continue;
      const t = (y - seg.y1) / dy;
      xs.push(seg.x1 + (seg.x2 - seg.x1) * t);
    }

    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const start = Math.min(xs[i], xs[i + 1]);
      const end = Math.max(xs[i], xs[i + 1]);
      const colStart = Math.max(0, Math.ceil((start - bounds.minX) / step - 0.5));
      const colEnd = Math.min(nx - 1, Math.floor((end - bounds.minX) / step - 0.5));
      for (let col = colStart; col <= colEnd; col++) {
        const idx = row * nx + col;
        if (!occ[idx]) {
          occ[idx] = 1;
          occupied++;
        }
      }
    }
  }

  return { occ, areaMm2: occupied * step * step };
}

function erodeMask(src: Uint8Array, nx: number, ny: number, iterations: number) {
  let current = src.slice();
  for (let iter = 0; iter < iterations; iter++) {
    const next = new Uint8Array(nx * ny);
    for (let y = 1; y < ny - 1; y++) {
      for (let x = 1; x < nx - 1; x++) {
        const idx = y * nx + x;
        if (!current[idx]) continue;
        let keep = 1;
        for (let oy = -1; oy <= 1 && keep; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (!current[(y + oy) * nx + (x + ox)]) {
              keep = 0;
              break;
            }
          }
        }
        if (keep) next[idx] = 1;
      }
    }
    current = next;
  }
  return current;
}

function estimateVolumeFallback(mesh: MeshData, material: string, fallbackReason: string): VolumeResult {
  const mat = (material || "PLA").toUpperCase();
  const density = DENSITY_G_CM3[mat] ?? DENSITY_G_CM3.PLA;
  const gramsSolid = (mesh.volumeMm3 / 1000.0) * density;
  const grams = Math.max(gramsSolid * DEFAULT_FILL_FACTOR, MIN_GRAMS_PER_FILE);

  return {
    volumeMm3: mesh.volumeMm3,
    grams,
    source: "volume",
    fallbackReason,
    infillDensity: DEFAULT_FILL_FACTOR,
  };
}

function estimatePseudoSlice(mesh: MeshData, material: string): VolumeResult | null {
  if (mesh.triangleCount > MAX_TRIANGLES) return estimateVolumeFallback(mesh, material, "pseudo_skipped_too_many_triangles");
  if (mesh.triangles.length === 0) return null;
  const height = mesh.bounds.maxZ - mesh.bounds.minZ;
  if (height <= 0) return null;

  const layerCount = Math.max(1, Math.ceil(height / DEFAULT_LAYER_HEIGHT_MM));
  const xyStep = estimateGridStep(mesh.bounds, layerCount);
  const width = Math.max(mesh.bounds.maxX - mesh.bounds.minX, xyStep);
  const depth = Math.max(mesh.bounds.maxY - mesh.bounds.minY, xyStep);
  const nx = Math.max(1, Math.ceil(width / xyStep));
  const ny = Math.max(1, Math.ceil(depth / xyStep));
  if (layerCount > MAX_LAYER_COUNT) return estimateVolumeFallback(mesh, material, "pseudo_skipped_too_many_layers");
  if (nx * ny > MAX_LAYER_CELLS) return estimateVolumeFallback(mesh, material, "pseudo_skipped_grid_too_dense");
  const erosionSteps = Math.max(1, Math.round((DEFAULT_WALL_COUNT * DEFAULT_LINE_WIDTH_MM) / xyStep));

  const occupancies: Uint8Array[] = [];
  const buildLayerSegments = createLayerSegmentBuilder(mesh.triangles);
  for (let layer = 0; layer < layerCount; layer++) {
    const z = Math.min(mesh.bounds.maxZ - 1e-6, mesh.bounds.minZ + (layer + 0.5) * DEFAULT_LAYER_HEIGHT_MM);
    const { segments } = buildLayerSegments(z);
    occupancies.push(rasterizeLayer(segments, mesh.bounds, xyStep, nx, ny).occ);
  }

  let shellVolumeMm3 = 0;
  let solidVolumeMm3 = 0;
  let infillVolumeMm3 = 0;
  const voxelVolume = xyStep * xyStep * DEFAULT_LAYER_HEIGHT_MM;

  for (let layer = 0; layer < layerCount; layer++) {
    const occ = occupancies[layer];
    const core = erodeMask(occ, nx, ny, erosionSteps);

    for (let idx = 0; idx < occ.length; idx++) {
      if (!occ[idx]) continue;
      if (!core[idx]) {
        shellVolumeMm3 += voxelVolume;
        continue;
      }

      let isSolid = false;
      for (let d = 1; d <= DEFAULT_TOP_BOTTOM_LAYERS && !isSolid; d++) {
        const below = layer - d;
        const above = layer + d;
        if (below < 0 || !occupancies[below][idx] || above >= layerCount || !occupancies[above][idx]) {
          isSolid = true;
        }
      }

      if (isSolid) solidVolumeMm3 += voxelVolume;
      else infillVolumeMm3 += voxelVolume * DEFAULT_INFILL_DENSITY;
    }
  }

  shellVolumeMm3 *= DEFAULT_SHELL_FACTOR;
  solidVolumeMm3 *= DEFAULT_SOLID_FACTOR;
  const pseudoVolumeMm3 = shellVolumeMm3 + solidVolumeMm3 + infillVolumeMm3;
  const density = DENSITY_G_CM3[(material || "PLA").toUpperCase()] ?? DENSITY_G_CM3.PLA;
  const grams = Math.max((pseudoVolumeMm3 / 1000.0) * density, MIN_GRAMS_PER_FILE);

  return {
    volumeMm3: mesh.volumeMm3,
    grams,
    source: "pseudo",
    layerCount,
    layerHeight: DEFAULT_LAYER_HEIGHT_MM,
    xyStep,
    wallCount: DEFAULT_WALL_COUNT,
    topBottomLayers: DEFAULT_TOP_BOTTOM_LAYERS,
    infillDensity: DEFAULT_INFILL_DENSITY,
    shellVolumeMm3,
    solidVolumeMm3,
    infillVolumeMm3,
    shellFactor: DEFAULT_SHELL_FACTOR,
    solidFactor: DEFAULT_SOLID_FACTOR,
  };
}

export function estimateFromFile(filePath: string, material: string): VolumeResult {
  const mesh = readMesh(filePath);
  if (!mesh.triangleCount || !Number.isFinite(mesh.volumeMm3)) {
    throw new RequestError("Kunde inte läsa någon giltig 3D-modell ur filen. Exportera den som STL eller OBJ och försök igen.");
  }
  try {
    const pseudo = estimatePseudoSlice(mesh, material);
    if (pseudo) return pseudo;
  } catch (error) {
    console.error("Pseudo slicer failed, falling back to volume estimate:", error);
  }
  return estimateVolumeFallback(mesh, material, "pseudo_slicer_failed");
}
