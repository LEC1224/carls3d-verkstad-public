import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Layout from "../components/Layout";
import type { ColorOption } from "../lib/colors";
import { ALL_COLORS } from "../lib/colors";

type OrderDTO = {
  id: number;
  orderNumber?: string;
  createdAt: string;
  name: string;
  email: string;
  type: string;
  material?: string | null;
  color?: string | null;
  price: number;
  discount?: number;
  couponCode?: string | null;
  status: string;
  files: string[]; // if your /api/orders returns string[], else adjust
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

export default function Admin() {
  const router = useRouter();
  const [orders, setOrders] = useState<OrderDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [coupons, setCoupons] = useState<CouponRow[]>([]);
  const [matTab, setMatTab] = useState<"PLA"|"PETG"|"ABS"|"ASA"|"TPU">("PLA");
  const [couponCode, setCouponCode] = useState("");
  const [overallPercent, setOverallPercent] = useState(0);
  const [plasticPercent, setPlasticPercent] = useState(0);
  const [removeStartFee, setRemoveStartFee] = useState(false);
  const [removeExtraFileFee, setRemoveExtraFileFee] = useState(false);
  const [removeShipping, setRemoveShipping] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [oRes, iRes, cRes] = await Promise.all([
        fetch("/api/orders"),
        fetch("/api/admin/inventory"),
        fetch("/api/admin/coupons"),
      ]);

      if (oRes.status === 401 || iRes.status === 401 || cRes.status === 401) {
        router.replace(`/admin-login?next=${encodeURIComponent("/admin")}`);
        return;
      }

      if (!oRes.ok || !iRes.ok || !cRes.ok) {
        throw new Error("Kunde inte hämta admin-data.");
      }

      const o = await oRes.json();
      const i = await iRes.json();
      const c = await cRes.json();
      setOrders(Array.isArray(o) ? o : []);
      setInventory(Array.isArray(i) ? i : []);
      setCoupons(Array.isArray(c) ? c : []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function markComplete(id: number) {
    await fetch(`/api/admin/orders/${id}`, { method: "PATCH" });
    await load();
  }
  async function deleteOrder(id: number) {
    if (!confirm("Radera order permanent?")) return;
    await fetch(`/api/admin/orders/${id}`, { method: "DELETE" });
    await load();
  }
  async function testDiscord() {
    const r = await fetch("/api/admin/test", { method: "POST" });
    if (r.ok) alert("Test skickat!");
    else alert("Test misslyckades.");
  }

  const currentMaterialRows = inventory.filter(r => r.material === matTab);
  const currentAvailable = new Set(currentMaterialRows.filter(r => r.available).map(r => r.color));
  const colorRows: ColorOption[] = ALL_COLORS;

  async function toggleColor(color: string) {
    const available = !currentAvailable.has(color);
    await fetch("/api/admin/inventory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ material: matTab, color, available }),
    });
    await load();
  }

  async function setAllForMaterial(colors: string[]) {
    await fetch("/api/admin/inventory", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ material: matTab, colorsAvailable: colors }),
    });
    await load();
  }

  async function createCoupon(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/admin/coupons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: couponCode,
        overallPercent,
        plasticPercent,
        removeStartFee,
        removeExtraFileFee,
        removeShipping,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || "Kunde inte skapa rabattkod.");
      return;
    }
    setCouponCode("");
    setOverallPercent(0);
    setPlasticPercent(0);
    setRemoveStartFee(false);
    setRemoveExtraFileFee(false);
    setRemoveShipping(false);
    await load();
  }

  async function deleteCoupon(id: number) {
    if (!confirm("Radera rabattkod?")) return;
    const res = await fetch(`/api/admin/coupons/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Kunde inte radera rabattkod.");
      return;
    }
    await load();
  }

  return (
    <Layout>
      <section className="mx-auto max-w-6xl space-y-10">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">Admin</h1>
          <div className="flex items-center gap-3">
            <button onClick={testDiscord} className="rounded-xl border px-3 py-2 hover:bg-gray-50">Skicka testnotis</button>
            <button onClick={() => load()} className="rounded-xl border px-3 py-2 hover:bg-gray-50">Uppdatera</button>
          </div>
        </div>

        {/* Coupons */}
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <h2 className="text-xl font-semibold mb-3">Rabattkoder</h2>
          <form onSubmit={createCoupon} className="grid gap-4 lg:grid-cols-6">
            <div className="lg:col-span-2">
              <label className="mb-1 block text-sm font-medium">Giltig sträng</label>
              <input
                value={couponCode}
                onChange={(e) => setCouponCode(e.target.value)}
                className="w-full rounded-xl border px-3 py-2"
                placeholder="T.ex. SOMMAR25"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Total %</label>
              <input
                type="number"
                min={0}
                max={100}
                value={overallPercent}
                onChange={(e) => setOverallPercent(Number(e.target.value))}
                className="w-full rounded-xl border px-3 py-2"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Plast %</label>
              <input
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
            <button className="rounded-xl bg-black px-4 py-2 text-white hover:bg-black/90" type="submit">
              Lägg till
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
                    <td className="border p-2 text-gray-600" colSpan={7}>Inga rabattkoder ännu.</td>
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
                      <button onClick={() => deleteCoupon(coupon.id)} className="rounded-lg bg-red-600 px-3 py-1 text-white hover:bg-red-700">
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
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <h2 className="text-xl font-semibold mb-3">Ordrar</h2>
          {loading ? <p>Laddar…</p> : (
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="p-2 border">#</th>
                    <th className="p-2 border">Ordernr</th>
                    <th className="p-2 border">Kund</th>
                    <th className="p-2 border">Material/Färg</th>
                    <th className="p-2 border">Filer</th>
                    <th className="p-2 border">Pris</th>
                    <th className="p-2 border">Rabatt</th>
                    <th className="p-2 border">Status</th>
                    <th className="p-2 border">Adress</th>
                    <th className="p-2 border">Åtgärd</th>
                  </tr>
                </thead>
                <tbody>
                {orders.map(o => (
                  <tr key={o.id} className="odd:bg-white even:bg-gray-50">
                    <td className="p-2 border">{o.id}</td>
                    <td className="p-2 border">{o.orderNumber || "—"}</td>
                    <td className="p-2 border">
                      <div>{o.name}</div>
                      <div className="text-gray-500">{o.email}</div>
                    </td>
                    <td className="p-2 border">{o.material ?? "—"} / {o.color ?? "—"}</td>
                    <td className="p-2 border">
                      <div className="max-w-xs whitespace-pre-wrap break-words">
                        {Array.isArray(o.files) ? o.files.join(", ") : String(o.files)}
                      </div>
                    </td>
                    <td className="p-2 border">{o.price} kr</td>
                    <td className="p-2 border">
                      {o.couponCode ? (
                        <div>
                          <div>{o.couponCode}</div>
                          <div className="text-emerald-700">-{o.discount || 0} kr</div>
                        </div>
                      ) : "—"}
                    </td>
                    <td className="p-2 border">{o.status}</td>
                    <td className="p-2 border">
                      <div>{o.addressLine1}{o.addressLine2 ? `, ${o.addressLine2}` : ""}</div>
                      <div>{o.postalCode} {o.city}</div>
                      <div>{o.country}{o.phone ? `, Tel: ${o.phone}` : ""}</div>
                    </td>
                    <td className="p-2 border">
                      <div className="flex gap-2">
                        {o.status !== "Klar" && (
                          <button onClick={() => markComplete(o.id)} className="rounded-lg bg-emerald-600 px-3 py-1 text-white hover:bg-emerald-700">Markera klar</button>
                        )}
                        <button onClick={() => deleteOrder(o.id)} className="rounded-lg bg-red-600 px-3 py-1 text-white hover:bg-red-700">Radera</button>
                      </div>
                    </td>
                  </tr>
                ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Inventory */}
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Lager / Färg-tillgänglighet</h2>
            <div className="flex gap-2">
              {(["PLA","PETG","ABS","ASA","TPU"] as const).map(m => (
                <button key={m} onClick={()=>setMatTab(m)}
                  className={`rounded-lg px-3 py-1.5 border ${matTab===m ? "bg-black text-white" : "hover:bg-gray-50"}`}>
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {colorRows.map(c => {
              const on = currentAvailable.has(c.value);
              return (
                <button key={c.value} onClick={()=>toggleColor(c.value)}
                        className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left ${on ? "bg-emerald-50 border-emerald-200" : "hover:bg-gray-50"}`}>
                  <span className="h-4 w-4 rounded-full border" style={{ backgroundColor: c.hex }} />
                  <span className="text-sm">{c.label}</span>
                  <span className={`ml-auto text-xs ${on ? "text-emerald-700" : "text-gray-500"}`}>{on ? "Tillgänglig" : "Slut"}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex gap-2">
            <button onClick={()=>setAllForMaterial(colorRows.map(c=>c.value))} className="rounded-lg border px-3 py-2 hover:bg-gray-50">Markera alla som tillgängliga</button>
            <button onClick={()=>setAllForMaterial([])} className="rounded-lg border px-3 py-2 hover:bg-gray-50">Markera alla som slut</button>
          </div>
        </div>
      </section>
    </Layout>
  );
}
