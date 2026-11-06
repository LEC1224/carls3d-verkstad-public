import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Group, Mesh } from "three";
import { inspectPreviewModel, MAX_PREVIEW_PARTS, MAX_PREVIEW_TRIANGLES, repairPreviewNormals, validateObjPreviewSize, validateStlPreviewSize } from "../src/lib/modelPreview";

test("reports the original millimeter bounds independently of preview camera settings", () => {
  const model = new Mesh(new BoxGeometry(10, 20, 30));
  model.position.set(100, 200, 300);
  const { bounds, triangles } = inspectPreviewModel(model);
  expect(bounds.max.x - bounds.min.x).toBe(10);
  expect(bounds.max.y - bounds.min.y).toBe(20);
  expect(bounds.max.z - bounds.min.z).toBe(30);
  expect(triangles).toBe(12);
  model.geometry.dispose();
});

test("allows a flat surface but rejects missing or non-finite geometry", () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 10, 0, 0, 0, 10, 0], 3));
  expect(inspectPreviewModel(new Mesh(geometry)).triangles).toBe(1);
  expect(() => inspectPreviewModel(new Group())).toThrow("inga ytor");
  geometry.attributes.position.setX(0, NaN);
  expect(() => inspectPreviewModel(new Mesh(geometry))).toThrow("ogiltiga koordinater");
  geometry.dispose();
});

test("rejects excessive mesh detail before requesting a WebGL context", () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 10, 0, 0, 0, 10, 0], 3));
  geometry.setIndex(new Array((MAX_PREVIEW_TRIANGLES + 1) * 3).fill(0));
  expect(() => inspectPreviewModel(new Mesh(geometry))).toThrow("för detaljerad");
  geometry.dispose();
});

test("preflights OBJ polygons before the loader allocates triangulated geometry", () => {
  expect(() => validateObjPreviewSize("v 0 0 0\nf 1 2 3\nf 1 2 3 4\n")).not.toThrow();
  expect(() => validateObjPreviewSize("f " + "1 ".repeat(MAX_PREVIEW_TRIANGLES + 3))).toThrow("för detaljerad");
});

test("rejects a tiny binary STL with a huge advertised triangle count before allocating geometry", () => {
  const data = new ArrayBuffer(84);
  new DataView(data).setUint32(80, 0xffffffff, true);
  expect(() => validateStlPreviewSize(data)).toThrow("för detaljerad");
  new DataView(data).setUint32(80, 1, true);
  expect(() => validateStlPreviewSize(data)).toThrow("ofullständig");
});

test("accepts binary STL with a solid header and ordinary ASCII STL", () => {
  const binary = new ArrayBuffer(134);
  new Uint8Array(binary).set(new TextEncoder().encode("solid"));
  new DataView(binary).setUint32(80, 1, true);
  expect(() => validateStlPreviewSize(binary)).not.toThrow();
  const ascii = new TextEncoder().encode("solid test\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid");
  expect(() => validateStlPreviewSize(ascii.buffer)).not.toThrow();
});

test("repairs zero STL normals so the selected filament color receives lighting", () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 10, 0, 0, 0, 10, 0], 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(new Array(9).fill(0), 3));
  repairPreviewNormals(geometry);
  expect(Array.from(geometry.getAttribute("normal").array)).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  geometry.dispose();
});

test("preserves valid supplied normals, including smoothing in OBJ models", () => {
  const geometry = new BoxGeometry();
  const normals = geometry.getAttribute("normal");
  const values = Array.from(normals.array);
  repairPreviewNormals(geometry);
  expect(geometry.getAttribute("normal")).toBe(normals);
  expect(Array.from(normals.array)).toEqual(values);
  geometry.dispose();
});

test("preflights OBJ face aliases and continued polygons using the loader's syntax", () => {
  const continuation = String.fromCharCode(92) + "\r\n";
  expect(() => validateObjPreviewSize("v 0 0 0\nf1 2 3\nf 1 2 " + continuation + "3 4")).not.toThrow();
  expect(() => validateObjPreviewSize("f1 " + "1 ".repeat(MAX_PREVIEW_TRIANGLES + 3))).toThrow("för detaljerad");
  expect(() => validateObjPreviewSize("f 1 1 " + continuation + "1 ".repeat(MAX_PREVIEW_TRIANGLES + 3))).toThrow("för detaljerad");
});

test("rejects point/line-only OBJ before loading and bounds auxiliary geometry in mixed models", () => {
  expect(() => validateObjPreviewSize("v 0 0 0\np 1")).toThrow("inga ytor");
  expect(() => validateObjPreviewSize("v 0 0 0\nl 1 1")).toThrow("inga ytor");
  expect(() => validateObjPreviewSize("f 1 2 3\np " + "1 ".repeat(MAX_PREVIEW_TRIANGLES * 3 + 1))).toThrow("för detaljerad");
  // OBJLoader splits points/lines on literal spaces, so internal empty entries also cost memory.
  expect(() => validateObjPreviewSize("f 1 2 3\nl 1" + " ".repeat(MAX_PREVIEW_TRIANGLES * 3) + "1")).toThrow("för detaljerad");
});

test("bounds object allocation and excessive input records without invoking the loader", () => {
  expect(() => validateObjPreviewSize("f 1 2 3\n" + "gpart\n".repeat(MAX_PREVIEW_PARTS + 1))).toThrow("för detaljerad");
  expect(() => validateObjPreviewSize("f 1 2 3\n" + "v 0 0 0\n".repeat(MAX_PREVIEW_TRIANGLES * 3 + 1))).toThrow("för detaljerad");
  expect(() => validateObjPreviewSize("\n".repeat(2_000_001))).toThrow("för detaljerad");
});
