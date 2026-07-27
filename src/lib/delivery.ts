export type DeliveryMethod = "shipping" | "pickup";

export const LITHOPHANE_SHIPPING_COST = 132;
export const MINECRAFT_TORCH_SHIPPING_COST = 88;

export function normalizeDeliveryMethod(value: unknown): DeliveryMethod {
  return String(value).trim().toLowerCase() === "pickup" ? "pickup" : "shipping";
}

export function priceBeforeCouponForDelivery(
  priceIncludingShipping: number,
  shippingCost: number,
  deliveryMethod: DeliveryMethod
) {
  return deliveryMethod === "pickup"
    ? Math.max(0, priceIncludingShipping - shippingCost)
    : priceIncludingShipping;
}

export function applyDeliveryToBreakdown<
  T extends { total: number; shipping: number }
>(breakdown: T, deliveryMethod: DeliveryMethod): T {
  if (deliveryMethod === "shipping") return breakdown;

  return {
    ...breakdown,
    shipping: 0,
    total: Math.max(0, breakdown.total - breakdown.shipping),
  };
}
