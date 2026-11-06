jest.mock("../src/lib/prisma", () => ({ prisma: { inventory: { findMany: jest.fn(async () => []) } } }));
jest.mock("../src/lib/uploads");
jest.mock("../src/lib/persistOrder");
jest.mock("../src/lib/estimation", () => ({ estimateFromFile: jest.fn(() => ({ grams: 10, source: "pseudo", volumeMm3: 1000 })) }));
jest.mock("../src/lib/imageValidation", () => ({ validateImageUpload: jest.fn() }));
jest.mock("../src/lib/priceCalculationLog", () => ({ logPriceCalculation: jest.fn() }));
jest.mock("../src/lib/orderWorkflow", () => ({ fulfillOrder: jest.fn(async () => {}) }));
jest.mock("fs", () => ({ ...jest.requireActual("fs"), writeFileSync: jest.fn() }));

import standard from "../src/pages/api/order";
import lamp from "../src/pages/api/lithophane";
import torch from "../src/pages/api/minecraft-torch";
import { parseUpload, uploadedFiles } from "../src/lib/uploads";
import { persistOrder } from "../src/lib/persistOrder";
import { fulfillOrder } from "../src/lib/orderWorkflow";

const customer = { name: "Release Test", email: "release@example.invalid", phone: "0700000000", deliveryMethod: "pickup" };
const cleanup = jest.fn(async () => {});

beforeEach(() => {
  jest.clearAllMocks();
  (parseUpload as jest.Mock).mockResolvedValue({ fields: { ...customer, itemsMeta: JSON.stringify([{ material: "PLA", color: "white", copies: 3, purpose: "functional" }]) }, files: {}, cleanup });
  (persistOrder as jest.Mock).mockImplementation(async (_prisma, data, files = []) => ({
    order: { ...data, id: 123, orderNumber: "SP-2026-000123-RELEASE" },
    finalFiles: files.map((file: any, index: number) => ({ filename: `saved-${index}-${file.originalFilename}`, token: `token-${index}` })),
  }));
});

test.each([
  ["standard", standard, [{ originalFilename: "part.stl" }]],
  ["lithophane", lamp, Array.from({ length: 4 }, (_, index) => ({ originalFilename: `photo-${index}.png` }))],
  ["minecraft-torch", torch, []],
] as const)("%s checkout forwards the committed order to the existing fulfillment workflow", async (type, handler, files) => {
  (uploadedFiles as jest.Mock).mockReturnValue(files);
  const res = { status: jest.fn(), json: jest.fn(), setHeader: jest.fn() };
  res.status.mockReturnValue(res);
  await handler({ method: "POST", body: { ...customer, quantity: 2 } } as any, res as any);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(fulfillOrder).toHaveBeenCalledTimes(1);
  const payload = (fulfillOrder as jest.Mock).mock.calls[0][0];
  expect(payload).toMatchObject({ id: 123, orderNumber: "SP-2026-000123-RELEASE", type, discount: 0, couponCode: null, deliveryMethod: "pickup" });
  expect(payload.price).toBe((persistOrder as jest.Mock).mock.calls[0][1].price);
  if (type === "standard") expect(payload.items[0]).toMatchObject({ filename: "saved-0-part.stl", copies: 3, purpose: "functional", material: "PLA", color: "white" });
  if (type === "lithophane") expect(payload.items).toHaveLength(4);
  if (type === "minecraft-torch") expect(payload.items[0]).toMatchObject({ copies: 2, token: "TORCH" });
  if (type !== "minecraft-torch") expect(cleanup).toHaveBeenCalledTimes(1);
});
