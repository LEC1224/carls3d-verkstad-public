import { NextRequest, NextResponse } from "next/server";

async function expectedCookieValue(secret: string) {
  // stable, signed value; not reversible; same value checked in login API
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode("admin-ok"));
  return btoa(String.fromCharCode(...Array.from(new Uint8Array(signature)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Only protect the admin page (and anything under /admin if you add subroutes later)
  if (pathname.startsWith("/admin")) {
    const secret = process.env.ADMIN_SECRET || "";
    if (!secret) return NextResponse.json({ error: "ADMIN_SECRET saknas" }, { status: 500 });

    const cookie = req.cookies.get("admin_session")?.value;
    const valid = cookie && cookie === await expectedCookieValue(secret);

    if (!valid) {
      const url = req.nextUrl.clone();
      url.pathname = "/admin-login";
      url.searchParams.set("next", pathname); // so we can return after login
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin", "/admin/:path*"],
};
