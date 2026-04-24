import type { NextApiRequest, NextApiResponse } from "next";
import { PrismaClient } from "@prisma/client";
import { applyFixedCoupon } from "../../lib/coupons";
import { requireValidCoupon } from "../../lib/couponServer";

const prisma = new PrismaClient();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Endast POST stöds." });

  try {
    const price = Number(req.body?.price);
    const startFee = Number(req.body?.startFee || 0);
    const allowStartFeeRemoval = Boolean(req.body?.allowStartFeeRemoval);
    const couponCode = String(req.body?.couponCode || "");

    if (!Number.isFinite(price) || price < 0) {
      return res.status(400).json({ error: "Ogiltigt pris." });
    }

    const coupon = await requireValidCoupon(prisma, couponCode);
    const discounted = applyFixedCoupon(price, coupon, {
      startFee: Number.isFinite(startFee) ? startFee : 0,
      allowStartFeeRemoval,
    });

    return res.status(200).json({
      price: discounted.price,
      discount: discounted.discount,
      coupon: discounted.coupon || null,
    });
  } catch (err: any) {
    return res.status(err?.statusCode || 500).json({
      error: err?.statusCode ? err.message : "Kunde inte tillämpa rabattkod.",
    });
  }
}
