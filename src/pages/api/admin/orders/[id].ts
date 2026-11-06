import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../../../lib/prisma";
import { requireAdmin } from "../../../../lib/adminAuth";


export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireAdmin(req, res)) return;

  const id = Number(req.query.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Ogiltigt order-ID" });

  try {
    if (req.method === "PATCH") {
      // markera som klar
      const updated = await prisma.order.update({
        where: { id },
        data: { status: "Klar" },
      });
      return res.status(200).json(updated);
    }

    if (req.method === "DELETE") {
      // radera order + filer (onDelete: Cascade i schema hanterar relation)
      await prisma.order.delete({ where: { id } });
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "PATCH, DELETE");
    return res.status(405).json({ error: "Endast PATCH/DELETE stöds." });
  } catch (e: any) {
    if (e?.code === "P2025") return res.status(404).json({ error: "Beställningen hittades inte." });
    console.error("admin order mutation error:", e);
    return res.status(500).json({ error: "Kunde inte uppdatera/radera order." });
  }
}
