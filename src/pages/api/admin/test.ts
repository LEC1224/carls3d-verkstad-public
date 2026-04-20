// src/pages/api/admin/test.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { PrismaClient } from "@prisma/client";
import { nanoid } from "nanoid";
import { notifyOrder } from "../../../lib/notify";
import { requireAdmin } from "../../../lib/adminAuth";

const prisma = new PrismaClient();

function makeOrderNumber(id: number, createdAt: Date, name: string): string {
  const year = createdAt.getFullYear();
  const padded = id.toString().padStart(6, "0");
  const cleanName =
    (name || "KUND").toUpperCase().replace(/[^A-ZÅÄÖ]/g, "").slice(0, 12) || "KUND";
  return `SP-${year}-${padded}-${cleanName}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireAdmin(req, res)) return;

  try {
    // --- Create a minimal test order in DB (matching your current Order model) ---
    const tempOrderNumber = `TMP-${Date.now()}-${nanoid(6)}`;
    let created = await prisma.order.create({
      data: {
        orderNumber: tempOrderNumber, // required + unique in your schema
        name: "Test Beställning",
        email: "test@example.com",
        type: "standard",
        price: 123,               // dummy total
        status: "Ny",
        addressLine1: "Exempelgatan 1",
        postalCode: "12345",
        city: "Göteborg",
        country: "Sverige",
      },
    });

    // Create a couple of dummy file rows with tokens
    const items = [
      { filename: "test1.stl", token: nanoid(10), material: "PLA", color: "vit", copies: 1, gramsEach: 15 },
      { filename: "test2.obj", token: nanoid(10), material: "ASA", color: "svart", copies: 2, gramsEach: 22 },
    ];
    await prisma.orderFile.createMany({
      data: items.map((it) => ({ orderId: created.id, filename: it.filename, token: it.token })),
    });

    // Pretty order number after we know the ID
    const orderNumber = makeOrderNumber(created.id, created.createdAt, "Test Beställning");
    created = await prisma.order.update({
      where: { id: created.id },
      data: { orderNumber },
    });

    // --- Send Discord notification using the new signature (no top-level material/color) ---
    await notifyOrder({
      id: created.id,
      orderNumber,
      name: "Test Beställning",
      email: "test@example.com",
      type: "standard",
      price: 123,
      addressLine1: "Exempelgatan 1",
      postalCode: "12345",
      city: "Göteborg",
      country: "Sverige",
      items, // [{ filename, token, material, color, copies, gramsEach }]
    });

    return res.status(200).json({ ok: true, id: created.id, orderNumber });
  } catch (e: any) {
    console.error("admin test error:", e);
    return res.status(500).json({ error: "Test misslyckades" });
  }
}
