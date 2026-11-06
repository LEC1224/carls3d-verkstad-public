jest.mock("../src/lib/prisma", () => ({ prisma: { inventory: { findMany: jest.fn(async () => []) } } }));
jest.mock("../src/lib/uploads");
jest.mock("../src/lib/estimation");
jest.mock("../src/lib/priceCalculationLog", () => ({ logPriceCalculation: jest.fn() }));

import handler from "../src/pages/api/quote";
import { parseUpload, uploadedFiles } from "../src/lib/uploads";
import { estimateFromFile } from "../src/lib/estimation";
import { RequestError } from "../src/lib/requestErrors";

const parse = parseUpload as jest.Mock;
const fileList = uploadedFiles as jest.Mock;
const estimate = estimateFromFile as jest.Mock;

function response() {
  const res = { status: jest.fn(), json: jest.fn(), setHeader: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
  fileList.mockReturnValue([{ filepath: "test.stl", originalFilename: "part.stl" }]);
  estimate.mockReturnValue({ source: "pseudo", grams: 10, volumeMm3: 1000 });
});
afterEach(() => { jest.restoreAllMocks(); });

test("invalid metadata returns 400 and always cleans uploaded files", async () => {
  const cleanup = jest.fn(async () => {});
  parse.mockResolvedValue({ fields: { itemsMeta: ["broken"] }, files: {}, cleanup });
  const res = response();
  await handler({ method: "POST" } as any, res as any);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(cleanup).toHaveBeenCalledTimes(1);
  expect(estimate).not.toHaveBeenCalled();
});

test("estimation failure cleans files and preserves actionable client errors", async () => {
  const cleanup = jest.fn(async () => {});
  parse.mockResolvedValue({ fields: { itemsMeta: ['[{"copies":1}]'] }, files: {}, cleanup });
  estimate.mockImplementation(() => { throw new RequestError("Ogiltig modell"); });
  const res = response();
  await handler({ method: "POST" } as any, res as any);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(res.json).toHaveBeenCalledWith({ error: "Ogiltig modell" });
  expect(cleanup).toHaveBeenCalledTimes(1);
});

test("pickup quotes retain the existing price breakdown and clean temporary files", async () => {
  const cleanup = jest.fn(async () => {});
  parse.mockResolvedValue({ fields: { itemsMeta: ['[{"copies":2,"material":"PETG","color":"black"}]'], deliveryMethod: ["pickup"] }, files: {}, cleanup });
  const res = response();
  await handler({ method: "POST" } as any, res as any);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith({ breakdown: expect.objectContaining({ shipping: 0, materialCost: 10, total: 60 }) });
  expect(cleanup).toHaveBeenCalledTimes(1);
});

test.each([Infinity, 8_370_000_000])("unpersistable model pricing %p returns a client error instead of a successful invalid quote", async (grams) => {
  const cleanup = jest.fn(async () => {});
  parse.mockResolvedValue({ fields: { itemsMeta: ['[{"copies":1,"material":"PLA","color":"white"}]'] }, files: {}, cleanup });
  estimate.mockReturnValue({ source: "volume", grams, volumeMm3: 27_000_000_000_000 });
  const res = response();
  await handler({ method: "POST" } as any, res as any);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(res.json).toHaveBeenCalledWith({ error: expect.stringContaining("giltigt pris"), code: "PRICE_OUT_OF_RANGE" });
  expect(cleanup).toHaveBeenCalledTimes(1);
});
