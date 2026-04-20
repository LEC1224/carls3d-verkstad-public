import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";

export function expectedAdminCookieValue(secret: string) {
  return crypto.createHmac("sha256", secret).update("admin-ok").digest("base64url");
}

export function isSafeAdminRedirect(next: unknown): next is string {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//");
}

export function isAdminRequest(req: NextApiRequest) {
  const secret = process.env.ADMIN_SECRET || "";
  const cookie = req.cookies.admin_session;
  return Boolean(secret && cookie && cookie === expectedAdminCookieValue(secret));
}

export function requireAdmin(req: NextApiRequest, res: NextApiResponse) {
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
