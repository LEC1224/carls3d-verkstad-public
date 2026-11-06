export class CheckoutRequestTimeoutError extends Error {
  constructor() {
    super("Request timed out");
    this.name = "CheckoutRequestTimeoutError";
  }
}

/**
 * Bound read-only checkout requests, including reading the response body.
 * Orders deliberately do not use this helper: an interrupted write may already have committed.
 */
export async function fetchCheckoutJson(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  let cancel!: (error: Error) => void;
  const cancelled = new Promise<never>((_, reject) => { cancel = reject; });
  const abort = () => {
    controller.abort();
    cancel(new DOMException("Aborted", "AbortError"));
  };
  init.signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => {
    controller.abort();
    cancel(new CheckoutRequestTimeoutError());
  }, timeoutMs);
  try {
    if (init.signal?.aborted) { abort(); return await cancelled; }
    return await Promise.race([
      fetch(url, { ...init, signal: controller.signal }).then(async (response) => ({
        response,
        data: await response.json().catch(() => null),
      })),
      cancelled,
    ]);
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener("abort", abort);
  }
}
