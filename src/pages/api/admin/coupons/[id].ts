import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../../../lib/prisma";
import { requireAdmin } from "../../../../lib/adminAuth";


export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireAdmin(req, res)) return;

  const id = Number(req.query.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Ogiltigt rabattkods-ID." });

  if (req.method === "DELETE") {
    try {
      await prisma.coupon.delete({ where: { id } });
      return res.status(200).json({ ok: true });
    } catch (error) {
      if ((error as any)?.code === "P2025") return res.status(404).json({ error: "Rabattkoden hittades inte." });
      console.error("coupon delete error:", error);
      return res.status(500).json({ error: "Kunde inte radera rabattkoden." });
    }
  }

  res.setHeader("Allow", "DELETE");
  return res.status(405).json({ error: "Endast DELETE stöds." });
}
