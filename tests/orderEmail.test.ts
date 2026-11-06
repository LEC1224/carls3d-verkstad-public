import { buildOrderEmail, orderEmailIdempotencyKey, sendOrderEmail, sendOrderEmails, OrderEmailOrder } from "../src/lib/orderEmail";

const order: OrderEmailOrder = {
  id: 42, orderNumber: "SP-2026-000042-ÅSA", name: "Åsa <script>alert(1)</script>", email: "customer@example.com",
  type: "standard", price: 245, deliveryMethod: "pickup", phone: "0701234567",
  items: [{ filename: "SP-2026-000042-ÅSA_part&one.stl", token: "file-token", material: "PLA", color: "red", copies: 3, gramsEach: 10 }],
};
const originalFetch = global.fetch;
const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.RESEND_API_KEY = "test-key";
  process.env.ORDER_NOTIFICATION_EMAIL = "owner@example.com";
  delete process.env.ORDER_FROM_EMAIL;
  delete process.env.ORDER_REPLY_TO_EMAIL;
  global.fetch = jest.fn();
});
afterAll(() => { global.fetch = originalFetch; process.env = originalEnv; });

test("customer and owner get separate recipients and correct reply-to addresses", () => {
  const customer = buildOrderEmail(order, "customer");
  const owner = buildOrderEmail(order, "owner");
  expect(customer.to).toEqual(["customer@example.com"]);
  expect(owner.to).toEqual(["owner@example.com"]);
  expect(customer.reply_to).toBe("info@carls3d.se");
  expect(owner.reply_to).toBe("customer@example.com");
  expect(customer.from).toBe("Carl's 3D-verkstad <info@carls3d.se>");
  expect(customer.html).not.toContain("<script>");
  expect(customer.html).toContain("&lt;script&gt;");
  expect(customer.html).toContain("part&amp;one.stl × 3 — PLA, Röd");
  expect(customer.text).toContain("Totalt: 245 kr");
  expect(customer.text).toContain("Avhämtning");
  expect(customer.text).not.toContain("PostNord");
});

test("shipping and discounted totals are included without claiming payment", () => {
  const email = buildOrderEmail({ ...order, deliveryMethod: "shipping", addressLine1: "Testvägen 1", postalCode: "12345", city: "Stockholm", country: "Sverige", discount: 25, couponCode: "TEST" }, "customer");
  expect(email.text).toContain("Leverans med PostNord\nTestvägen 1\n12345 Stockholm\nSverige");
  expect(email.text).toContain("Rabatt: 25 kr (TEST)");
  expect(email.text).not.toMatch(/betald|betalning mottagen/i);
});

test("fixed products retain quantities and distinguish photos from printed lithophanes", () => {
  const torch = buildOrderEmail({ ...order, type: "minecraft-torch" }, "customer");
  expect(torch.text).toContain("Minecraft-fackla × 3");
  const lithophane = buildOrderEmail({ ...order, type: "lithophane" }, "customer");
  expect(lithophane.text).toContain("Lithophane-kub × 1 — PLA, vit");
  expect(lithophane.text).toContain("Bild: part&one.stl");
});

test("partial failure retries only the missing recipient with stable idempotency", async () => {
  const fetchMock = global.fetch as jest.Mock;
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ id: "customer-sent" }) });
  fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });
  const first = await sendOrderEmails(order);
  expect(first.customer).toEqual({ id: "customer-sent" });
  expect(first.owner).toEqual({ error: expect.stringContaining("503"), retryable: true });
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ id: "owner-sent" }) });
  const second = await sendOrderEmails(order, { completed: { customer: "customer-sent" } });
  expect(second.customer).toEqual({ id: "customer-sent", skipped: true });
  expect(second.owner).toEqual({ id: "owner-sent" });
  expect(fetchMock).toHaveBeenCalledTimes(3);
  const keys = fetchMock.mock.calls.map((call) => call[1].headers["Idempotency-Key"]);
  expect(keys[0]).not.toBe(keys[1]);
  expect(keys[1]).toBe(keys[2]);
  expect(keys[0]).toMatch(/^[\x20-\x7E]+$/);
});

test("network errors are safe to persist and classified as retryable", async () => {
  (global.fetch as jest.Mock).mockRejectedValue(new Error("secret token customer@example.com"));
  await expect(sendOrderEmail(order, "customer")).rejects.toMatchObject({ retryable: true, message: "Resend request failed or timed out; delivery state is uncertain." });
});

test("configuration and recipient validation never silently reports success", async () => {
  delete process.env.RESEND_API_KEY;
  await expect(sendOrderEmail(order, "customer")).rejects.toThrow("RESEND_API_KEY");
  expect(() => buildOrderEmail({ ...order, email: "customer@example.com\r\nBcc: other@example.com" }, "customer")).toThrow("customer email");
  delete process.env.ORDER_NOTIFICATION_EMAIL;
  expect(() => buildOrderEmail(order, "owner")).toThrow("ORDER_NOTIFICATION_EMAIL");
  expect(() => orderEmailIdempotencyKey({}, "customer")).toThrow("stable order reference");
  expect(global.fetch).not.toHaveBeenCalled();
});

test("provider validation failures are not blindly retried", async () => {
  (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 422 });
  await expect(sendOrderEmail(order, "customer")).rejects.toMatchObject({ status: 422, retryable: false });
});
