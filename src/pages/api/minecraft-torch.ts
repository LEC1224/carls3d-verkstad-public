import type { NextApiRequest, NextApiResponse } from "next";
import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";
import { notifyOrder } from "../../lib/notify";
import { applyFixedCoupon } from "../../lib/coupons";
import { requireValidCoupon } from "../../lib/couponServer";
import {
  MINECRAFT_TORCH_SHIPPING_COST,
  normalizeDeliveryMethod,
  priceBeforeCouponForDelivery,
} from "../../lib/delivery";

const prisma = new PrismaClient();
const BASE_PRICE = 100;
const PRICE_PER_TORCH = 200;

function ensureUploadsDir(dir = "./uploads") {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function makeOrderNumber(id: number, createdAt: Date, name: string): string {
  const year = createdAt.getFullYear();
  const padded = id.toString().padStart(6, "0");
  const cleanName = (name || "KUND").toUpperCase().replace(/[^A-ZÅÄÖ]/g, "").slice(0, 12) || "KUND";
  return `SP-${year}-${padded}-${cleanName}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Endast POST stöds." });

  try {
    const {
      name = "",
      email = "",
      quantity,
      addressLine1 = "",
      addressLine2 = "",
      postalCode = "",
      city = "",
      country = "Sverige",
      phone = "",
      couponCode = "",
      deliveryMethod: requestedDeliveryMethod = "shipping",
    } = req.body ?? {};

    const cleanName = String(name).trim();
    const cleanEmail = String(email).trim();
    const deliveryMethod = normalizeDeliveryMethod(requestedDeliveryMethod);
    const cleanAddressLine1 = deliveryMethod === "pickup" ? "" : String(addressLine1).trim();
    const cleanAddressLine2 =
      deliveryMethod === "pickup" ? null : String(addressLine2).trim() || null;
    const cleanPostalCode = deliveryMethod === "pickup" ? "" : String(postalCode).trim();
    const cleanCity = deliveryMethod === "pickup" ? "" : String(city).trim();
    const cleanCountry =
      deliveryMethod === "pickup" ? "" : String(country).trim() || "Sverige";
    const cleanPhone = String(phone).trim() || null;
    const cleanQuantity = Math.max(1, parseInt(String(quantity || "1"), 10));

    if (!cleanName || !cleanEmail || !cleanPhone) {
      return res.status(400).json({ error: "Fyll i namn, e-post och telefon." });
    }
    if (deliveryMethod === "shipping" && (!cleanAddressLine1 || !cleanPostalCode || !cleanCity)) {
      return res.status(400).json({ error: "Fyll i adress, postnummer och ort för leveransen." });
    }

    if (!Number.isInteger(cleanQuantity) || cleanQuantity < 1) {
      return res.status(400).json({ error: "Ange minst 1 fackla." });
    }

    const coupon = await requireValidCoupon(prisma, couponCode);
    const originalPrice = BASE_PRICE + cleanQuantity * PRICE_PER_TORCH;
    const priceBeforeCoupon = priceBeforeCouponForDelivery(
      originalPrice,
      MINECRAFT_TORCH_SHIPPING_COST,
      deliveryMethod
    );
    const discounted = applyFixedCoupon(priceBeforeCoupon, coupon, { startFee: BASE_PRICE, allowStartFeeRemoval: true });
    const price = discounted.price;
    const tempOrderNumber = `TMP-${Date.now()}-${nanoid(6)}`;

    const created = await prisma.order.create({
      data: {
        orderNumber: tempOrderNumber,
        name: cleanName,
        email: cleanEmail,
        type: "minecraft-torch",
        price,
        discount: discounted.discount,
        couponCode: discounted.coupon?.code || null,
        status: "Ny",
        deliveryMethod,
        addressLine1: cleanAddressLine1,
        addressLine2: cleanAddressLine2,
        postalCode: cleanPostalCode,
        city: cleanCity,
        country: cleanCountry,
        phone: cleanPhone,
      },
    });

    const orderNumber = makeOrderNumber(created.id, created.createdAt, cleanName);
    const order = await prisma.order.update({ where: { id: created.id }, data: { orderNumber } });

    await notifyOrder({
      id: order.id,
      orderNumber,
      name: cleanName,
      email: cleanEmail,
      type: "minecraft-torch",
      price,
      deliveryMethod,
      addressLine1: cleanAddressLine1,
      addressLine2: cleanAddressLine2,
      postalCode: cleanPostalCode,
      city: cleanCity,
      country: cleanCountry,
      phone: cleanPhone,
      items: [
        {
          filename: `Minecraft Torch x${cleanQuantity}`,
          token: "TORCH",
          material: "PLA",
          color: "mix",
          copies: cleanQuantity,
          gramsEach: 0,
        },
      ],
    });

    try {
      ensureUploadsDir();
      const lines: string[] = [];
      lines.push(`Order: ${orderNumber}`);
      lines.push(`Namn: ${cleanName}`);
      lines.push(`E-post: ${cleanEmail}`);
      lines.push(`Leveranssätt: ${deliveryMethod === "pickup" ? "Hämtas hos mig" : "PostNord"}`);
      if (deliveryMethod === "shipping") {
        lines.push(
          `Adress: ${cleanAddressLine1}${cleanAddressLine2 ? ", " + cleanAddressLine2 : ""}, ${cleanPostalCode} ${cleanCity}, ${cleanCountry}`
        );
      }
      lines.push(`Telefon: ${cleanPhone ?? "-"}`);
      lines.push("");
      lines.push("Produkt:");
      lines.push(`- Väggmonterad Minecraft-fackla × ${cleanQuantity}`);
      lines.push("");
      lines.push(`Startavgift: ${BASE_PRICE} kr`);
      lines.push(`Styckpris: ${PRICE_PER_TORCH} kr`);
      lines.push(
        deliveryMethod === "pickup"
          ? `Fraktavdrag: -${MINECRAFT_TORCH_SHIPPING_COST} kr`
          : `Frakt (ingår i priset): ${MINECRAFT_TORCH_SHIPPING_COST} kr`
      );
      if (discounted.coupon) {
        lines.push(`Rabattkod: ${discounted.coupon.code}`);
        lines.push(`Rabatt: -${discounted.discount} kr`);
        lines.push(`Ordinarie total: ${originalPrice} kr`);
      }
      lines.push(`Totalt: ${price} kr`);
      fs.writeFileSync(path.join("./uploads", `${orderNumber}.txt`), lines.join("\n"), "utf8");
    } catch (e) {
      console.error("Kunde inte skriva TXT-kvitto (minecraft-torch):", e);
    }

    return res.status(200).json({ success: true, id: order.id, orderNumber, price });
  } catch (err: any) {
    console.error("API /minecraft-torch error:", err);
    return res.status(err?.statusCode || 500).json({
      error: err?.statusCode
        ? err.message
        : "Något gick fel vid beställning. Mejla gärna info@carls3d.se så hjälper vi dig.",
      details: process.env.NODE_ENV === "development" ? String(err?.message || err) : undefined,
    });
  }
}
