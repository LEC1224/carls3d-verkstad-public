import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import Layout from "../components/Layout";
import { CheckoutRequestTimeoutError, fetchCheckoutJson } from "../lib/checkoutRequest";

export default function AdminLogin() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const request = useRef<AbortController | null>(null);
  const next = typeof router.query.next === "string" ? router.query.next : "/admin";

  useEffect(() => () => {
    request.current?.abort();
    request.current = null;
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    const controller = new AbortController();
    request.current = controller;
    try {
      const { response: res, data: result } = await fetchCheckoutJson(`/api/admin-login?next=${encodeURIComponent(next)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
        signal: controller.signal,
      }, 15_000);
      if (controller.signal.aborted || request.current !== controller) return;
      const data = result || {};
      if (!res.ok) { setError(data.error || "Inloggning misslyckades"); return; }
      await router.replace(data.redirect || "/admin");
    } catch (cause) {
      if (!controller.signal.aborted && request.current === controller) {
        setError(cause instanceof CheckoutRequestTimeoutError
          ? "Inloggningen tog för lång tid. Försök igen."
          : "Kunde inte ansluta. Kontrollera anslutningen och försök igen.");
      }
    } finally {
      if (request.current === controller) {
        request.current = null;
        pending.current = false;
        setBusy(false);
      }
    }
  }

  return (
    <Layout title="Admin-inloggning" noIndex>
      <section className="mx-auto max-w-sm rounded-2xl border bg-white p-6 shadow-sm">
        <h1 className="mb-4 text-2xl font-semibold">Admin-inloggning</h1>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label htmlFor="admin-password" className="mb-1 block text-sm font-medium">Lösenord</label>
            <input id="admin-password" name="password" type="password" value={password} onChange={e=>setPassword(e.target.value)} className="w-full rounded-xl border px-3 py-2" autoComplete="current-password" autoFocus required disabled={busy} />
          </div>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <button className="rounded-xl bg-black px-4 py-2 text-white hover:bg-black/90 disabled:opacity-60" type="submit" disabled={busy}>{busy ? "Loggar in…" : "Logga in"}</button>
        </form>
      </section>
    </Layout>
  );
}
