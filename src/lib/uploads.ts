import type { NextApiRequest } from "next";
import formidable from "formidable";
import fs from "fs/promises";
import path from "path";
import { randomBytes } from "crypto";
import { RequestError } from "./requestErrors";

type UploadLimits = { maxFileSize: number; maxTotalFileSize: number; maxFiles: number };

export async function parseUpload(req: NextApiRequest, limits: UploadLimits) {
  if (!/^multipart\/form-data(?:;|$)/i.test(req.headers["content-type"] || "")) {
    throw new RequestError("Skicka filerna som en formuläruppladdning.", 415);
  }
  const root = path.resolve(process.cwd(), "uploads", "tmp");
  await fs.mkdir(root, { recursive: true });
  const directory = await fs.mkdtemp(path.join(root, "request-"));
  const cleanup = async () => {
    // Only remove this request's generated directory, never the uploads root.
    if (path.dirname(path.resolve(directory)) !== root || !path.basename(directory).startsWith("request-")) {
      throw new Error("Invalid upload cleanup path");
    }
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  };
  try {
    const form = formidable({
      multiples: true,
      uploadDir: directory,
      keepExtensions: true,
      filename: (_name, _extension, part) => {
        // Formidable preserves everything after the first dot by default, which can
        // truncate "model.v2 final.stl" to ".v2". The reader needs the last extension.
        const extension = path.extname(part.originalFilename || "").toLowerCase();
        const safeExtension = /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : "";
        return `${randomBytes(16).toString("hex")}${safeExtension}`;
      },
      ...limits,
      maxFields: 30,
      maxFieldsSize: 64 * 1024,
      allowEmptyFiles: false,
      minFileSize: 1,
    });
    const encounterOrder = new Map<string, formidable.File[]>();
    const completed = new Set<formidable.File>();
    form.on("fileBegin", (field, file) => {
      const list = encounterOrder.get(field) || [];
      list.push(file);
      encounterOrder.set(field, list);
    });
    form.on("file", (_field, file) => completed.add(file));
    const { fields, files } = await new Promise<{ fields: formidable.Fields; files: formidable.Files }>((resolve, reject) => {
      form.parse(req, (error, fields) => {
        if (error) reject(error);
        else {
          // Formidable's files arrays follow disk-write completion order. Preserve multipart
          // encounter order so each model stays paired with its material/color/copy metadata.
          const files = Object.fromEntries(Array.from(encounterOrder, ([field, list]) => [field, list.filter((file) => completed.has(file))]));
          resolve({ fields, files });
        }
      });
    });
    return { fields, files, cleanup };
  } catch (error) {
    await cleanup();
    if ((error as any)?.httpCode === 413) {
      throw new RequestError(`Uppladdningen är för stor. Max ${limits.maxFiles} filer, ${limits.maxFileSize / 1024 / 1024} MB per fil och ${limits.maxTotalFileSize / 1024 / 1024} MB totalt.`, 413);
    }
    if ((error as any)?.httpCode >= 400 && (error as any)?.httpCode < 500) {
      throw new RequestError("Kunde inte läsa uppladdningen. Kontrollera att filerna inte är tomma och försök igen.");
    }
    throw error;
  }
}

export function uploadedFiles(files: formidable.Files, field: string): formidable.File[] {
  if (Object.keys(files).some((key) => key !== field)) throw new RequestError("Uppladdningen innehåller ett okänt filfält.");
  const value = files[field];
  return value ? (Array.isArray(value) ? value : [value]) : [];
}
