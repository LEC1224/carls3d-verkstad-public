import {
  applyDeliveryToBreakdown,
  normalizeDeliveryMethod,
  priceBeforeCouponForDelivery,
} from "../src/lib/delivery";

test("pickup removes shipping from a calculated order", () => {
  const breakdown = {
    materialCost: 50,
    baseFee: 50,
    fileFee: 10,
    shipping: 66,
    total: 176,
  };

  expect(applyDeliveryToBreakdown(breakdown, "pickup")).toEqual({
    materialCost: 50,
    baseFee: 50,
    fileFee: 10,
    shipping: 0,
    total: 110,
  });
});

test("shipping leaves a calculated order unchanged", () => {
  const breakdown = { shipping: 66, total: 176 };
  expect(applyDeliveryToBreakdown(breakdown, "shipping")).toEqual(breakdown);
});

test("pickup removes the included shipping from fixed-price products", () => {
  expect(priceBeforeCouponForDelivery(500, 60, "pickup")).toBe(440);
  expect(priceBeforeCouponForDelivery(300, 60, "pickup")).toBe(240);
  expect(priceBeforeCouponForDelivery(500, 60, "shipping")).toBe(500);
});

test("unknown delivery values safely default to shipping", () => {
  expect(normalizeDeliveryMethod("pickup")).toBe("pickup");
  expect(normalizeDeliveryMethod("anything-else")).toBe("shipping");
});
