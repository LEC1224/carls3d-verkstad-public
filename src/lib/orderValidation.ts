import { normalizeDeliveryMethod } from "./delivery";
import { RequestError } from "./requestErrors";
import { MAX_MODEL_COPIES, MAX_MODEL_FILES, SUPPORTED_MATERIALS } from "./validation";

export function singleField(value: unknown, label: string, fallback = ""): string {
  if (value == null) return fallback;
  if (Array.isArray(value)) {
    if (value.length !== 1) throw new RequestError(`Ange ett värde för ${label}.`);
    value = value[0];
  }
  if (typeof value !== "string") throw new RequestError(`Ogiltigt värde för ${label}.`);
  const text = value.trim();
  if (text.length > 500 || /[\r\n\0]/.test(text)) throw new RequestError(`Ogiltigt värde för ${label}.`);
  return text;
}

export function positiveQuantity(value: unknown, maximum: number, label: string): number {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new RequestError(`Ange ${label} som ett heltal mellan 1 och ${maximum}.`);
  }
  const quantity = Number(value);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > maximum) {
    throw new RequestError(`Ange ${label} som ett heltal mellan 1 och ${maximum}.`);
  }
  return quantity;
}

export function parseCustomer(fields: Record<string, unknown>) {
  const name = singleField(fields.name, "namn");
  const email = singleField(fields.email, "e-post");
  const phone = singleField(fields.phone, "telefon");
  const deliveryMethod = normalizeDeliveryMethod(singleField(fields.deliveryMethod, "leveranssätt", "shipping"));
  if (!name || !email || !phone) throw new RequestError("Fyll i namn, e-post och telefon.");
  if (email.length > 254 || !/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(email)) {
    throw new RequestError("Ange en giltig e-postadress.");
  }
  const addressLine1 = deliveryMethod === "pickup" ? "" : singleField(fields.addressLine1, "adress");
  const addressLine2 = deliveryMethod === "pickup" ? null : singleField(fields.addressLine2, "adressrad 2") || null;
  const postalCode = deliveryMethod === "pickup" ? "" : singleField(fields.postalCode, "postnummer");
  const city = deliveryMethod === "pickup" ? "" : singleField(fields.city, "ort");
  const country = deliveryMethod === "pickup" ? "" : singleField(fields.country, "land", "Sverige") || "Sverige";
  if (deliveryMethod === "shipping" && (!addressLine1 || !postalCode || !city)) {
    throw new RequestError("Fyll i adress, postnummer och ort för leveransen.");
  }
  return { name, email, phone, deliveryMethod, addressLine1, addressLine2, postalCode, city, country };
}

export function parseItemsMeta(value: unknown, fileCount: number) {
  if (Array.isArray(value)) {
    if (value.length !== 1) throw new RequestError("Ogiltiga filuppgifter. Lägg till filerna igen.");
    value = value[0];
  }
  let meta: unknown;
  try {
    if (typeof value !== "string") throw new Error();
    meta = JSON.parse(value);
  } catch {
    throw new RequestError("Ogiltiga filuppgifter. Lägg till filerna igen.");
  }
  if (!Array.isArray(meta) || meta.length !== fileCount || fileCount < 1 || fileCount > MAX_MODEL_FILES) {
    throw new RequestError("Filuppgifterna matchar inte uppladdningen. Lägg till filerna igen.");
  }
  return meta.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new RequestError("Ogiltiga filuppgifter. Lägg till filerna igen.");
    }
    const material = singleField(item.material, "material", "PLA").toUpperCase();
    if (!(SUPPORTED_MATERIALS as readonly string[]).includes(material)) throw new RequestError("Välj ett giltigt material.");
    const color = singleField(item.color, "färg", "white");
    if (!color || color.length > 80) throw new RequestError("Välj en giltig färg.");
    const copies = positiveQuantity(item.copies ?? 1, MAX_MODEL_COPIES, "antal kopior");
    const purpose = item.purpose === "functional" ? "functional" as const : "general" as const;
    return { material, color, copies, purpose };
  });
}
