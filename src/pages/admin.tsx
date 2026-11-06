import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import Layout from "../components/Layout";
import type { ColorOption } from "../lib/colors";
import { ALL_COLORS } from "../lib/colors";
import { formatSwedishDate } from "../lib/travelPeriods";
import type { TravelPeriodStatus } from "../lib/travelPeriods";
import { filterOrders, orderTypeLabels } from "../lib/adminOrders";
import type { OrderFilters } from "../lib/adminOrders";
import { CheckoutRequestTimeoutError, fetchCheckoutJson } from "../lib/checkoutRequest";

type OrderDTO = {
  id: number;
  orderNumber?: string;
  createdAt: string;
  name: string;
  email: string;
  type: string;
  price: number;
  discount?: number;
  couponCode?: string | null;
  status: string;
  deliveryMethod?: "shipping" | "pickup";
  files: string[];
  addressLine1?: string; addressLine2?: string | null;
  postalCode?: string; city?: string; country?: string; phone?: string | null;
};

type InventoryRow = { id: number; material: string; color: string; available: boolean };
type CouponRow = {
  id: number;
  code: string;
  overallPercent: number;
  plasticPercent: number;
  removeStartFee: boolean;
  removeExtraFileFee: boolean;
  removeShipping: boolean;
};
type TravelPeriodRow = {
  id: number;
  startsOn: string;
  returnsOn: string;
  cancelledAt: string | null;
  status: TravelPeriodStatus;
};

const travelStatusLabel: Record<TravelPeriodStatus, string> = {
  scheduled: "Planerad",
  active: "Pågår",
  ended: "Avslutad",
  cancelled: "Avbruten",
};

export default function Admin() {
  const router = useRouter();
  const [orders, setOrders] = useState<OrderDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const pendingActionRef = useRef<string | null>(null);
  const loadController = useRef<AbortController | null>(null);
  const lifecycle = useRef({ mounted: false, generation: 0 });
  const [filters, setFilters] = useState<OrderFilters>({ query: "", status: "all", type: "all", delivery: "all" });
  const [page, setPage] = useState(1);
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [coupons, setCoupons] = useState<CouponRow[]>([]);
  const [travelPeriods, setTravelPeriods] = useState<TravelPeriodRow[]>([]);
  const [startsOn, setStartsOn] = useState("");
  const [returnsOn, setReturnsOn] = useState("");
  const [matTab, setMatTab] = useState<"PLA"|"PETG"|"ABS"|"ASA"|"TPU">("PLA");
  const [couponCode, setCouponCode] = useState("");
  const [overallPercent, setOverallPercent] = useState(0);
  const [plasticPercent, setPlasticPercent] = useState(0);
  const [removeStartFee, setRemoveStartFee] = useState(false);
  const [removeExtraFileFee, setRemoveExtraFileFee] = useState(false);
  const [removeShipping, setRemoveShipping] = useState(false);

  function validateAdminResponse(response: Response, data: any) {
    if (response.status === 401) {
      void router.replace(`/admin-login?next=${encodeURIComponent("/admin")}`);
      throw new Error("Din inloggning har gått ut. Logga in igen.");
    }
    if (!response.ok) throw new Error(data?.error || "Åtgärden kunde inte slutföras. Försök igen.");
    return data;
  }

  function isCurrentGeneration(generation: number) {
    return lifecycle.current.mounted && lifecycle.current.generation === generation;
  }

  async function readAdminResponse(response: Response, generation: number) {
    if (!isCurrentGeneration(generation)) return false;
    const data = await response.json().catch(() => null);
    if (!isCurrentGeneration(generation)) return false;
    validateAdminResponse(response, data);
    return true;
  }

  async function load() {
    const generation = lifecycle.current.generation;
    if (!isCurrentGeneration(generation)) return;
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    setLoading(true);
    setLoadError("");
    try {
      const data = await Promise.all([
        "/api/orders", "/api/admin/inventory", "/api/admin/coupons", "/api/admin/travel-periods",
      ].map(async (url) => {
        const { response, data } = await fetchCheckoutJson(url, {
          signal: controller.signal, cache: "no-store",
        }, 15_000);
        if (controller.signal.aborted || !isCurrentGeneration(generation)) return [];
        const rows = validateAdminResponse(response, data);
        if (!Array.isArray(rows)) throw new Error("Servern skickade ett oväntat svar. Försök uppdatera igen.");
        return rows;
      }));
      if (controller.signal.aborted || !isCurrentGeneration(generation)) return;
      setOrders(data[0]);
      setInventory(data[1]);
      setCoupons(data[2]);
      setTravelPeriods(data[3]);
      setHasLoaded(true);
    } catch (error) {
      if (!controller.signal.aborted && isCurrentGeneration(generation)) {
        setLoadError(error instanceof CheckoutRequestTimeoutError
          ? "Hämtningen tog för lång tid. Kontrollera anslutningen och försök igen."
          : error instanceof Error && !(error instanceof TypeError) ? error.message : "Kunde inte hämta admin-data. Kontrollera anslutningen.");
      }
    } finally {
      controller.abort();
      if (loadController.current === controller && isCurrentGeneration(generation)) setLoading(false);
    }
  }

  useEffect(() => {
    lifecycle.current.mounted = true;
    lifecycle.current.generation += 1;
    void load();
    return () => {
      lifecycle.current.mounted = false;
      lifecycle.current.generation += 1;
      pendingActionRef.current = null;
      loadController.current?.abort();
    };
  }, []);

  async function runAction(key: string, request: () => Promise<Response>, successMessage: string, refresh = true) {
    const generation = lifecycle.current.generation;
    if (!isCurrentGeneration(generation) || pendingActionRef.current || loading || (!hasLoaded && key !== "logout")) return false;
    pendingActionRef.current = key;
    setPendingAction(key);
    setActionError("");
    setActionNotice("");
    try {
      const accepted = await readAdminResponse(await request(), generation);
      if (!accepted || !isCurrentGeneration(generation)) return false;
      setActionNotice(successMessage);
      if (refresh) await load();
      return isCurrentGeneration(generation);
    } catch (error) {
      if (isCurrentGeneration(generation)) {
        setActionError(error instanceof Error && !(error instanceof TypeError) ? error.message : "Åtgärden misslyckades. Kontrollera anslutningen och försök igen.");
      }
      return false;
    } finally {
      if (isCurrentGeneration(generation)) {
        pendingActionRef.current = null;
        setPendingAction(null);
      }
    }
  }

  const busy = loading || Boolean(pendingAction) || !hasLoaded;
  const currentMaterialRows = inventory.filter((row) => row.material === matTab);
  const currentAvailable = new Set(currentMaterialRows.length
    ? currentMaterialRows.filter((row) => row.available).map((row) => row.color)
    : ALL_COLORS.map((color) => color.value));
  const colorRows: ColorOption[] = ALL_COLORS;
  const visibleOrders = useMemo(() => filterOrders(orders, filters), [orders, filters]);
  const pageCount = Math.max(1, Math.ceil(visibleOrders.length / 25));
  const currentPage = Math.min(page, pageCount);
  const pageOrders = visibleOrders.slice((currentPage - 1) * 25, currentPage * 25);
  const openOrderCount = orders.filter((order) => order.status !== "Klar").length;
  const orderTypes = Array.from(new Set([
    ...Object.keys(orderTypeLabels),
    ...orders.map((order) => order.type),
    ...(filters.type === "all" ? [] : [filters.type]),
  ]));

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  function updateFilters(next: Partial<OrderFilters>) {
    setFilters((current) => ({ ...current, ...next }));
    setPage(1);
  }

  async function markComplete(id: number) {
    await runAction(`complete-${id}`, () => fetch(`/api/admin/orders/${id}`, { method: "PATCH" }), "Ordern är markerad som klar.");
  }

  async function deleteOrder(order: OrderDTO) {
    if (busy || !confirm(`Radera order ${order.orderNumber || order.id} för ${order.name} permanent?`)) return;
    await runAction(`delete-order-${order.id}`, () => fetch(`/api/admin/orders/${order.id}`, { method: "DELETE" }), "Ordern är raderad.");
  }

  async function testDiscord() {
    await runAction("test", () => fetch("/api/admin/test", { method: "POST" }), "Testnotisen har skickats.", false);
  }

  async function logout() {
    const generation = lifecycle.current.generation;
    const saved = await runAction("logout", () => fetch("/api/admin-logout", { method: "POST" }), "Du är utloggad.", false);
    if (saved && isCurrentGeneration(generation)) void router.replace("/admin-login");
  }

  async function toggleColor(color: string) {
    const available = !currentAvailable.has(color);
    await runAction(`color-${color}`, () => fetch("/api/admin/inventory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ material: matTab, color, available }),
    }), `Färgtillgängligheten för ${matTab} är uppdaterad.`);
  }

  async function setAllForMaterial(colors: string[]) {
    await runAction("colors-all", () => fetch("/api/admin/inventory", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ material: matTab, colorsAvailable: colors }),
    }), `Färgtillgängligheten för ${matTab} är uppdaterad.`);
  }

  async function createCoupon(event: React.FormEvent) {
    event.preventDefault();
    const generation = lifecycle.current.generation;
    const saved = await runAction("coupon-create", () => fetch("/api/admin/coupons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: couponCode, overallPercent, plasticPercent, removeStartFee, removeExtraFileFee, removeShipping }),
    }), "Rabattkoden är tillagd.");
    if (!saved || !isCurrentGeneration(generation)) return;
    setCouponCode("");
    setOverallPercent(0);
    setPlasticPercent(0);
    setRemoveStartFee(false);
    setRemoveExtraFileFee(false);
    setRemoveShipping(false);
  }

  async function deleteCoupon(coupon: CouponRow) {
    if (busy || !confirm(`Radera rabattkoden ${coupon.code}?`)) return;
    await runAction(`delete-coupon-${coupon.id}`, () => fetch(`/api/admin/coupons/${coupon.id}`, { method: "DELETE" }), "Rabattkoden är raderad.");
  }

  async function createTravelPeriod(event: React.FormEvent) {
    event.preventDefault();
    const generation = lifecycle.current.generation;
    const saved = await runAction("travel-create", () => fetch("/api/admin/travel-periods", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startsOn, returnsOn }),
    }), "Bortresan är tillagd.");
    if (saved && isCurrentGeneration(generation)) {
      setStartsOn("");
      setReturnsOn("");
    }
  }

  async function cancelTravelPeriod(id: number) {
    if (busy || !confirm("Avbryt bortresan? Varningen slutar visas på beställningssidorna.")) return;
    await runAction(`travel-cancel-${id}`, () => fetch(`/api/admin/travel-periods/${id}`, { method: "PATCH" }), "Bortresan är avbruten.");
  }

  return (
    <Layout title="Admin" noIndex>
      <section className="mx-auto max-w-6xl space-y-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-3xl font-bold">Admin</h1>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={testDiscord} disabled={busy} className="rounded-xl border px-3 py-2 hover:bg-gray-50 disabled:opacity-60">{pendingAction === "test" ? "Skickar…" : "Skicka testnotis"}</button>
            <button type="button" onClick={() => load()} disabled={loading || Boolean(pendingAction)} className="rounded-xl border px-3 py-2 hover:bg-gray-50 disabled:opacity-60">{loading ? "Uppdaterar…" : "Uppdatera"}</button>
            <button type="button" onClick={logout} disabled={loading || Boolean(pendingAction)} className="rounded-xl border px-3 py-2 hover:bg-gray-50 disabled:opacity-60">Logga ut</button>
          </div>
        </div>

        <nav aria-label="Adminverktyg" className="flex flex-wrap gap-2 text-sm">
          <a href="#admin-orders" className="rounded-xl border bg-white px-4 py-2">Ordrar{hasLoaded ? ` (${openOrderCount} ej klara)` : ""}</a>
          <a href="#admin-inventory" className="rounded-xl border bg-white px-4 py-2">Lager & färger</a>
          <a href="#admin-coupons" className="rounded-xl border bg-white px-4 py-2">Rabattkoder</a>
          <a href="#admin-travel" className="rounded-xl border bg-white px-4 py-2">Bortresor</a>
        </nav>

        {loadError && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">{loadError} {hasLoaded ? "Senast hämtade uppgifter visas." : "Använd Uppdatera för att försöka igen."}</p>}
        {(actionError || actionNotice) && (
          <div className="sticky top-24 z-20">
            {actionError ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800 shadow-sm">{actionError}</p>
              : <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900 shadow-sm">{actionNotice}</p>}
          </div>
        )}

        {/* Travel periods */}
        <div id="admin-travel" className="rounded-2xl border border-amber-200 bg-white p-4 shadow-sm">
          <div className="mb-4">
            <h2 className="text-xl font-semibold">Bortresor</h2>
            <p className="mt-1 text-sm text-gray-600">
              Varningen visas på alla beställningssidor från avresedagen och försvinner på hemkomstdagen.
            </p>
          </div>

          <form onSubmit={createTravelPeriod}>
          <fieldset disabled={busy} className="grid items-end gap-4 sm:grid-cols-3">
            <legend className="sr-only">Lägg till bortresa</legend>
            <div>
              <label htmlFor="travel-start" className="mb-1 block text-sm font-medium">Avresedatum</label>
              <input
                id="travel-start"
                type="date"
                value={startsOn}
                onChange={(e) => setStartsOn(e.target.value)}
                className="w-full rounded-xl border px-3 py-2"
                required
              />
            </div>
            <div>
              <label htmlFor="travel-return" className="mb-1 block text-sm font-medium">Hemma igen</label>
              <input
                id="travel-return"
                type="date"
                value={returnsOn}
                min={startsOn || undefined}
                onChange={(e) => setReturnsOn(e.target.value)}
                className="w-full rounded-xl border px-3 py-2"
                required
              />
            </div>
            <button
              className="rounded-xl bg-amber-500 px-4 py-2 text-amber-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
              type="submit"
              disabled={busy}
            >
              {pendingAction === "travel-create" ? "Sparar…" : "Lägg till bortresa"}
            </button>
          </fieldset>
          </form>

          <div className="mt-5 overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="border p-2 text-left">Avresa</th>
                  <th className="border p-2 text-left">Hemma igen</th>
                  <th className="border p-2 text-left">Status</th>
                  <th className="border p-2 text-left">Åtgärd</th>
                </tr>
              </thead>
              <tbody>
                {travelPeriods.length === 0 ? (
                  <tr>
                    <td className="border p-2 text-gray-600" colSpan={4}>{hasLoaded ? "Inga bortresor registrerade." : loading ? "Laddar bortresor…" : "Bortresorna kunde inte hämtas."}</td>
                  </tr>
                ) : travelPeriods.map((period) => (
                  <tr key={period.id} className="odd:bg-white even:bg-gray-50">
                    <td className="border p-2">{formatSwedishDate(period.startsOn)}</td>
                    <td className="border p-2">{formatSwedishDate(period.returnsOn)}</td>
                    <td className="border p-2">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                        period.status === "active"
                          ? "bg-amber-100 text-amber-900"
                          : period.status === "scheduled"
                            ? "bg-blue-100 text-blue-800"
                            : "bg-gray-100 text-gray-600"
                      }`}>
                        {travelStatusLabel[period.status]}
                      </span>
                    </td>
                    <td className="border p-2">
                      {(period.status === "active" || period.status === "scheduled") ? (
                        <button
                          type="button"
                          onClick={() => cancelTravelPeriod(period.id)}
                          disabled={busy}
                          aria-label={`Avbryt bortresan ${formatSwedishDate(period.startsOn)}`}
                          className="rounded-lg border border-red-300 px-3 py-1 text-red-700 hover:bg-red-50 disabled:opacity-60"
                        >
                          Avbryt
                        </button>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Coupons */}
        <div id="admin-coupons" className="rounded-2xl border bg-white p-4 shadow-sm">
          <h2 className="text-xl font-semibold mb-3">Rabattkoder</h2>
          <form onSubmit={createCoupon}>
          <fieldset disabled={busy} className="grid gap-4 lg:grid-cols-6">
            <legend className="sr-only">Lägg till rabattkod</legend>
            <div className="lg:col-span-2">
              <label htmlFor="coupon-code" className="mb-1 block text-sm font-medium">Rabattkod</label>
              <input
                id="coupon-code"
                required
                autoComplete="off"
                value={couponCode}
                onChange={(e) => setCouponCode(e.target.value)}
                className="w-full rounded-xl border px-3 py-2"
                placeholder="T.ex. SOMMAR25"
              />
            </div>
            <div>
              <label htmlFor="coupon-total" className="mb-1 block text-sm font-medium">Total %</label>
              <input
                id="coupon-total"
                type="number"
                min={0}
                max={100}
                value={overallPercent}
                onChange={(e) => setOverallPercent(Number(e.target.value))}
                className="w-full rounded-xl border px-3 py-2"
              />
            </div>
            <div>
              <label htmlFor="coupon-plastic" className="mb-1 block text-sm font-medium">Plast %</label>
              <input
                id="coupon-plastic"
                type="number"
                min={0}
                max={100}
                value={plasticPercent}
                onChange={(e) => setPlasticPercent(Number(e.target.value))}
                className="w-full rounded-xl border px-3 py-2"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={removeStartFee} onChange={(e) => setRemoveStartFee(e.target.checked)} />
              Ta bort startpris
            </label>
            <button disabled={busy} className="rounded-xl bg-black px-4 py-2 text-white hover:bg-black/90 disabled:opacity-60" type="submit">
              {pendingAction === "coupon-create" ? "Sparar…" : "Lägg till"}
            </button>
            <label className="flex items-center gap-2 text-sm lg:col-start-3">
              <input
                type="checkbox"
                checked={removeExtraFileFee}
                onChange={(e) => setRemoveExtraFileFee(e.target.checked)}
              />
              Ta bort extra filpris
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={removeShipping} onChange={(e) => setRemoveShipping(e.target.checked)} />
              Ta bort frakt
            </label>
          </fieldset>
          </form>

          <div className="mt-4 overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="border p-2 text-left">Kod</th>
                  <th className="border p-2">Total %</th>
                  <th className="border p-2">Plast %</th>
                  <th className="border p-2">Start</th>
                  <th className="border p-2">Extra fil</th>
                  <th className="border p-2">Frakt</th>
                  <th className="border p-2">Åtgärd</th>
                </tr>
              </thead>
              <tbody>
                {coupons.length === 0 ? (
                  <tr>
                    <td className="border p-2 text-gray-600" colSpan={7}>{hasLoaded ? "Inga rabattkoder ännu." : loading ? "Laddar rabattkoder…" : "Rabattkoderna kunde inte hämtas."}</td>
                  </tr>
                ) : coupons.map((coupon) => (
                  <tr key={coupon.id} className="odd:bg-white even:bg-gray-50">
                    <td className="border p-2 font-medium">{coupon.code}</td>
                    <td className="border p-2 text-center">{coupon.overallPercent}</td>
                    <td className="border p-2 text-center">{coupon.plasticPercent}</td>
                    <td className="border p-2 text-center">{coupon.removeStartFee ? "Ja" : "Nej"}</td>
                    <td className="border p-2 text-center">{coupon.removeExtraFileFee ? "Ja" : "Nej"}</td>
                    <td className="border p-2 text-center">{coupon.removeShipping ? "Ja" : "Nej"}</td>
                    <td className="border p-2 text-center">
                      <button type="button" onClick={() => deleteCoupon(coupon)} disabled={busy} aria-label={`Radera rabattkoden ${coupon.code}`} className="rounded-lg bg-red-600 px-3 py-1 text-white hover:bg-red-700 disabled:opacity-60">
                        Radera
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Orders */}
        <div id="admin-orders" className="min-w-0 rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xl font-semibold">Ordrar</h2>
            {hasLoaded && <p className="text-sm text-gray-600">{orders.length} totalt · {openOrderCount} ej klara · {orders.length - openOrderCount} klara</p>}
          </div>
          <div className="my-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label htmlFor="order-search" className="mb-1 block text-sm font-medium">Sök order</label>
              <input
                id="order-search" type="search" value={filters.query}
                onChange={(event) => updateFilters({ query: event.target.value })}
                placeholder="Ordernr, kund, fil eller ort"
                className="w-full rounded-xl border px-3 py-2"
              />
            </div>
            <div>
              <label htmlFor="order-status" className="mb-1 block text-sm font-medium">Status</label>
              <select id="order-status" value={filters.status} onChange={(event) => updateFilters({ status: event.target.value as OrderFilters["status"] })} className="w-full rounded-xl border px-3 py-2">
                <option value="all">Alla statusar</option>
                <option value="open">Ej klara</option>
                <option value="complete">Klara</option>
              </select>
            </div>
            <div>
              <label htmlFor="order-type" className="mb-1 block text-sm font-medium">Produkt</label>
              <select id="order-type" value={filters.type} onChange={(event) => updateFilters({ type: event.target.value })} className="w-full rounded-xl border px-3 py-2">
                <option value="all">Alla produkter</option>
                {orderTypes.map((type) => <option key={type} value={type}>{orderTypeLabels[type] || type}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="order-delivery" className="mb-1 block text-sm font-medium">Leverans</label>
              <select id="order-delivery" value={filters.delivery} onChange={(event) => updateFilters({ delivery: event.target.value as OrderFilters["delivery"] })} className="w-full rounded-xl border px-3 py-2">
                <option value="all">Alla leveranssätt</option>
                <option value="shipping">Frakt</option>
                <option value="pickup">Avhämtning</option>
              </select>
            </div>
          </div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
            {hasLoaded && <p role="status">{visibleOrders.length} av {orders.length} ordrar matchar</p>}
            <button type="button" onClick={() => updateFilters({ query: "", status: "all", type: "all", delivery: "all" })} className="rounded-lg border px-3 py-2 hover:bg-gray-50">Rensa filter</button>
          </div>
          {loading && !hasLoaded ? <p role="status">Laddar ordrar…</p> : (
            <div className="overflow-auto" role="region" aria-label="Orderlista" tabIndex={0} aria-busy={loading}>
              <table className="min-w-full text-sm">
                <caption className="sr-only">Ordrar, nyaste först. Sida {currentPage} av {pageCount}.</caption>
                <thead className="bg-gray-50 text-left">
                  <tr>
                    {["Order", "Produkt", "Kund", "Filer", "Pris", "Status", "Leverans", "Åtgärd"].map((heading) => <th scope="col" key={heading} className="border p-2">{heading}</th>)}
                  </tr>
                </thead>
                <tbody>
                {!pageOrders.length && (
                  <tr><td colSpan={8} className="border p-6 text-center text-gray-600">
                    {!hasLoaded ? "Orderlistan kunde inte hämtas." : orders.length ? "Inga ordrar matchar dina filter. Prova en annan sökning eller rensa filtren." : "Inga ordrar har kommit in ännu."}
                  </td></tr>
                )}
                {pageOrders.map((order) => (
                  <tr key={order.id} className="align-top odd:bg-white even:bg-gray-50">
                    <th scope="row" className="border p-2 text-left font-normal">
                      <div className="whitespace-nowrap font-medium">{order.orderNumber || `#${order.id}`}</div>
                      <time dateTime={order.createdAt} className="mt-1 block whitespace-nowrap text-xs text-gray-500">
                        {new Date(order.createdAt).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Stockholm" })}
                      </time>
                    </th>
                    <td className="border p-2">{orderTypeLabels[order.type] || order.type}</td>
                    <td className="border p-2">
                      <div>{order.name}</div>
                      <a href={`mailto:${order.email}`} className="break-all text-gray-600 underline">{order.email}</a>
                      {order.phone && <a href={`tel:${order.phone.replace(/[^+0-9]/g, "")}`} className="mt-1 block whitespace-nowrap text-gray-600 underline">{order.phone}</a>}
                    </td>
                    <td className="border p-2">
                      <div className="max-w-xs break-words">{order.files.length ? order.files.join(", ") : "—"}</div>
                    </td>
                    <td className="border p-2">
                      <div className="whitespace-nowrap font-medium">{order.price} kr</div>
                      {order.couponCode && <div className="mt-1 text-xs text-emerald-700">{order.couponCode}: −{order.discount || 0} kr</div>}
                    </td>
                    <td className="border p-2"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${order.status === "Klar" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>{order.status}</span></td>
                    <td className="border p-2">
                      {order.deliveryMethod === "pickup" ? <span className="font-medium text-emerald-700">Avhämtning</span> : <>
                        <div>{order.addressLine1}{order.addressLine2 ? `, ${order.addressLine2}` : ""}</div>
                        <div>{order.postalCode} {order.city}</div>
                        <div>{order.country}</div>
                      </>}
                    </td>
                    <td className="border p-2">
                      <div className="flex flex-col items-start gap-2">
                        {order.status !== "Klar" && <button type="button" onClick={() => markComplete(order.id)} disabled={busy} aria-label={`Markera order ${order.orderNumber || order.id} som klar`} className="whitespace-nowrap rounded-lg bg-emerald-600 px-3 py-2 text-white hover:bg-emerald-700 disabled:opacity-60">{pendingAction === `complete-${order.id}` ? "Sparar…" : "Markera klar"}</button>}
                        <button type="button" onClick={() => deleteOrder(order)} disabled={busy} aria-label={`Radera order ${order.orderNumber || order.id}`} className="rounded-lg border border-red-300 px-3 py-2 text-red-700 hover:bg-red-50 disabled:opacity-60">{pendingAction === `delete-order-${order.id}` ? "Raderar…" : "Radera"}</button>
                      </div>
                    </td>
                  </tr>
                ))}
                </tbody>
              </table>
            </div>
          )}
          {pageCount > 1 && <nav aria-label="Sidor i orderlistan" className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
            <button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} className="rounded-lg border px-3 py-2 hover:bg-gray-50 disabled:opacity-50">Föregående sida</button>
            <span>Sida {currentPage} av {pageCount}</span>
            <button type="button" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)} className="rounded-lg border px-3 py-2 hover:bg-gray-50 disabled:opacity-50">Nästa sida</button>
          </nav>}
        </div>

        {/* Inventory */}
        <div id="admin-inventory" className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-xl font-semibold">Lager / Färg-tillgänglighet</h2>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Välj material">
              {(["PLA","PETG","ABS","ASA","TPU"] as const).map(m => (
                <button key={m} type="button" onClick={()=>setMatTab(m)} aria-pressed={matTab === m} disabled={Boolean(pendingAction)}
                  className={`rounded-lg px-3 py-1.5 border ${matTab===m ? "bg-black text-white" : "hover:bg-gray-50"}`}>
                  {m}
                </button>
              ))}
            </div>
          </div>

          {hasLoaded && !currentMaterialRows.length && <p className="mt-3 text-sm text-gray-600">Inga lagerinställningar är sparade för {matTab}. Alla färger visas som tillgängliga tills du ändrar dem här.</p>}

          {!hasLoaded ? <p className="mt-4 text-sm text-gray-600">{loading ? "Laddar färgtillgänglighet…" : "Färgtillgängligheten kunde inte hämtas."}</p> : <>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {colorRows.map(c => {
              const on = currentAvailable.has(c.value);
              return (
                <button key={c.value} type="button" onClick={()=>toggleColor(c.value)} disabled={busy} aria-pressed={on} aria-label={`${matTab} ${c.label}`}
                        className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left disabled:opacity-60 ${on ? "bg-emerald-50 border-emerald-200" : "hover:bg-gray-50"}`}>
                  <span className="h-4 w-4 shrink-0 rounded-full border" style={{ backgroundColor: c.hex }} aria-hidden="true" />
                  <span className="text-sm">{c.label}</span>
                  <span className={`ml-auto text-xs ${on ? "text-emerald-700" : "text-gray-500"}`}>{on ? "Tillgänglig" : "Slut"}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={()=>setAllForMaterial(colorRows.map(c=>c.value))} className="rounded-lg border px-3 py-2 hover:bg-gray-50 disabled:opacity-60">Markera alla som tillgängliga</button>
            <button type="button" disabled={busy} onClick={()=>setAllForMaterial([])} className="rounded-lg border px-3 py-2 hover:bg-gray-50 disabled:opacity-60">Markera alla som slut</button>
          </div>
          </>}
        </div>
      </section>
    </Layout>
  );
}
