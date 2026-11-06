import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../../lib/prisma";
import { ALL_COLORS } from "../../../lib/colors";
import { requireAdmin } from "../../../lib/adminAuth";
import { SUPPORTED_MATERIALS } from "../../../lib/validation";


export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireAdmin(req, res)) return;

  try {
    if (req.method === "GET") {
      // list whole inventory (grouped by material)
      const rows = await prisma.inventory.findMany();
      return res.status(200).json(rows);
    }

    if (req.method === "POST") {
      const { material, color, available } = req.body || {};
      if (typeof material !== "string" || typeof color !== "string" || typeof available !== "boolean") {
        return res.status(400).json({ error: "material, color och available krävs" });
      }
      if (!(SUPPORTED_MATERIALS as readonly string[]).includes(material.toUpperCase()) || !ALL_COLORS.some((option) => option.value === color)) {
        return res.status(400).json({ error: "Välj ett giltigt material och en giltig färg." });
      }
      const mat = material.toUpperCase();
      const up = await prisma.$transaction(async (tx) => {
        const existing = await tx.inventory.findFirst({ where: { material: mat }, select: { id: true } });
        // With no saved rows, the storefront exposes all colors. Preserve those defaults on the first toggle.
        if (!existing) {
          for (const option of ALL_COLORS) {
            if (option.value === color) continue;
            await tx.inventory.upsert({
              where: { material_color: { material: mat, color: option.value } },
              update: {},
              create: { material: mat, color: option.value, available: true },
            });
          }
        }
        return tx.inventory.upsert({
          where: { material_color: { material: mat, color } },
          update: { available },
          create: { material: mat, color, available },
        });
      });
      return res.status(200).json(up);
    }

    if (req.method === "PUT") {
      // bulk set for one material: body { material, colorsAvailable: string[] }
      const { material, colorsAvailable } = req.body || {};
      if (typeof material !== "string" || !Array.isArray(colorsAvailable)) {
        return res.status(400).json({ error: "material och colorsAvailable[] krävs" });
      }
      const mat = material.toUpperCase();
      if (!(SUPPORTED_MATERIALS as readonly string[]).includes(mat) || colorsAvailable.some((color) => !ALL_COLORS.some((option) => option.value === color))) {
        return res.status(400).json({ error: "Välj ett giltigt material och giltiga färger." });
      }
      // A bulk update must either save every color or leave the inventory unchanged.
      await prisma.$transaction(
        ALL_COLORS.map(c =>
          prisma.inventory.upsert({
            where: { material_color: { material: mat, color: c.value } },
            update: { available: colorsAvailable.includes(c.value) },
            create: { material: mat, color: c.value, available: colorsAvailable.includes(c.value) },
          })
        )
      );
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, POST, PUT");
    return res.status(405).json({ error: "GET/POST/PUT stöds." });
  } catch (error) {
    console.error("inventory error:", error);
    return res.status(500).json({ error: "Kunde inte läsa eller uppdatera färglagret." });
  }
}
