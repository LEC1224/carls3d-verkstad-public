import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../lib/prisma";
import fs from "fs";
import path from "path";
import { persistOrder } from "../../lib/persistOrder";
import { parseCustomer, positiveQuantity, singleField } from "../../lib/orderValidation";
import { publicError } from "../../lib/requestErrors";
import { MAX_TORCH_QUANTITY } from "../../lib/validation";
import { notifyOrder } from "../../lib/notify";
import { applyFixedCoupon } from "../../lib/coupons";
import { requireValidCoupon } from "../../lib/couponServer";
import {
  MINECRAFT_TORCH_SHIPPING_COST,
  priceBeforeCouponForDelivery,
} from "../../lib/delivery";

const BASE_PRICE = 100;
const PRICE_PER_TORCH = 200;

function ensureUploadsDir(dir = "./uploads") {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Endast POST stöds." });
  }

  try {
    const customer = parseCustomer(req.body ?? {});
    const {
      name: cleanName, email: cleanEmail, phone: cleanPhone, deliveryMethod,
      addressLine1: cleanAddressLine1, addressLine2: cleanAddressLine2,
      postalCode: cleanPostalCode, city: cleanCity, country: cleanCountry,
    } = customer;
    const cleanQuantity = positiveQuantity(req.body?.quantity ?? 1, MAX_TORCH_QUANTITY, "antal facklor");
    const coupon = await requireValidCoupon(prisma, singleField(req.body?.couponCode, "rabattkod"));
    const originalPrice = BASE_PRICE + cleanQuantity * PRICE_PER_TORCH;
    const priceBeforeCoupon = priceBeforeCouponForDelivery(
      originalPrice,
      MINECRAFT_TORCH_SHIPPING_COST,
      deliveryMethod
    );
    const discounted = applyFixedCoupon(priceBeforeCoupon, coupon, { startFee: BASE_PRICE, allowStartFeeRemoval: true });
    const price = discounted.price;
    const { order } = await persistOrder(prisma, {
      ...customer, type: "minecraft-torch", price, discount: discounted.discount,
      couponCode: discounted.coupon?.code || null, status: "Ny",
    });
    const { orderNumber } = order;

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
  } catch (error) {
    console.error("API /minecraft-torch error:", error);
    const response = publicError(error, "Något gick fel vid beställning. Mejla gärna info@carls3d.se så hjälper vi dig.");
    return res.status(response.status).json({ error: response.error });
  }
}
