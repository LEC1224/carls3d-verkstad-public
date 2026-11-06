import { CheckoutRequestTimeoutError, fetchCheckoutJson } from "../src/lib/checkoutRequest";

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

test("bounds a stalled network request and aborts the underlying connection", async () => {
  const fetchMock = jest.spyOn(global, "fetch").mockImplementation(() => new Promise(() => {}));
  const request = fetchCheckoutJson("/api/availability", {}, 15_000);
  const rejection = expect(request).rejects.toBeInstanceOf(CheckoutRequestTimeoutError);
  await jest.advanceTimersByTimeAsync(15_000);
  await rejection;
  expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
});

test("also bounds a response body that never finishes", async () => {
  jest.spyOn(global, "fetch").mockResolvedValue({ json: () => new Promise(() => {}) } as Response);
  const request = fetchCheckoutJson("/api/quote", {}, 90_000);
  const rejection = expect(request).rejects.toBeInstanceOf(CheckoutRequestTimeoutError);
  await jest.advanceTimersByTimeAsync(90_000);
  await rejection;
});

test("cancels immediately when the cart changes even if fetch ignores abort", async () => {
  jest.spyOn(global, "fetch").mockImplementation(() => new Promise(() => {}));
  const controller = new AbortController();
  const request = fetchCheckoutJson("/api/quote", { signal: controller.signal }, 90_000);
  const rejection = expect(request).rejects.toHaveProperty("name", "AbortError");
  controller.abort();
  await rejection;
  expect(jest.getTimerCount()).toBe(0);
});

test("does not start an already-cancelled request", async () => {
  const fetchMock = jest.spyOn(global, "fetch");
  const controller = new AbortController();
  controller.abort();
  await expect(fetchCheckoutJson("/api/quote", { signal: controller.signal }, 90_000)).rejects.toHaveProperty("name", "AbortError");
  expect(fetchMock).not.toHaveBeenCalled();
});

test("clears the deadline after receiving a complete response", async () => {
  jest.spyOn(global, "fetch").mockResolvedValue({ ok: true, json: async () => ({ ready: true }) } as Response);
  await expect(fetchCheckoutJson("/api/availability", {}, 15_000)).resolves.toMatchObject({ data: { ready: true } });
  expect(jest.getTimerCount()).toBe(0);
});

test("cleans up its deadline and parent-signal listener after failure", async () => {
  jest.spyOn(global, "fetch").mockRejectedValue(new TypeError("Offline"));
  const controller = new AbortController();
  const add = jest.spyOn(controller.signal, "addEventListener");
  const remove = jest.spyOn(controller.signal, "removeEventListener");
  await expect(fetchCheckoutJson("/api/availability", { signal: controller.signal }, 15_000)).rejects.toThrow("Offline");
  expect(jest.getTimerCount()).toBe(0);
  expect(remove).toHaveBeenCalledWith("abort", add.mock.calls[0][1]);
});

test("returns an unreadable completed response as null without retaining a timer", async () => {
  jest.spyOn(global, "fetch").mockResolvedValue({ ok: true, json: async () => { throw new SyntaxError("Invalid JSON"); } } as unknown as Response);
  await expect(fetchCheckoutJson("/api/availability", {}, 15_000)).resolves.toMatchObject({ data: null });
  expect(jest.getTimerCount()).toBe(0);
});

test("cleans up after a deadline and ignores a late transport resolution", async () => {
  let resolve!: (value: Response) => void;
  jest.spyOn(global, "fetch").mockReturnValue(new Promise((done) => { resolve = done; }));
  const controller = new AbortController();
  const remove = jest.spyOn(controller.signal, "removeEventListener");
  const request = fetchCheckoutJson("/api/quote", { signal: controller.signal }, 90_000);
  const rejection = expect(request).rejects.toBeInstanceOf(CheckoutRequestTimeoutError);
  await jest.advanceTimersByTimeAsync(90_000);
  await rejection;
  expect(jest.getTimerCount()).toBe(0);
  expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  resolve({ ok: true, json: async () => ({ price: 123 }) } as Response);
  await Promise.resolve();
  await expect(request).rejects.toBeInstanceOf(CheckoutRequestTimeoutError);
});
