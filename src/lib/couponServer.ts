import type { PrismaClient } from "@prisma/client";
import { normalizeCouponCode } from "./coupons";

export async function findCouponByCode(prisma: PrismaClient, code: unknown) {
  const normalized = normalizeCouponCode(code);
  if (!normalized) return null;
  return prisma.coupon.findUnique({ where: { code: normalized } });
}

export async function requireValidCoupon(prisma: PrismaClient, code: unknown) {
  const normalized = normalizeCouponCode(code);
  if (!normalized) return null;

  const coupon = await findCouponByCode(prisma, normalized);
  if (!coupon) {
    const error = new Error("Rabattkoden är inte giltig.");
    (error as any).statusCode = 400;
    throw error;
  }

  return coupon;
}
