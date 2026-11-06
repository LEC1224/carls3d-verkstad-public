import { expectedAdminCookieValue, isAdminRequest, isSafeAdminRedirect } from "../src/lib/adminAuth";

test.each(["/admin", "/admin/orders?page=2", "/bestall#upload"])("permits same-origin paths: %s", (next) => {
  expect(isSafeAdminRedirect(next)).toBe(true);
});

test.each([
  "https://evil.example", "//evil.example", "/\\evil.example", "/%5cevil.example", "/%2fevil.example",
  "/\n/evil.example", "/%0d%0aevil.example", "/%", ["/admin"], null,
])("rejects external, normalized-external, malformed, or ambiguous redirects: %p", (next) => {
  expect(isSafeAdminRedirect(next)).toBe(false);
});

test("admin cookie comparison rejects mismatches without throwing on different lengths", () => {
  const previousSecret = process.env.ADMIN_SECRET;
  process.env.ADMIN_SECRET = "test-secret-never-used-in-production";
  try {
    const valid = expectedAdminCookieValue(process.env.ADMIN_SECRET);
    expect(isAdminRequest({ cookies: { admin_session: valid } } as any)).toBe(true);
    expect(isAdminRequest({ cookies: { admin_session: "short" } } as any)).toBe(false);
    expect(isAdminRequest({ cookies: { admin_session: "x".repeat(valid.length) } } as any)).toBe(false);
    expect(isAdminRequest({ cookies: {} } as any)).toBe(false);
  } finally {
    if (previousSecret === undefined) delete process.env.ADMIN_SECRET;
    else process.env.ADMIN_SECRET = previousSecret;
  }
});
