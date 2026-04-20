import type { NextApiRequest, NextApiResponse } from "next";
import { PrismaClient } from "@prisma/client";
import { requireAdmin } from "../../../lib/adminAuth";
import { clampPercent, normalizeCouponCode } from "../../../lib/coupons";

const prisma = new PrismaClient();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireAdmin(req, res)) return;

  if (req.method === "GET") {
    const coupons = await prisma.coupon.findMany({ orderBy: { code: "asc" } });
    return res.status(200).json(coupons);
  }

  if (req.method === "POST") {
    const code = normalizeCouponCode(req.body?.code);
    if (!code) return res.status(400).json({ error: "Rabattkod krävs." });

    try {
      const coupon = await prisma.coupon.create({
        data: {
          code,
          overallPercent: clampPercent(req.body?.overallPercent),
          plasticPercent: clampPercent(req.body?.plasticPercent),
          removeStartFee: Boolean(req.body?.removeStartFee),
          removeExtraFileFee: Boolean(req.body?.removeExtraFileFee),
          removeShipping: Boolean(req.body?.removeShipping),
        },
      });
      return res.status(201).json(coupon);
    } catch (e: any) {
      if (String(e?.code) === "P2002") return res.status(409).json({ error: "Rabattkoden finns redan." });
      console.error("coupon create error:", e);
      return res.status(500).json({ error: "Kunde inte skapa rabattkod." });
    }
  }

  return res.status(405).json({ error: "GET/POST stöds." });
}
