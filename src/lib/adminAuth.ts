import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";

export function expectedAdminCookieValue(secret: string) {
  return crypto.createHmac("sha256", secret).update("admin-ok").digest("base64url");
}

export function isSafeAdminRedirect(next: unknown): next is string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//") || next.length > 2048) return false;
  try {
    const decoded = decodeURIComponent(next);
    if (decoded.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(decoded)) return false;
    return new URL(next, "https://admin.invalid").origin === "https://admin.invalid";
  } catch {
    return false;
  }
}

export function isAdminRequest(req: NextApiRequest) {
  const secret = process.env.ADMIN_SECRET || "";
  const cookie = req.cookies.admin_session;
  if (!secret || !cookie) return false;
  const actual = Buffer.from(cookie);
  const expected = Buffer.from(expectedAdminCookieValue(secret));
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function requireAdmin(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "private, no-store");
  if (!process.env.ADMIN_SECRET) {
    res.status(500).json({ error: "ADMIN_SECRET saknas i miljön" });
    return false;
  }

  if (!isAdminRequest(req)) {
    res.status(401).json({ error: "Admin-inloggning krävs." });
    return false;
  }

  return true;
}
