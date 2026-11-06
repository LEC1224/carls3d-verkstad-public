import fs from "fs/promises";
import os from "os";
import path from "path";
import { Readable } from "stream";
import { PersistentFile } from "formidable";
import type { NextApiRequest } from "next";
import { parseUpload, uploadedFiles } from "../src/lib/uploads";
import { parseItemsMeta } from "../src/lib/orderValidation";
import { estimateFromFile } from "../src/lib/estimation";

let directory: string;
let cwd: jest.SpyInstance;
const limits = { maxFileSize: 40, maxTotalFileSize: 60, maxFiles: 2 };

function request(parts: Array<{ name: string; filename?: string; content: string }>) {
  const boundary = "test-upload-boundary";
  const body = parts.map((part) => `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"${part.filename ? `; filename="${part.filename}"` : ""}\r\n${part.filename ? "Content-Type: application/octet-stream\r\n" : ""}\r\n${part.content}\r\n`).join("") + `--${boundary}--\r\n`;
  const req = Readable.from(Buffer.from(body)) as unknown as NextApiRequest;
  req.headers = { "content-type": `multipart/form-data; boundary=${boundary}`, "content-length": String(Buffer.byteLength(body)) };
  return req;
}

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "carls3d-upload-test-"));
  cwd = jest.spyOn(process, "cwd").mockReturnValue(directory);
});
afterEach(async () => {
  cwd.mockRestore();
  if (path.dirname(directory) !== path.resolve(os.tmpdir())) throw new Error("Unexpected test directory");
  await fs.rm(directory, { recursive: true, force: true });
});

test("successful uploads have private temporary directories and explicit cleanup", async () => {
  const upload = await parseUpload(request([{ name: "files", filename: "part.stl", content: "solid test" }]), limits);
  const files = uploadedFiles(upload.files, "files");
  expect(files).toHaveLength(1);
  expect(await fs.readFile(files[0].filepath, "utf8")).toBe("solid test");
  await upload.cleanup();
  expect(await fs.readdir(path.join(directory, "uploads", "tmp"))).toEqual([]);
});

test.each([
  [{ name: "files", filename: "empty.stl", content: "" }],
  [{ name: "files", filename: "large.stl", content: "x".repeat(41) }],
  [{ name: "files", filename: "a.stl", content: "x".repeat(31) }, { name: "files", filename: "b.stl", content: "x".repeat(31) }],
  Array.from({ length: 3 }, (_, i) => ({ name: "files", filename: `${i}.stl`, content: "x" })),
].map((parts) => ({ parts })))("failed multipart uploads remove partial files: %p", async ({ parts }) => {
  await expect(parseUpload(request(parts), limits)).rejects.toMatchObject({ statusCode: expect.any(Number) });
  expect(await fs.readdir(path.join(directory, "uploads", "tmp"))).toEqual([]);
});

test("unknown file fields are rejected and remain cleanup-able", async () => {
  const upload = await parseUpload(request([{ name: "unexpected", filename: "part.stl", content: "solid" }]), limits);
  expect(() => uploadedFiles(upload.files, "files")).toThrow("okänt filfält");
  await upload.cleanup();
  expect(await fs.readdir(path.join(directory, "uploads", "tmp"))).toEqual([]);
});

test("out-of-order disk writes keep model files paired with their original material and quantity", async () => {
  const originalEnd = PersistentFile.prototype.end;
  const completionOrder: string[] = [];
  const delayedEnd = jest.spyOn(PersistentFile.prototype, "end").mockImplementation(function (callback) {
    const file = this;
    originalEnd.call(file, () => {
      const finish = () => { completionOrder.push(file.originalFilename); callback(); };
      if (file.originalFilename === "first.stl") setTimeout(finish, 50);
      else finish();
    });
  });
  let upload: Awaited<ReturnType<typeof parseUpload>>;
  try {
    upload = await parseUpload(request([
      { name: "files", filename: "first.stl", content: "first model" },
      { name: "files", filename: "second.stl", content: "second model" },
      { name: "itemsMeta", content: JSON.stringify([{ material: "PLA", color: "white", copies: 1 }, { material: "TPU", color: "black", copies: 3 }]) },
    ]), limits);
    expect(completionOrder).toEqual(["second.stl", "first.stl"]);
    const files = uploadedFiles(upload.files, "files");
    const meta = parseItemsMeta(upload.fields.itemsMeta, files.length);
    expect(files.map((file, index) => ({ name: file.originalFilename, ...meta[index] }))).toEqual([
      { name: "first.stl", material: "PLA", color: "white", copies: 1, purpose: "general" },
      { name: "second.stl", material: "TPU", color: "black", copies: 3, purpose: "general" },
    ]);
  } finally {
    delayedEnd.mockRestore();
    await upload?.cleanup();
  }
});

test.each(["model.v2 final.obj", "del.vänster.OBJ"])("valid model filename %s retains its final extension for estimation", async (filename) => {
  const contents = "v 0 0 0\nv 10 0 0\nv 0 10 0\nv 0 0 10\nf 1 3 2\nf 1 2 4\nf 1 4 3\nf 2 3 4\n";
  const upload = await parseUpload(request([{ name: "files", filename, content: contents }]), {
    maxFileSize: 4096, maxTotalFileSize: 4096, maxFiles: 1,
  });
  try {
    const [file] = uploadedFiles(upload.files, "files");
    expect(file.originalFilename).toBe(filename);
    expect(path.extname(file.filepath)).toBe(".obj");
    expect(estimateFromFile(file.filepath, "PLA").volumeMm3).toBeCloseTo(1000 / 6);
  } finally {
    await upload.cleanup();
  }
});

test.each(["model.v2 final.stl", "bild.vänster.JPG"])("temporary extension for %s uses only the last suffix", async (filename) => {
  const upload = await parseUpload(request([{ name: "files", filename, content: "test" }]), limits);
  try {
    expect(path.extname(uploadedFiles(upload.files, "files")[0].filepath)).toBe(path.extname(filename).toLowerCase());
  } finally {
    await upload.cleanup();
  }
});
