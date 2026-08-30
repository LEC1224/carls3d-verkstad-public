import type { NextApiRequest, NextApiResponse } from "next";
import { PrismaClient } from "@prisma/client";
import { requireAdmin } from "../../../../lib/adminAuth";

const prisma = new PrismaClient();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== "PATCH") return res.status(405).json({ error: "PATCH stöds." });

  const id = Number(req.query.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "Ogiltigt id." });
  }

  const existing = await prisma.travelPeriod.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: "Bortresan hittades inte." });
  if (existing.cancelledAt) return res.status(200).json(existing);

  const period = await prisma.travelPeriod.update({
    where: { id },
    data: { cancelledAt: new Date() },
  });
  return res.status(200).json(period);
}
