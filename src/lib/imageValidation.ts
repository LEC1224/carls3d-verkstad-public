import fs from "fs";
import path from "path";
import type { File } from "formidable";
import { RequestError } from "./requestErrors";

export function validateImageUpload(file: Pick<File, "filepath" | "originalFilename">) {
  const extension = path.extname(file.originalFilename || "").toLowerCase();
  const header = Buffer.alloc(12);
  const descriptor = fs.openSync(file.filepath, "r");
  let bytes = 0;
  try { bytes = fs.readSync(descriptor, header, 0, header.length, 0); }
  finally { fs.closeSync(descriptor); }
  const jpeg = [".jpg", ".jpeg"].includes(extension) && bytes >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  const png = extension === ".png" && bytes >= 8 && header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const webp = extension === ".webp" && bytes >= 12 && header.toString("ascii", 0, 4) === "RIFF" && header.toString("ascii", 8, 12) === "WEBP";
  if (!jpeg && !png && !webp) {
    throw new RequestError("Välj bilder i JPEG-, PNG- eller WebP-format. Filens innehåll måste matcha filtypen.");
  }
}
