import type { NextApiRequest, NextApiResponse } from "next";
import fs from "fs";
import path from "path";
import { notifyOrder } from "../../lib/notify";
import { applyFixedCoupon } from "../../lib/coupons";
import { requireValidCoupon } from "../../lib/couponServer";
import { LITHOPHANE_SHIPPING_COST, priceBeforeCouponForDelivery } from "../../lib/delivery";
import { prisma } from "../../lib/prisma";
import { parseCustomer, singleField } from "../../lib/orderValidation";
import { RequestError, publicError } from "../../lib/requestErrors";
import { parseUpload, uploadedFiles } from "../../lib/uploads";
import { persistOrder } from "../../lib/persistOrder";
import { validateImageUpload } from "../../lib/imageValidation";
import { MAX_IMAGE_SIZE, LITHOPHANE_IMAGE_COUNT } from "../../lib/validation";

export const config = { api: { bodyParser: false } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Endast POST stöds." });
  }
  let upload: Awaited<ReturnType<typeof parseUpload>> | undefined;
  try {
    upload = await parseUpload(req, {
      maxFileSize: MAX_IMAGE_SIZE,
      maxTotalFileSize: MAX_IMAGE_SIZE * LITHOPHANE_IMAGE_COUNT,
      maxFiles: LITHOPHANE_IMAGE_COUNT,
    });
    const { fields, files } = upload;
    const customer = parseCustomer(fields);
    const { name, email, phone, deliveryMethod, addressLine1, addressLine2, postalCode, city, country } = customer;
    const images = uploadedFiles(files, "images");
    if (images.length !== LITHOPHANE_IMAGE_COUNT) throw new RequestError("Du måste ladda upp exakt 4 bilder.");
    images.forEach(validateImageUpload);
    const coupon = await requireValidCoupon(prisma, singleField(fields.couponCode, "rabattkod"));
    const fixedPrice = 500;
    const priceBeforeCoupon = priceBeforeCouponForDelivery(fixedPrice, LITHOPHANE_SHIPPING_COST, deliveryMethod);
    const discounted = applyFixedCoupon(priceBeforeCoupon, coupon);
    const price = discounted.price;
    const { order, finalFiles } = await persistOrder(prisma, {
      ...customer, type: "lithophane", price, discount: discounted.discount,
      couponCode: discounted.coupon?.code || null, status: "Ny",
    }, images);
    const { orderNumber } = order;
    const uploadsDir = path.resolve(process.cwd(), "uploads");

    // 4) Discord-notis (Lithophane = alltid PLA/vit)
    await notifyOrder({
      id: order.id,
      orderNumber,
      name,
      email,
      type: "lithophane",
      price,
      deliveryMethod,
      addressLine1,
      addressLine2,
      postalCode,
      city,
      country,
      phone,
      items: finalFiles.map((f) => ({
        filename: f.filename,
        token: f.token,
        material: "PLA",
        color: "vit",
        copies: 1,
        gramsEach: 0,
      })),
    });

    // 5) TXT-kvitto
    try {
      const lines: string[] = [];
      lines.push(`Order: ${orderNumber}`);
      lines.push(`Namn: ${name}`);
      lines.push(`E-post: ${email}`);
      lines.push(`Leveranssätt: ${deliveryMethod === "pickup" ? "Hämtas hos mig" : "PostNord"}`);
      if (deliveryMethod === "shipping") {
        lines.push(
          `Adress: ${addressLine1}${addressLine2 ? ", " + addressLine2 : ""}, ${postalCode} ${city}, ${country}`
        );
      }
      lines.push(`Telefon: ${phone ?? "-"}`);
      lines.push("");
      lines.push("Lithophane-bilder:");
      for (const f of finalFiles) lines.push(`- ${f.token}  ${f.filename}  —  PLA/vit`);
      lines.push("");
      lines.push(`Fast pris inkl. frakt: ${fixedPrice} kr`);
      lines.push(
        deliveryMethod === "pickup"
          ? `Fraktavdrag: -${LITHOPHANE_SHIPPING_COST} kr`
          : `Frakt (ingår i priset): ${LITHOPHANE_SHIPPING_COST} kr`
      );
      if (discounted.coupon) {
        lines.push(`Rabattkod: ${discounted.coupon.code}`);
        lines.push(`Rabatt: -${discounted.discount} kr`);
      }
      lines.push(`Totalt: ${price} kr`);
      const txtPath = path.join(uploadsDir, `${orderNumber}.txt`);
      fs.writeFileSync(txtPath, lines.join("\n"), "utf8");
    } catch (e) {
      console.error("Kunde inte skriva TXT-kvitto (lithophane):", e);
    }

    return res.status(200).json({
      success: true,
      id: order.id,
      orderNumber,
      price,
    });
  } catch (error) {
    console.error("API /lithophane error:", error);
    const response = publicError(error, "Något gick fel vid uppladdning/beställning. Mejla gärna info@carls3d.se så hjälper vi dig.");
    return res.status(response.status).json({ error: response.error });
  } finally {
    await upload?.cleanup().catch((error) => console.error("Kunde inte städa bildfiler:", error));
  }
}
