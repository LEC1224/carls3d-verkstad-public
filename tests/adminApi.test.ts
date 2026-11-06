jest.mock("../src/lib/prisma", () => ({ prisma: {
  inventory: { upsert: jest.fn(), findMany: jest.fn() },
  order: { update: jest.fn(), delete: jest.fn() },
  coupon: { delete: jest.fn() },
  $transaction: jest.fn(),
} }));
jest.mock("../src/lib/adminAuth", () => ({ requireAdmin: jest.fn(() => true) }));

import { prisma } from "../src/lib/prisma";
import inventoryHandler from "../src/pages/api/admin/inventory";
import orderHandler from "../src/pages/api/admin/orders/[id]";
import couponHandler from "../src/pages/api/admin/coupons/[id]";
import { ALL_COLORS } from "../src/lib/colors";

function response() {
  const res = { status: jest.fn(), json: jest.fn(), setHeader: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
}
beforeEach(() => { jest.clearAllMocks(); });

test.each([0, -1, 1.5, "abc"])("invalid order IDs return 400 without touching the database: %p", async (id) => {
  const res = response();
  await orderHandler({ method: "PATCH", query: { id } } as any, res as any);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(prisma.order.update).not.toHaveBeenCalled();
});

test("a vanished order returns 404", async () => {
  (prisma.order.update as jest.Mock).mockRejectedValue({ code: "P2025" });
  const res = response();
  await orderHandler({ method: "PATCH", query: { id: "1" } } as any, res as any);
  expect(res.status).toHaveBeenCalledWith(404);
});

test("a vanished coupon returns 404", async () => {
  (prisma.coupon.delete as jest.Mock).mockRejectedValue({ code: "P2025" });
  const res = response();
  await couponHandler({ method: "DELETE", query: { id: "1" } } as any, res as any);
  expect(res.status).toHaveBeenCalledWith(404);
});

test.each([
  { material: "GOLD", color: "white", available: true },
  { material: "PLA", color: "unknown", available: true },
  { material: "PLA", color: "white", available: "false" },
])("invalid inventory updates do not create unusable rows: %p", async (body) => {
  const res = response();
  await inventoryHandler({ method: "POST", body } as any, res as any);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(prisma.inventory.upsert).not.toHaveBeenCalled();
});

test("bulk inventory updates use a transaction", async () => {
  (prisma.$transaction as jest.Mock).mockResolvedValue([]);
  const res = response();
  await inventoryHandler({ method: "PUT", body: { material: "PLA", colorsAvailable: [] } } as any, res as any);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(prisma.$transaction).toHaveBeenCalledTimes(1);
});

test("the first single-color toggle preserves all other default-available colors", async () => {
  const upsert = jest.fn(async ({ create }) => create);
  (prisma.$transaction as jest.Mock).mockImplementation(async (callback) => callback({
    inventory: { findFirst: jest.fn(async () => null), upsert },
  }));
  const res = response();
  await inventoryHandler({ method: "POST", body: { material: "PLA", color: "white", available: false } } as any, res as any);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(upsert).toHaveBeenCalledTimes(ALL_COLORS.length);
  const saved = upsert.mock.calls.map(([input]) => input.create);
  expect(saved.find((row) => row.color === "white").available).toBe(false);
  expect(saved.filter((row) => row.color !== "white").every((row) => row.available)).toBe(true);
});

test("a later single-color toggle preserves existing configured inventory", async () => {
  const upsert = jest.fn(async ({ create }) => create);
  (prisma.$transaction as jest.Mock).mockImplementation(async (callback) => callback({
    inventory: { findFirst: jest.fn(async () => ({ id: 1 })), upsert },
  }));
  const res = response();
  await inventoryHandler({ method: "POST", body: { material: "PLA", color: "white", available: false } } as any, res as any);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(upsert).toHaveBeenCalledTimes(1);
});
