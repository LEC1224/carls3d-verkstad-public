import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import baseline from "./fixtures/estimation-baseline.json";
import { makeBoxFixture } from "./helpers/meshFixtures";

const settings = {
  FILL_FACTOR: "0.25", MIN_GRAMS_PER_FILE: "5", QUOTE_LAYER_HEIGHT_MM: "0.2", QUOTE_LINE_WIDTH_MM: "0.45",
  QUOTE_WALL_COUNT: "2", QUOTE_TOP_BOTTOM_LAYERS: "5", QUOTE_INFILL_DENSITY: "0.15", QUOTE_TARGET_TOTAL_CELLS: "12000000",
  QUOTE_SHELL_FACTOR: "0.9", QUOTE_SOLID_FACTOR: "0.88", QUOTE_LARGE_PART_RESOLUTION_FACTOR: "0.85",
  QUOTE_MAX_LAYER_COUNT: "2500", QUOTE_MAX_LAYER_CELLS: "1000000", QUOTE_MAX_TRIANGLES: "300000",
};
let directory: string;

beforeAll(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "carls3d-equivalence-test-"));
});

afterAll(() => {
  if (path.dirname(directory) !== path.resolve(os.tmpdir())) throw new Error("Unexpected test directory");
  fs.rmSync(directory, { recursive: true, force: true });
});

test.each(baseline.cases)("$name mesh keeps the original complete estimate, including unrounded material weight", ({ name, subdivisions, dimensions, expected }) => {
  const filename = path.join(directory, `${name}.stl`);
  fs.writeFileSync(filename, makeBoxFixture(subdivisions, dimensions));
  // Captured from the original estimator at baseline.sourceCommit; no rewritten oracle or timing assertion.
  // Execute in Node directly to avoid Jest VM overhead in the numerical hot loops.
  const result = execFileSync(process.execPath, [path.resolve(__dirname, "../scripts/benchmark-estimation.cjs"), "--estimate-file", filename], {
    encoding: "utf8", env: { ...process.env, ...settings }, timeout: 15000,
  });
  expect(JSON.parse(result)).toEqual(expected);
});
