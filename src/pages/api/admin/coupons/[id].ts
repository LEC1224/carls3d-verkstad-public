import type { NextApiRequest, NextApiResponse } from "next";
import { PrismaClient } from "@prisma/client";
import { requireAdmin } from "../../../../lib/adminAuth";

const prisma = new PrismaClient();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireAdmin(req, res)) return;

  const id = Number(req.query.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Ogiltigt rabattkods-ID." });

  if (req.method === "DELETE") {
    await prisma.coupon.delete({ where: { id } });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Endast DELETE stöds." });
}
