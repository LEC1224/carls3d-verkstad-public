import { randomBytes } from "crypto";
import fs from "fs";
import path from "path";
import type { Prisma, PrismaClient } from "@prisma/client";
import { validateOrderAmount } from "./priceValidation";

export function makeOrderNumber(id: number, createdAt: Date, name: string): string {
  const year = createdAt.getFullYear();
  const padded = id.toString().padStart(6, "0");
  const clean = name.toUpperCase().replace(/[^A-ZÅÄÖ]/g, "").slice(0, 12) || "KUND";
  return `SP-${year}-${padded}-${clean}`;
}

function safeFilename(name: string) {
  const safe = path.basename(name.replace(/\\/g, "/")).replace(/[^a-zA-Z0-9._-]/g, "_");
  const extension = path.extname(safe).slice(0, 10);
  return `${path.basename(safe, path.extname(safe)).slice(0, 100) || "file"}${extension}`;
}

type OrderData = Omit<Prisma.OrderCreateInput, "orderNumber" | "files">;
type OrderUpload = { filepath: string; originalFilename: string | null };

function copyToAvailableFilename(source: string, directory: string, desired: string) {
  const parsed = path.parse(desired);
  let filename = desired;
  for (let attempt = 0; attempt < 10; attempt++) {
    const destination = path.join(directory, filename);
    try {
      fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
      return { filename, destination };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || attempt === 9) throw error;
      // A rolled-back order ID can be reused after a crash or failed cleanup.
      // Keep any earlier file intact, and claim a new name atomically on retry.
      filename = `${parsed.name}-${randomBytes(6).toString("hex")}${parsed.ext}`;
    }
  }
  throw new Error("Could not allocate an order filename");
}

/** Database rows commit only after every file has been safely copied. */
export async function persistOrder(prisma: PrismaClient, data: OrderData, files: OrderUpload[] = []) {
  validateOrderAmount(data.price);
  validateOrderAmount(data.discount ?? 0);
  const uploadsDir = path.resolve(process.cwd(), "uploads");
  fs.mkdirSync(uploadsDir, { recursive: true });
  const createdPaths: string[] = [];
  try {
    return await prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: { ...data, orderNumber: `TMP-${randomBytes(12).toString("hex")}` },
      });
      const orderNumber = makeOrderNumber(created.id, created.createdAt, data.name);
      const order = await tx.order.update({ where: { id: created.id }, data: { orderNumber } });
      const finalFiles: Array<{ filename: string; token: string }> = [];
      for (let index = 0; index < files.length; index++) {
        const file = files[index];
        const desired = `${orderNumber}_${index + 1}_${safeFilename(file.originalFilename || "file")}`;
        const { filename, destination } = copyToAvailableFilename(file.filepath, uploadsDir, desired);
        createdPaths.push(destination);
        const token = randomBytes(12).toString("hex");
        await tx.orderFile.create({ data: { orderId: order.id, filename, token } });
        finalFiles.push({ filename, token });
      }
      return { order, finalFiles };
    }, { timeout: 30000 });
  } catch (error) {
    for (const filename of createdPaths) {
      try { fs.unlinkSync(filename); } catch (cleanupError) { console.error("Kunde inte ta bort ofullständig orderfil:", cleanupError); }
    }
    throw error;
  }
}
