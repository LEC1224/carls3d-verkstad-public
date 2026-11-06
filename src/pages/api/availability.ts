import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../lib/prisma";
import { ALL_COLORS } from "../../lib/colors";
import { SUPPORTED_MATERIALS } from "../../lib/validation";


export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Endast GET stöds." });
  }
  const material = String(req.query.material || "PLA").toUpperCase();
  if (!(SUPPORTED_MATERIALS as readonly string[]).includes(material)) {
    return res.status(400).json({ error: "Välj ett giltigt material." });
  }
  try {
    const rows = await prisma.inventory.findMany({
      where: { material },
    });
    // If no rows yet for this material, assume all colors are available by default:
    const map = new Map(rows.map(r => [r.color, r.available]));
    const list = ALL_COLORS.filter(c => map.size === 0 ? true : (map.get(c.value) ?? false));
    res.status(200).json(list);
  } catch (e: any) {
    console.error("availability error:", e);
    res.status(500).json({ error: "Kunde inte hämta tillgängliga färger." });
  }
}
