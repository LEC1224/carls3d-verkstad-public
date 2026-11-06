import type { NextApiRequest, NextApiResponse } from "next";
import fs from "fs";
import path from "path";
import { estimateFromFile } from "../../lib/estimation";
import { priceCartBreakdown } from "../../lib/pricing";
import { logPriceCalculation } from "../../lib/priceCalculationLog";
import { fulfillOrder as notifyOrder } from "../../lib/orderWorkflow";
import { applyStandardCoupon } from "../../lib/coupons";
import { requireValidCoupon } from "../../lib/couponServer";
import { applyDeliveryToBreakdown } from "../../lib/delivery";
import { prisma } from "../../lib/prisma";
import { parseCustomer, parseItemsMeta, singleField } from "../../lib/orderValidation";
import { RequestError, publicError } from "../../lib/requestErrors";
import { parseUpload, uploadedFiles } from "../../lib/uploads";
import { persistOrder } from "../../lib/persistOrder";
import { MAX_FILE_SIZE, MAX_MODEL_FILES, MAX_TOTAL_MODEL_SIZE } from "../../lib/validation";
import { validateAvailableColors } from "../../lib/inventory";
import { validatePriceBreakdown } from "../../lib/priceValidation";

export const config = { api: { bodyParser: false } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Endast POST." });
  }
  let upload: Awaited<ReturnType<typeof parseUpload>> | undefined;
  try {
    upload = await parseUpload(req, {
      maxFileSize: MAX_FILE_SIZE, maxTotalFileSize: MAX_TOTAL_MODEL_SIZE, maxFiles: MAX_MODEL_FILES,
    });
    const { fields, files } = upload;
    const customer = parseCustomer(fields);
    const { name, email, phone, deliveryMethod, addressLine1, addressLine2, postalCode, city, country } = customer;
    const upFiles = uploadedFiles(files, "files");
    if (!upFiles.length) throw new RequestError("Ladda upp minst en STL/OBJ-fil.");
    const meta = parseItemsMeta(fields.itemsMeta, upFiles.length);
    await validateAvailableColors(prisma, meta);
    const coupon = await requireValidCoupon(prisma, singleField(fields.couponCode, "rabattkod"));
    const pricingEntries = upFiles.map((file, index) => {
      const name = file.originalFilename || path.basename(file.filepath);
      if (!/\.(stl|obj)$/i.test(name)) throw new RequestError(`Endast STL/OBJ: ${name}`);
      const item = meta[index];
      const estimate = estimateFromFile(file.filepath, item.material);
      return { index, name, ...item, gramsEach: estimate.grams, estimate };
    });
    const breakdown = applyStandardCoupon(
      applyDeliveryToBreakdown(priceCartBreakdown(pricingEntries, upFiles.length), deliveryMethod), coupon
    );
    validatePriceBreakdown(breakdown);
    logPriceCalculation("order", pricingEntries, breakdown);
    const price = breakdown.total;
    const saved = await persistOrder(prisma, {
      ...customer, type: "standard", price,
      discount: breakdown.coupon?.discount || 0,
      couponCode: breakdown.coupon?.code || null, status: "Ny",
    }, upFiles);
    const { order } = saved;
    const { orderNumber } = order;
    const finalFiles = saved.finalFiles.map((file, index) => ({ ...file, meta: pricingEntries[index] }));
    const uploadsDir = path.resolve(process.cwd(), "uploads");

    // 4) Notify Discord with final filenames
    await notifyOrder({
      id: order.id,
      orderNumber,
      name,
      email,
      type: "standard",
      price,
      discount: order.discount,
      couponCode: order.couponCode,
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
        material: f.meta.material,
        color: f.meta.color,
        copies: f.meta.copies,
        purpose: f.meta.purpose,
        gramsEach: Math.round(f.meta.gramsEach),
      })),
    });

    // 5) Write TXT receipt in /uploads with final filenames
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
      lines.push("Objekt:");
      for (const f of finalFiles) {
        lines.push(
          `- ${f.token}  ${f.filename}  —  ${f.meta.material}/${f.meta.color} × ${f.meta.copies}  (~${Math.round(
            f.meta.gramsEach
          )} g/ea)`
        );
      }
      lines.push("");
      if (breakdown.coupon) {
        lines.push(`Rabattkod: ${breakdown.coupon.code}`);
        lines.push(`Rabatt: -${breakdown.coupon.discount} kr`);
        lines.push(`Ordinarie total: ${breakdown.totalBeforeDiscount} kr`);
      }
      lines.push(`Materialkostnad: ${breakdown.materialCost} kr`);
      lines.push(`Filavgift: ${breakdown.fileFee} kr`);
      lines.push(`${deliveryMethod === "pickup" ? "Avhämtning" : "Frakt"}: ${breakdown.shipping} kr`);
      lines.push(`Totalt: ${price} kr`);
      const txtPath = path.join(uploadsDir, `${orderNumber}.txt`);
      fs.writeFileSync(txtPath, lines.join("\n"), "utf8");
    } catch (e) {
      console.error("Kunde inte skriva TXT-kvitto:", e);
    }

    return res.status(200).json({ success: true, id: order.id, orderNumber, price, breakdown });
  } catch (error) {
    console.error("/api/order error:", error);
    const { status, ...body } = publicError(error, "Något gick fel vid beställning.");
    return res.status(status).json(body);
  } finally {
    await upload?.cleanup().catch((error) => console.error("Kunde inte städa orderfiler:", error));
  }
}
