import { RequestError } from "./requestErrors";

export const MAX_ORDER_PRICE = 2_147_483_647;

function invalidPrice(): never {
  throw new RequestError(
    "Kunde inte beräkna ett giltigt pris. Kontrollera modellens mått och antal kopior, eller kontakta info@carls3d.se.",
    400,
    "PRICE_OUT_OF_RANGE"
  );
}

/** Prisma Int amounts must remain nonnegative whole kronor within the signed 32-bit range. */
export function validateOrderAmount(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_ORDER_PRICE) invalidPrice();
}

function validateNumericComponents(value: unknown) {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) invalidPrice();
  } else if (value && typeof value === "object") {
    for (const component of Object.values(value)) validateNumericComponents(component);
  }
}

export function validatePriceBreakdown(breakdown: {
  total: number;
  totalBeforeDiscount?: number;
  coupon?: { discount: number };
}) {
  // Check every nested numerical component: JSON would otherwise silently turn NaN/Infinity into null.
  validateNumericComponents(breakdown);
  validateOrderAmount(breakdown.total);
  if (breakdown.totalBeforeDiscount !== undefined) validateOrderAmount(breakdown.totalBeforeDiscount);
  if (breakdown.coupon) validateOrderAmount(breakdown.coupon.discount);
}
