import type { Coupon } from "@prisma/client";

export type CouponInput = Pick<
  Coupon,
  "code" | "overallPercent" | "plasticPercent" | "removeStartFee" | "removeExtraFileFee" | "removeShipping"
>;

export type CouponDiscount = {
  code: string;
  discount: number;
  totalBeforeDiscount: number;
  totalAfterDiscount: number;
  parts: {
    overall: number;
    plastic: number;
    startFee: number;
    extraFileFee: number;
    shipping: number;
  };
};

export function normalizeCouponCode(code: unknown) {
  return String(code || "").trim().toUpperCase();
}

export function clampPercent(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n)));
}

export function applyStandardCoupon<
  T extends { total: number; materialCost: number; baseFee: number; fileFee: number; shipping: number }
>(breakdown: T, coupon: CouponInput | null): T & { coupon?: CouponDiscount; totalBeforeDiscount: number } {
  if (!coupon) return { ...breakdown, totalBeforeDiscount: breakdown.total };

  const plastic = Math.round(breakdown.materialCost * (coupon.plasticPercent / 100));
  const startFee = coupon.removeStartFee ? breakdown.baseFee : 0;
  const extraFileFee = coupon.removeExtraFileFee ? breakdown.fileFee : 0;
  const shipping = coupon.removeShipping ? breakdown.shipping : 0;
  const afterParts = Math.max(0, breakdown.total - plastic - startFee - extraFileFee - shipping);
  const overall = Math.round(afterParts * (coupon.overallPercent / 100));
  const discount = Math.min(breakdown.total, plastic + startFee + extraFileFee + shipping + overall);
  const totalAfterDiscount = Math.max(0, breakdown.total - discount);

  return {
    ...breakdown,
    total: totalAfterDiscount,
    totalBeforeDiscount: breakdown.total,
    coupon: {
      code: coupon.code,
      discount,
      totalBeforeDiscount: breakdown.total,
      totalAfterDiscount,
      parts: { overall, plastic, startFee, extraFileFee, shipping },
    },
  };
}

export function applyFixedCoupon(
  price: number,
  coupon: CouponInput | null,
  options: { startFee?: number; allowStartFeeRemoval?: boolean } = {}
) {
  if (!coupon) return { price, discount: 0, coupon: undefined as CouponDiscount | undefined };

  const startFee = options.allowStartFeeRemoval && coupon.removeStartFee ? options.startFee || 0 : 0;
  const afterStartFee = Math.max(0, price - startFee);
  const overall = Math.round(afterStartFee * (coupon.overallPercent / 100));
  const discount = Math.min(price, startFee + overall);
  const totalAfterDiscount = Math.max(0, price - discount);

  return {
    price: totalAfterDiscount,
    discount,
    coupon: {
      code: coupon.code,
      discount,
      totalBeforeDiscount: price,
      totalAfterDiscount,
      parts: { overall, plastic: 0, startFee, extraFileFee: 0, shipping: 0 },
    },
  };
}
