import type { NextApiRequest, NextApiResponse } from "next";
import path from "path";
import { estimateFromFile } from "../../lib/estimation";
import { priceCartBreakdown } from "../../lib/pricing";
import { logPriceCalculation } from "../../lib/priceCalculationLog";
import { applyStandardCoupon } from "../../lib/coupons";
import { requireValidCoupon } from "../../lib/couponServer";
import { applyDeliveryToBreakdown, normalizeDeliveryMethod } from "../../lib/delivery";
import { prisma } from "../../lib/prisma";
import { parseItemsMeta, singleField } from "../../lib/orderValidation";
import { RequestError, publicError } from "../../lib/requestErrors";
import { parseUpload, uploadedFiles } from "../../lib/uploads";
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
    const upFiles = uploadedFiles(files, "files");
    if (!upFiles.length) throw new RequestError("Ladda upp minst en STL/OBJ-fil.");
    const meta = parseItemsMeta(fields.itemsMeta, upFiles.length);
    await validateAvailableColors(prisma, meta);
    const coupon = await requireValidCoupon(prisma, singleField(fields.couponCode, "rabattkod"));
    const entries = upFiles.map((file, index) => {
      const name = file.originalFilename || path.basename(file.filepath);
      if (!/\.(stl|obj)$/i.test(name)) throw new RequestError(`Endast STL/OBJ: ${name}`);
      const item = meta[index];
      const estimate = estimateFromFile(file.filepath, item.material);
      return { index, name, ...item, gramsEach: estimate.grams, estimate };
    });
    const deliveryMethod = normalizeDeliveryMethod(singleField(fields.deliveryMethod, "leveranssätt", "shipping"));
    const breakdown = applyStandardCoupon(
      applyDeliveryToBreakdown(priceCartBreakdown(entries, upFiles.length), deliveryMethod), coupon
    );
    validatePriceBreakdown(breakdown);
    logPriceCalculation("quote", entries, breakdown);
    return res.status(200).json({ breakdown });
  } catch (error) {
    console.error("/api/quote error:", error);
    const { status, ...body } = publicError(error, "Kunde inte beräkna offert.");
    return res.status(status).json(body);
  } finally {
    await upload?.cleanup().catch((error) => console.error("Kunde inte städa offertfiler:", error));
  }
}
