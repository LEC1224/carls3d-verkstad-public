import { createHash } from "crypto";
import type { OrderLike } from "./notify";
import { ALL_COLORS } from "./colors";

export type OrderEmailTarget = "customer" | "owner";
export type OrderEmailOrder = OrderLike & { discount?: number; couponCode?: string | null };
export type OrderEmailResult = { id: string };
export interface OrderEmailPayload {
  from: string;
  to: string[];
  reply_to: string;
  subject: string;
  html: string;
  text: string;
}

export class OrderEmailError extends Error {
  constructor(message: string, public retryable: boolean, public status?: number) {
    super(message);
    this.name = "OrderEmailError";
  }
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char]!));
}

function emailAddress(value: string | undefined, field: string): string {
  const address = (value || "").trim();
  if (!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(address)) {
    throw new OrderEmailError(`Invalid or missing ${field}.`, false);
  }
  return address;
}

function orderReference(order: OrderEmailOrder): string {
  const reference = order.orderNumber || (order.id != null ? String(order.id) : "");
  if (!reference || /[\r\n]/.test(reference)) {
    throw new OrderEmailError("A stable order reference is required for order emails.", false);
  }
  return reference;
}

export function orderEmailIdempotencyKey(order: OrderEmailOrder, target: OrderEmailTarget): string {
  // ASCII-only and bounded even when order numbers contain Swedish characters.
  const identity = createHash("sha256").update(orderReference(order)).digest("hex");
  return `carls3d-order-v1/${identity}/${target}`;
}

function itemLines(order: OrderEmailOrder): string[] {
  if (order.type === "minecraft-torch") {
    return (order.items || []).map((item) => `Väggmonterad Minecraft-fackla × ${item.copies} — PLA, flerfärgad`);
  }
  if (order.type === "lithophane") {
    return ["Lithophane-kub × 1 — PLA, vit", ...((order.items || []).map((item) => `Bild: ${displayFilename(order, item.filename)}`))];
  }
  return (order.items || []).map((item) => {
    const color = ALL_COLORS.find((entry) => entry.value === item.color)?.label || item.color;
    return `${displayFilename(order, item.filename)} × ${item.copies} — ${item.material}, ${color}`;
  });
}

function displayFilename(order: OrderEmailOrder, filename: string): string {
  const prefix = `${order.orderNumber}_`;
  return order.orderNumber && filename.startsWith(prefix) ? filename.slice(prefix.length) : filename;
}

/** Deterministic content: persist this payload if configuration may change during retries. */
export function buildOrderEmail(order: OrderEmailOrder, target: OrderEmailTarget): OrderEmailPayload {
  const reference = orderReference(order);
  const customerEmail = emailAddress(order.email, "customer email");
  const recipient = target === "customer"
    ? customerEmail
    : emailAddress(process.env.ORDER_NOTIFICATION_EMAIL, "ORDER_NOTIFICATION_EMAIL");
  const replyAddress = emailAddress(process.env.ORDER_REPLY_TO_EMAIL || "info@carls3d.se", "ORDER_REPLY_TO_EMAIL");
  const from = process.env.ORDER_FROM_EMAIL || "Carl's 3D-verkstad <info@carls3d.se>";
  if (/[\r\n]/.test(from)) throw new OrderEmailError("Invalid ORDER_FROM_EMAIL.", false);
  if (!Number.isFinite(order.price) || order.price! < 0) {
    throw new OrderEmailError("An order total is required for order emails.", false);
  }
  const title = target === "customer" ? "Tack för din beställning!" : "Ny beställning";
  const introduction = target === "customer"
    ? `Hej ${order.name || ""}! Vi har tagit emot din beställning hos Carl's 3D-verkstad.`
    : `${order.name || "Kund"} har gjort en beställning hos Carl's 3D-verkstad.`;
  const delivery = order.deliveryMethod === "pickup"
    ? ["Avhämtning hos Carl's 3D-verkstad"]
    : ["Leverans med PostNord", order.addressLine1, order.addressLine2,
        `${order.postalCode || ""} ${order.city || ""}`.trim(), order.country].filter(Boolean) as string[];
  const items = itemLines(order);
  const money = `${new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 2 }).format(order.price!)} kr`;
  const discount = order.discount && order.discount > 0
    ? `Rabatt: ${order.discount} kr${order.couponCode ? ` (${order.couponCode})` : ""}` : "";
  const closing = target === "customer"
    ? "Vi återkommer med information om din beställning. Har du frågor? Svara på det här mejlet och ange ditt ordernummer."
    : "Svara på det här mejlet för att kontakta kunden.";
  const contact = [`Namn: ${order.name || ""}`, `E-post: ${customerEmail}`, order.phone ? `Telefon: ${order.phone}` : ""].filter(Boolean);
  const text = [title, introduction, "", `Ordernummer: ${reference}`, "", "Beställning:", ...items.map((line) => `• ${line}`),
    "", ...(discount ? [discount] : []), `Totalt: ${money}`, "", ...delivery, "", ...contact, "", closing, "", "Carl's 3D-verkstad", "https://carls3d.se"].join("\n");
  const html = `<!doctype html><html lang="sv"><body style="font-family:Arial,sans-serif;color:#172033;line-height:1.6;margin:0;padding:24px;background:#f5f7fa"><main style="max-width:640px;margin:auto;background:white;padding:28px;border-radius:12px">
<p style="color:#465a76">Carl's 3D-verkstad</p><h1>${title}</h1><p>${escapeHtml(introduction)}</p>
<p><strong>Ordernummer:</strong> ${escapeHtml(reference)}</p><h2>Beställning</h2>
<ul>${items.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>
${discount ? `<p>${escapeHtml(discount)}</p>` : ""}<p><strong>Totalt: ${escapeHtml(money)}</strong></p>
<h2>${order.deliveryMethod === "pickup" ? "Avhämtning" : "Leverans"}</h2><p>${delivery.map(escapeHtml).join("<br>")}</p>
<p>${contact.map(escapeHtml).join("<br>")}</p><p>${closing}</p><p><a href="https://carls3d.se">carls3d.se</a></p></main></body></html>`;
  return {
    from,
    to: [recipient],
    reply_to: target === "customer" ? replyAddress : customerEmail,
    subject: `${target === "customer" ? "Orderbekräftelse" : "Ny beställning"} ${reference} – Carl's 3D-verkstad`,
    html,
    text,
  };
}

/** Send one recipient so the durable outbox can persist each success independently. */
export async function sendOrderEmail(
  order: OrderEmailOrder,
  target: OrderEmailTarget,
  payload: OrderEmailPayload = buildOrderEmail(order, target),
): Promise<OrderEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new OrderEmailError("RESEND_API_KEY is not configured.", true);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": orderEmailIdempotencyKey(order, target),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      // Do not store response bodies: provider diagnostics can echo addresses/content.
      throw new OrderEmailError(`Resend rejected ${target} order email (HTTP ${response.status}).`,
        response.status === 429 || response.status === 408 || response.status >= 500, response.status);
    }
    const result = await response.json();
    if (typeof result?.id !== "string" || !result.id) {
      throw new OrderEmailError("Resend returned no email ID; delivery state is uncertain.", true);
    }
    return { id: result.id };
  } catch (error) {
    if (error instanceof OrderEmailError) throw error;
    throw new OrderEmailError("Resend request failed or timed out; delivery state is uncertain.", true);
  } finally {
    clearTimeout(timeout);
  }
}

export type OrderEmailAttempt = { id: string; skipped?: boolean } | { error: string; retryable: boolean };

/** Successful IDs must be durably recorded; Resend deduplicates only for 24 hours. */
export async function sendOrderEmails(
  order: OrderEmailOrder,
  options: { completed?: Partial<Record<OrderEmailTarget, string>> } = {},
): Promise<Record<OrderEmailTarget, OrderEmailAttempt>> {
  const results = {} as Record<OrderEmailTarget, OrderEmailAttempt>;
  for (const target of ["customer", "owner"] as const) {
    const existingId = options.completed?.[target];
    if (existingId) {
      results[target] = { id: existingId, skipped: true };
      continue;
    }
    try {
      results[target] = await sendOrderEmail(order, target);
    } catch (error) {
      results[target] = {
        error: error instanceof Error ? error.message : "Order email failed.",
        retryable: error instanceof OrderEmailError ? error.retryable : false,
      };
    }
  }
  return results;
}
