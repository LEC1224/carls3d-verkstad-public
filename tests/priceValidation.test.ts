import { MAX_ORDER_PRICE, validateOrderAmount, validatePriceBreakdown } from "../src/lib/priceValidation";
import { priceCartBreakdown } from "../src/lib/pricing";

test.each([0, 100, MAX_ORDER_PRICE])("accepts a persistable whole-krona amount: %p", (price) => {
  expect(() => validateOrderAmount(price)).not.toThrow();
});

test.each([NaN, Infinity, -Infinity, -1, 0.5, MAX_ORDER_PRICE + 1, "100", null])("rejects an unpersistable amount: %p", (price) => {
  expect(() => validateOrderAmount(price)).toThrow("giltigt pris");
});

test("ordinary pricing stays valid without changing its result", () => {
  const breakdown = priceCartBreakdown([{ index: 0, name: "part.stl", material: "PLA", color: "white", copies: 3, gramsEach: 12.4 }], 1);
  const original = JSON.stringify(breakdown);
  expect(() => validatePriceBreakdown(breakdown)).not.toThrow();
  expect(JSON.stringify(breakdown)).toBe(original);
});

test("finite individual model weights cannot overflow a multi-file quote", () => {
  const breakdown = priceCartBreakdown(Array.from({ length: 20 }, (_, index) => ({ index, name: "huge.obj", material: "TPU", color: "white", copies: 999, gramsEach: 6.3e303 })), 20);
  expect(Number.isFinite(breakdown.total)).toBe(false);
  expect(() => validatePriceBreakdown(breakdown)).toThrow("giltigt pris");
});

test.each([
  { total: 100, grams: Infinity },
  { total: 100, items: [{ gramsEach: NaN }] },
  { total: 100, shipping: -1 },
  { total: 0, totalBeforeDiscount: MAX_ORDER_PRICE + 1 },
  { total: 0, coupon: { discount: MAX_ORDER_PRICE + 1 } },
  { total: 0, coupon: { discount: 100, parts: { plastic: Infinity } } },
])("rejects invalid components even when the final total looks valid: %p", (breakdown) => {
  expect(() => validatePriceBreakdown(breakdown)).toThrow("giltigt pris");
});
