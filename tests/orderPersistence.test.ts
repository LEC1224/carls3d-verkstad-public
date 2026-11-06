import fs from "fs";
import os from "os";
import path from "path";
import { persistOrder } from "../src/lib/persistOrder";

let directory: string;
let cwd: jest.SpyInstance;
const customer = { name: "Åsa", email: "test@example.com", type: "standard", status: "Ny", price: 100, addressLine1: "", postalCode: "", city: "", country: "", deliveryMethod: "pickup" };

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "carls3d-order-test-"));
  cwd = jest.spyOn(process, "cwd").mockReturnValue(directory);
  fs.writeFileSync(path.join(directory, "part.stl"), "source-file");
});
afterEach(() => {
  cwd.mockRestore();
  if (path.dirname(directory) !== path.resolve(os.tmpdir())) throw new Error("Unexpected test directory");
  fs.rmSync(directory, { recursive: true, force: true });
});

function database(fail = false) {
  const tx = {
    order: {
      create: jest.fn(async ({ data }) => ({ ...data, id: 1, createdAt: new Date("2026-01-01T12:00:00Z") })),
      update: jest.fn(async ({ data }) => ({ id: 1, ...data })),
    },
    orderFile: { create: jest.fn(async () => { if (fail) throw new Error("DB unavailable"); }) },
  };
  return { tx, $transaction: jest.fn(async (callback) => callback(tx)) };
}

test("files and their final metadata are prepared in the same transaction", async () => {
  const db = database();
  const saved = await persistOrder(db as any, customer, [
    { filepath: path.join(directory, "part.stl"), originalFilename: "../../part.stl" },
    { filepath: path.join(directory, "part.stl"), originalFilename: "../../part.stl" },
  ]);
  expect(saved.order.orderNumber).toBe("SP-2026-000001-ÅSA");
  expect(saved.finalFiles).toHaveLength(2);
  expect(saved.finalFiles[0].filename).toBe("SP-2026-000001-ÅSA_1_part.stl");
  expect(new Set(saved.finalFiles.map((file) => file.filename)).size).toBe(2);
  for (const file of saved.finalFiles) {
    expect(path.basename(file.filename)).toBe(file.filename);
    expect(fs.readFileSync(path.join(directory, "uploads", file.filename), "utf8")).toBe("source-file");
  }
  expect(db.tx.orderFile.create).toHaveBeenCalledTimes(2);
  expect(fs.existsSync(path.join(directory, "part.stl"))).toBe(true);
});

test("a database failure rolls back the transaction and removes copied files", async () => {
  const db = database(true);
  await expect(persistOrder(db as any, customer, [
    { filepath: path.join(directory, "part.stl"), originalFilename: "part.stl" },
  ])).rejects.toThrow("DB unavailable");
  expect(fs.readdirSync(path.join(directory, "uploads"))).toEqual([]);
  expect(fs.existsSync(path.join(directory, "part.stl"))).toBe(true);
});

test("a later missing upload removes earlier copies instead of leaving a partial order", async () => {
  const db = database();
  await expect(persistOrder(db as any, customer, [
    { filepath: path.join(directory, "part.stl"), originalFilename: "part.stl" },
    { filepath: path.join(directory, "missing.stl"), originalFilename: "missing.stl" },
  ])).rejects.toThrow();
  expect(fs.readdirSync(path.join(directory, "uploads"))).toEqual([]);
});

test("an orphan destination is preserved while a retry claims a different filename", async () => {
  const uploads = path.join(directory, "uploads");
  fs.mkdirSync(uploads);
  const orphanName = "SP-2026-000001-ÅSA_1_part.stl";
  fs.writeFileSync(path.join(uploads, orphanName), "previous-attempt");
  const db = database();
  const saved = await persistOrder(db as any, customer, [{ filepath: path.join(directory, "part.stl"), originalFilename: "part.stl" }]);
  const finalName = saved.finalFiles[0].filename;
  expect(finalName).not.toBe(orphanName);
  expect(path.extname(finalName)).toBe(".stl");
  expect(fs.readFileSync(path.join(uploads, orphanName), "utf8")).toBe("previous-attempt");
  expect(fs.readFileSync(path.join(uploads, finalName), "utf8")).toBe("source-file");
  expect(db.tx.orderFile.create).toHaveBeenCalledWith({ data: expect.objectContaining({ filename: finalName }) });
});

test("a failed retry removes only its own alternative file and keeps the earlier orphan", async () => {
  const uploads = path.join(directory, "uploads");
  fs.mkdirSync(uploads);
  const orphanName = "SP-2026-000001-ÅSA_1_part.stl";
  fs.writeFileSync(path.join(uploads, orphanName), "previous-attempt");
  await expect(persistOrder(database(true) as any, customer, [{ filepath: path.join(directory, "part.stl"), originalFilename: "part.stl" }])).rejects.toThrow("DB unavailable");
  expect(fs.readdirSync(uploads)).toEqual([orphanName]);
  expect(fs.readFileSync(path.join(uploads, orphanName), "utf8")).toBe("previous-attempt");
});

test.each([Infinity, NaN, -1, 2_147_483_648])("invalid persisted price %p cannot open a transaction or create final files", async (price) => {
  const db = database();
  await expect(persistOrder(db as any, { ...customer, price })).rejects.toMatchObject({ statusCode: 400, code: "PRICE_OUT_OF_RANGE" });
  expect(db.$transaction).not.toHaveBeenCalled();
  expect(fs.existsSync(path.join(directory, "uploads"))).toBe(false);
});
