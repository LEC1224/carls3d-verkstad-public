import fs from "fs";
import os from "os";
import path from "path";
import { estimateFromFile } from "../src/lib/estimation";
import { validateImageUpload } from "../src/lib/imageValidation";

let directory: string;
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), "carls3d-estimate-test-")); });
afterEach(() => {
  if (path.dirname(directory) !== path.resolve(os.tmpdir())) throw new Error("Unexpected test directory");
  fs.rmSync(directory, { recursive: true, force: true });
});

function model(name: string, contents: string | Buffer) {
  const filename = path.join(directory, name);
  fs.writeFileSync(filename, contents);
  return filename;
}

test("an OBJ using tab separators and relative face indices produces a finite estimate", () => {
  const filename = model("tetra.obj", "v\t0 0 0\nv\t10 0 0\nv\t0 10 0\nv\t0 0 10\nf -4 -2 -3\nf -4 -3 -1\nf -4 -1 -2\nf -3 -2 -1\n");
  const result = estimateFromFile(filename, "PLA");
  expect(result.volumeMm3).toBeCloseTo(1000 / 6);
  expect(Number.isFinite(result.grams)).toBe(true);
  expect(result.grams).toBeGreaterThan(0);
});

test.each(["stl", "obj"])("random bytes renamed to %s are rejected instead of receiving a minimum-price quote", (extension) => {
  expect(() => estimateFromFile(model(`bad.${extension}`, "not a 3D model"), "PLA")).toThrow("giltig 3D-modell");
});

test("truncated binary STL and nonfinite binary coordinates are rejected", () => {
  const truncated = Buffer.alloc(84);
  truncated.writeUInt32LE(4, 80);
  expect(() => estimateFromFile(model("truncated.stl", truncated), "PLA")).toThrow("ofullständig");
  const invalid = Buffer.alloc(134);
  invalid.writeUInt32LE(1, 80);
  invalid.writeFloatLE(Number.NaN, 96);
  expect(() => estimateFromFile(model("invalid.stl", invalid), "PLA")).toThrow("ogiltiga koordinater");
});

test("nonfinite OBJ coordinates do not pass to pricing", () => {
  const filename = model("invalid.obj", "v 0 0 0\nv 1e999 0 0\nv 0 1 0\nf 1 2 3\n");
  expect(() => estimateFromFile(filename, "PLA")).toThrow("ogiltiga koordinater");
});

test("large meshes retain their volume estimate after triangle storage is capped", () => {
  const previousLimit = process.env.QUOTE_MAX_TRIANGLES;
  process.env.QUOTE_MAX_TRIANGLES = "1";
  try {
    jest.isolateModules(() => {
      const { estimateFromFile: estimateLimited } = require("../src/lib/estimation");
      const filename = model("tetra.obj", "v 0 0 0\nv 100 0 0\nv 0 100 0\nv 0 0 100\nf 1 3 2\nf 1 2 4\nf 1 4 3\nf 2 3 4\n");
      const estimate = estimateLimited(filename, "PLA");
      expect(estimate.source).toBe("volume");
      expect(estimate.fallbackReason).toBe("pseudo_skipped_too_many_triangles");
      expect(estimate.volumeMm3).toBeCloseTo(1000000 / 6);
      expect(estimate.grams).toBeGreaterThan(5);
    });
  } finally {
    if (previousLimit === undefined) delete process.env.QUOTE_MAX_TRIANGLES;
    else process.env.QUOTE_MAX_TRIANGLES = previousLimit;
  }
});

test.each([
  ["photo.jpg", Buffer.from([255, 216, 255, 224])],
  ["photo.png", Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])],
  ["photo.webp", Buffer.from("RIFFxxxxWEBP")],
])("recognizes the supported picture signature for %s", (name, contents) => {
  expect(() => validateImageUpload({ originalFilename: name as string, filepath: model(name as string, contents as Buffer) })).not.toThrow();
});

test.each(["photo.jpg", "photo.png", "photo.webp", "photo.svg", "photo.gif"])("rejects arbitrary or unsupported image content in %s", (name) => {
  expect(() => validateImageUpload({ originalFilename: name, filepath: model(name, "<svg></svg>") })).toThrow("JPEG");
});
