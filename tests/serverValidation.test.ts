import { parseCustomer, parseItemsMeta, positiveQuantity, singleField } from "../src/lib/orderValidation";
import { publicError } from "../src/lib/requestErrors";

const customer = { name: " Testkund ", email: "test@example.com", phone: "0701234567", deliveryMethod: "pickup" };

test("multipart single fields and pickup customer details normalize without an address", () => {
  expect(parseCustomer(Object.fromEntries(Object.entries(customer).map(([key, value]) => [key, [value]])))).toMatchObject({
    name: "Testkund", deliveryMethod: "pickup", addressLine1: "", addressLine2: null, city: "", country: "",
  });
});

test("shipping needs an address while contact details are required for pickup", () => {
  expect(() => parseCustomer({ ...customer, deliveryMethod: "shipping" })).toThrow("adress");
  expect(() => parseCustomer({ ...customer, phone: "" })).toThrow("telefon");
  expect(() => parseCustomer({ ...customer, email: "not-an-address" })).toThrow("e-postadress");
});

test.each([{}, ["one", "two"], "line\nbreak", "x".repeat(501)])("rejects ambiguous or oversized contact fields %p", (value) => {
  expect(() => singleField(value, "namn")).toThrow();
});

test.each([0, -1, 1.1, "1abc", "", "Infinity", 1000, null, {}, []])("rejects invalid quantity %p", (value) => {
  expect(() => positiveQuantity(value, 999, "kopior")).toThrow();
});

test("accepts boundary quantities and normalizes supported materials", () => {
  expect(positiveQuantity("999", 999, "kopior")).toBe(999);
  expect(parseItemsMeta([JSON.stringify([{ material: "petg", copies: 2, color: "black" }])], 1))
    .toEqual([{ material: "PETG", copies: 2, color: "black", purpose: "general" }]);
});

test("retains a functional part's purpose for the existing print workflow", () => {
  expect(parseItemsMeta(JSON.stringify([{ material: "PLA", color: "white", copies: 2, purpose: "functional" }]), 1)[0].purpose).toBe("functional");
});

test.each(["{", "{}", "[]", "[null]", '[{"material":"GOLD"}]', '[{"copies":"NaN"}]', '[{"color":""}]'])
  ("invalid cart metadata returns a client error: %s", (value) => {
    try { parseItemsMeta(value, 1); throw new Error("Expected invalid input"); }
    catch (error) { expect(publicError(error, "Unexpected").status).toBe(400); }
  });

test("internal exceptions do not leak paths or invalid status codes", () => {
  expect(publicError(new Error("C:/secret/database.db"), "Försök igen")).toEqual({ status: 500, error: "Försök igen" });
  expect(publicError({ statusCode: 200, message: "leak" }, "Försök igen")).toEqual({ status: 500, error: "Försök igen" });
});
