import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import Layout from "../components/Layout";
import ColorSelect from "../components/ColorSelect";
import type { ColorOption } from "../lib/colors";
import MaterialsInfo from "../components/MaterialsInfo";
import DeliveryMethodSelector from "../components/DeliveryMethodSelector";
import ModelPreview from "../components/ModelPreview";
import type { DeliveryMethod } from "../lib/delivery";
import { createRequestGate, formatFileSize, isValidCopies, validateModelCart } from "../lib/checkout";
import { MAX_MODEL_COPIES, MAX_MODEL_FILES, SUPPORTED_MATERIALS } from "../lib/validation";
import { CheckoutRequestTimeoutError, fetchCheckoutJson } from "../lib/checkoutRequest";

type Breakdown = {
  packagingGrams: number; materialCost: number; fileFee: number; baseFee: number;
  shipping: number; total: number; totalBeforeDiscount?: number;
  coupon?: { code: string; discount: number };
  items: Array<{ index: number; name: string; material: string; color: string; copies: number;
    gramsEach: number; perGram: number; materialCost: number }>;
};
type CartItem = { id: string; file: File; material: string; color: string; copies: string; purpose: "general" | "functional"; availColors: ColorOption[] };
type Confirmation = { orderNumber: string; email: string; deliveryMethod: DeliveryMethod; breakdown: Breakdown };

const money = (value: number) => value.toLocaleString("sv-SE", { maximumFractionDigits: 2 }) + " kr";
const inputClass = "w-full rounded-xl border border-gray-300 bg-white px-3 py-2 disabled:bg-gray-100";

function itemForm(items: CartItem[], couponCode: string, deliveryMethod: DeliveryMethod) {
  const form = new FormData();
  for (const item of items) form.append("files", item.file);
  form.append("itemsMeta", JSON.stringify(items.map((item) => ({
    name: item.file.name, material: item.material, color: item.color, copies: Number(item.copies),
    purpose: item.purpose,
  }))));
  form.append("couponCode", couponCode.trim());
  form.append("deliveryMethod", deliveryMethod);
  return form;
}

export default function OrderPage() {
  const [items, setItems] = useState<CartItem[]>([]);
  const itemsRef = useRef<CartItem[]>([]);
  const [materialDefault, setMaterialDefault] = useState("PLA");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busyFiles, setBusyFiles] = useState(false);
  const [pendingMaterials, setPendingMaterials] = useState<string[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const colorsCache = useRef<Record<string, { colors: ColorOption[]; expires: number }>>({});
  const colorsRequests = useRef<Record<string, Promise<ColorOption[]>>>({});
  const [materialAvailability, setMaterialAvailability] = useState<Record<string, boolean>>({});
  const availabilityMounted = useRef(true);
  const nextItemId = useRef(0);
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null);
  const [busyQuote, setBusyQuote] = useState(false);
  const [busyOrder, setBusyOrder] = useState(false);
  const orderInFlight = useRef(false);
  const quoteController = useRef<AbortController | null>(null);
  const quoteGate = useRef(createRequestGate());
  const [showSlowQuoteHint, setShowSlowQuoteHint] = useState(false);
  const [couponCode, setCouponCode] = useState("");
  const [error, setError] = useState("");
  const errorRef = useRef<HTMLDivElement>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const confirmationRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>("shipping");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("Sverige");
  const [phone, setPhone] = useState("");
  const pendingOptions = busyFiles || pendingMaterials.length > 0;

  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => { if (confirmation) confirmationRef.current?.focus(); }, [confirmation]);
  useEffect(() => () => { quoteController.current?.abort(); quoteGate.current.invalidate(); }, []);
  useEffect(() => {
    let cancelled = false;
    availabilityMounted.current = true;
    void Promise.allSettled(SUPPORTED_MATERIALS.map((material) => loadColorsFor(material))).then(() => {
      if (cancelled) return;
      setMaterialDefault((current) => {
        if (colorsCache.current[current]?.colors.length !== 0) return current;
        return SUPPORTED_MATERIALS.find((material) => (colorsCache.current[material]?.colors.length ?? 0) > 0) || current;
      });
    });
    return () => { cancelled = true; availabilityMounted.current = false; };
  }, []);
  useEffect(() => {
    if (!busyQuote) { setShowSlowQuoteHint(false); return; }
    const timeout = window.setTimeout(() => setShowSlowQuoteHint(true), 5000);
    return () => window.clearTimeout(timeout);
  }, [busyQuote]);

  function updateItems(update: (previous: CartItem[]) => CartItem[]) {
    const next = update(itemsRef.current);
    itemsRef.current = next;
    setItems(next);
  }
  function invalidateQuote() {
    quoteGate.current.invalidate();
    quoteController.current?.abort();
    quoteController.current = null;
    setBusyQuote(false);
    setBreakdown(null);
  }
  async function loadColorsFor(material: string): Promise<ColorOption[]> {
    const cached = colorsCache.current[material];
    if (cached && cached.expires > Date.now()) return cached.colors;
    if (colorsRequests.current[material]) return colorsRequests.current[material];
    const request = (async () => {
      const { response, data } = await fetchCheckoutJson("/api/availability?material=" + encodeURIComponent(material), {}, 15_000);
      if (!response.ok) throw new Error("Kunde inte hämta färger.");
      const colors: ColorOption[] = data;
      if (!Array.isArray(colors) || colors.some((color) => !color || typeof color.value !== "string" || typeof color.label !== "string")) {
        throw new Error("Kunde inte läsa färger.");
      }
      colorsCache.current[material] = { colors, expires: Date.now() + 60_000 };
      if (availabilityMounted.current) setMaterialAvailability((current) => ({ ...current, [material]: colors.length > 0 }));
      return colors;
    })();
    colorsRequests.current[material] = request;
    try { return await request; }
    finally { delete colorsRequests.current[material]; }
  }
  function materialOptions() {
    return SUPPORTED_MATERIALS.map((material) => <option key={material} value={material} disabled={materialAvailability[material] === false}>{material}{materialAvailability[material] === false ? " (slut)" : ""}</option>);
  }
  async function onFilesChosen(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length || orderInFlight.current) return;
    setError("");
    const validationError = validateModelCart([...itemsRef.current.map((item) => item.file), ...files]);
    if (validationError) { setError(validationError); return; }
    setBusyFiles(true);
    try {
      const colors = await loadColorsFor(materialDefault);
      if (!colors.length) {
        setError("Inga färger är tillgängliga för " + materialDefault + " just nu. Välj ett annat standardmaterial eller kontakta mig.");
        return;
      }
      const currentError = validateModelCart([...itemsRef.current.map((item) => item.file), ...files]);
      if (currentError) { setError(currentError); return; }
      updateItems((previous) => [...previous, ...files.map((file) => ({
        id: "model-" + (++nextItemId.current), file, material: materialDefault,
        color: colors[0].value, copies: "1", purpose: "general" as const, availColors: colors,
      }))]);
      setConfirmation(null);
      invalidateQuote();
    } catch (cause) {
      setError(cause instanceof CheckoutRequestTimeoutError
        ? "Det tog för lång tid att hämta färgerna. Dina befintliga filer finns kvar. Välj filerna igen för att försöka på nytt."
        : "Kunde inte hämta tillgängliga färger. Dina befintliga filer finns kvar. Kontrollera anslutningen och välj filerna igen.");
    } finally { setBusyFiles(false); }
  }
  function removeItem(id: string) {
    if (previewId === id) setPreviewId(null);
    setPendingMaterials((previous) => previous.filter((entry) => entry !== id));
    updateItems((previous) => previous.filter((item) => item.id !== id));
    setError("");
    invalidateQuote();
  }
  function duplicateItem(id: string) {
    const item = itemsRef.current.find((entry) => entry.id === id);
    if (!item) return;
    const validationError = validateModelCart([...itemsRef.current.map((entry) => entry.file), item.file]);
    if (validationError) { setError(validationError); return; }
    updateItems((previous) => [...previous, { ...item, id: "model-" + (++nextItemId.current) }]);
    setError("");
    invalidateQuote();
  }
  async function changeItemMaterial(id: string, material: string) {
    invalidateQuote();
    setError("");
    setPendingMaterials((previous) => [...previous, id]);
    try {
      const colors = await loadColorsFor(material);
      if (!itemsRef.current.some((item) => item.id === id)) return;
      if (!colors.length) {
        setError("Inga färger är tillgängliga för " + material + " just nu. Det tidigare materialet är kvar.");
        return;
      }
      updateItems((previous) => previous.map((item) => item.id === id ? {
        ...item, material, availColors: colors,
        color: colors.some((color) => color.value === item.color) ? item.color : colors[0].value,
      } : item));
    } catch (cause) {
      if (itemsRef.current.some((item) => item.id === id)) {
        setError(cause instanceof CheckoutRequestTimeoutError
          ? "Det tog för lång tid att hämta färgerna. Det tidigare materialet är kvar. Välj material igen för att försöka på nytt."
          : "Kunde inte byta material eftersom färgerna inte gick att hämta. Det tidigare valet är kvar. Försök igen.");
      }
    } finally { setPendingMaterials((previous) => previous.filter((entry) => entry !== id)); }
  }
  function changeItem(id: string, change: Partial<Pick<CartItem, "color" | "copies" | "purpose">>) {
    updateItems((previous) => previous.map((item) => item.id === id ? { ...item, ...change } : item));
    invalidateQuote();
  }
  async function refreshUnavailableColors() {
    invalidateQuote();
    const affectedItems = itemsRef.current.map((item) => item.id);
    const materials = Array.from(new Set(itemsRef.current.map((item) => item.material)));
    setPendingMaterials((previous) => Array.from(new Set([...previous, ...affectedItems])));
    for (const material of materials) delete colorsCache.current[material];
    const refreshed = await Promise.allSettled(materials.map(async (material) => ({
      material, colors: await loadColorsFor(material),
    })));
    for (const result of refreshed) {
      if (result.status !== "fulfilled") continue;
      const { material, colors } = result.value;
      updateItems((previous) => previous.map((item) => item.material === material ? {
        ...item, availColors: colors,
        color: colors.some((color) => color.value === item.color) ? item.color : "",
      } : item));
    }
    if (refreshed.some((result) => result.status === "rejected")) {
      setError("Den valda färgen är inte längre tillgänglig och färglistan kunde inte uppdateras. Kontrollera anslutningen och byt material för att hämta färger igen. Dina filer finns kvar.");
    }
    setPendingMaterials((previous) => previous.filter((id) => !affectedItems.includes(id)));
  }
  function validateCart(): boolean {
    if (!itemsRef.current.length) { setError("Lägg till minst en STL- eller OBJ-fil först."); return false; }
    const validationError = validateModelCart(itemsRef.current.map((item) => item.file));
    if (validationError) { setError(validationError); return false; }
    if (itemsRef.current.some((item) => !isValidCopies(Number(item.copies)))) {
      setError("Ange ett helt antal kopior mellan 1 och " + MAX_MODEL_COPIES + " för varje objekt.");
      return false;
    }
    if (itemsRef.current.some((item) => !item.availColors.some((color) => color.value === item.color))) {
      setError("Välj en tillgänglig färg för varje objekt. Om inga färger finns, välj ett annat material eller kontakta mig.");
      return false;
    }
    return true;
  }
  async function doQuote() {
    if (orderInFlight.current || pendingOptions || !validateCart()) return;
    invalidateQuote();
    const revision = quoteGate.current.invalidate();
    const controller = new AbortController();
    quoteController.current = controller;
    setError("");
    setBusyQuote(true);
    try {
      const { response, data: result } = await fetchCheckoutJson("/api/quote", {
        method: "POST", body: itemForm(itemsRef.current, couponCode, deliveryMethod), signal: controller.signal,
      }, 90_000);
      if (!quoteGate.current.isCurrent(revision)) return;
      if (!response.ok || !result?.breakdown || !Number.isFinite(result.breakdown.total) || !Array.isArray(result.breakdown.items)) {
        setError(result?.error || "Kunde inte beräkna pris. Försök igen eller kontakta info@carls3d.se för hjälp.");
        if (result?.code === "COLOR_UNAVAILABLE") await refreshUnavailableColors();
        return;
      }
      setBreakdown(result.breakdown);
    } catch (cause) {
      if (quoteGate.current.isCurrent(revision) && !controller.signal.aborted) {
        setError(cause instanceof CheckoutRequestTimeoutError
          ? "Prisberäkningen tog för lång tid. Dina filer och val finns kvar. Försök igen eller kontakta info@carls3d.se för hjälp."
          : "Prisberäkningen kunde inte slutföras. Kontrollera anslutningen och försök igen. Dina filer och val finns kvar.");
      }
    } finally {
      if (quoteGate.current.isCurrent(revision)) { setBusyQuote(false); quoteController.current = null; }
    }
  }
  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (orderInFlight.current || pendingOptions || !validateCart()) return;
    if (!breakdown) { setError("Beräkna priset innan du skickar beställningen."); return; }
    if (!name.trim() || !email.trim() || !phone.trim()) { setError("Fyll i namn, e-post och telefon."); return; }
    if (deliveryMethod === "shipping" && (!addressLine1.trim() || !postalCode.trim() || !city.trim())) {
      setError("Fyll i adress, postnummer och ort för leveransen."); return;
    }
    orderInFlight.current = true;
    setBusyOrder(true);
    setError("");
    try {
      const form = itemForm(itemsRef.current, couponCode, deliveryMethod);
      for (const [key, value] of Object.entries({ name, email, phone, addressLine1, addressLine2, postalCode, city, country })) {
        form.append(key, value.trim());
      }
      const response = await fetch("/api/order", { method: "POST", body: form });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        setError(result?.error || "Kunde inte bekräfta beställningen. Kontakta info@carls3d.se om du är osäker på om den kom fram.");
        if (result?.code === "COLOR_UNAVAILABLE") await refreshUnavailableColors();
        return;
      }
      if (!result?.success || !result.orderNumber || !result.breakdown || !Number.isFinite(result.breakdown.total)) {
        setError("Svaret på beställningen kunde inte läsas. Kontakta info@carls3d.se innan du skickar den igen, så undviker vi en dubbelbeställning.");
        return;
      }
      setConfirmation({ orderNumber: result.orderNumber, email: email.trim(), deliveryMethod, breakdown: result.breakdown });
      updateItems(() => []);
      setPreviewId(null);
      invalidateQuote();
      setName(""); setEmail(""); setPhone("");
      setAddressLine1(""); setAddressLine2(""); setPostalCode(""); setCity(""); setCountry("Sverige");
      setDeliveryMethod("shipping"); setCouponCode("");
    } catch {
      setError("Anslutningen bröts och vi kunde inte bekräfta beställningen. Dina uppgifter finns kvar. Kontakta info@carls3d.se innan du skickar igen, så undviker vi en dubbelbeställning.");
    } finally { orderInFlight.current = false; setBusyOrder(false); }
  }

  return (
    <Layout title="Beställ 3D-utskrift">
      <section className="mx-auto max-w-6xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Beställ 3D-utskrift</h1>
          <p className="mt-2 max-w-3xl text-gray-600">Ladda upp STL/OBJ, välj material och färg per fil och beräkna priset. Fyll sedan i kontakt och leverans för att skicka din beställning.</p>
          <ol aria-label="Så beställer du" className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm text-gray-700">
            <li><span className="font-semibold">1.</span> Lägg till filer</li><li><span className="font-semibold">2.</span> Beräkna pris</li><li><span className="font-semibold">3.</span> Kontakt och leverans</li>
          </ol>
        </div>
        {error && <div ref={errorRef} role="alert" tabIndex={-1} className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-red-900"><p>{error}</p></div>}
        {confirmation && <div ref={confirmationRef} tabIndex={-1} role="status" className="mb-6 rounded-2xl border border-emerald-300 bg-emerald-50 p-6">
          <h2 className="text-xl font-semibold text-emerald-950">Tack! Din beställning har skickats.</h2>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-emerald-900">Ordernummer</dt><dd className="break-all font-semibold">{confirmation.orderNumber}</dd></div>
            <div><dt className="text-emerald-900">Totalt</dt><dd className="font-semibold">{money(confirmation.breakdown.total)}</dd></div>
            <div><dt className="text-emerald-900">Kontakt</dt><dd className="break-all">{confirmation.email}</dd></div>
            <div><dt className="text-emerald-900">Leverans</dt><dd>{confirmation.deliveryMethod === "pickup" ? "Hämtas hos mig" : "PostNord"}</dd></div>
          </dl>
          <p className="mt-4 text-sm text-emerald-950">Spara ordernumret om du behöver kontakta mig.{confirmation.deliveryMethod === "pickup" ? " Jag kontaktar dig när beställningen är klar att hämta." : " Jag kontaktar dig om beställningen."}</p>
        </div>}
        <form onSubmit={submitOrder} aria-label="Beställ 3D-utskrift">
          <fieldset disabled={busyOrder} className="min-w-0" aria-busy={busyOrder}>
            <legend className="sr-only">Filer, pris och leveransuppgifter</legend>
            <div className="grid gap-6 lg:grid-cols-3">
              <div className="min-w-0 space-y-6 lg:col-span-2">
                <div className="rounded-2xl border bg-white p-6 shadow-sm">
                  <h2 className="mb-4 text-lg font-semibold">1. Lägg till 3D-filer</h2>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="min-w-0 sm:col-span-2">
                      <label htmlFor="model-files" className="mb-1 block text-sm font-medium">STL- eller OBJ-filer</label>
                      <input id="model-files" ref={fileInputRef} type="file" accept=".stl,.obj" multiple onChange={onFilesChosen} disabled={busyFiles || materialAvailability[materialDefault] === false} aria-describedby="model-file-help" className={inputClass + " cursor-pointer text-sm"} />
                      <p id="model-file-help" className="mt-2 text-xs text-gray-600">Max 90 MB per fil, 90 MB totalt och {MAX_MODEL_FILES} filer. Varje extra fil kostar 10 kr; kopior räknas inte som extra filer.</p>
                      <p className="mt-2 text-sm text-gray-600" role="status">{busyFiles ? "Hämtar tillgängliga färger…" : materialAvailability[materialDefault] === false ? `${materialDefault} är slut. Välj ett annat material.` : ""}</p>
                    </div>
                    <div>
                      <div className="mb-1 flex items-center text-sm font-medium"><label htmlFor="default-material">Standardmaterial</label><MaterialsInfo material={materialDefault} /></div>
                      <select id="default-material" value={materialDefault} onChange={(event) => setMaterialDefault(event.target.value)} disabled={busyFiles} className={inputClass}>{materialOptions()}</select>
                      <p className="mt-2 text-xs text-gray-600">Gäller filer du lägger till härnäst.</p>
                    </div>
                  </div>
                </div>
                <div className="rounded-2xl border bg-white p-4 shadow-sm sm:p-6">
                  <h2 className="mb-3 text-lg font-semibold">Dina objekt</h2>
                  {!items.length ? <p className="text-sm text-gray-600">Inga filer tillagda ännu. Lägg till filer ovan.</p> : <div className="space-y-3">
                    {items.map((item, index) => {
                      const materialPending = pendingMaterials.includes(item.id);
                      return <div key={item.id} className="rounded-xl border p-3" aria-busy={materialPending}>
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="min-w-0 flex-1 basis-40"><p className="break-all font-medium">{item.file.name}</p><p className="text-xs text-gray-600">Objekt {index + 1} · {formatFileSize(item.file.size)}</p></div>
                          <button type="button" onClick={() => duplicateItem(item.id)} disabled={materialPending} aria-label={"Duplicera " + item.file.name} className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50">Duplicera</button>
                          <button type="button" onClick={() => removeItem(item.id)} aria-label={"Ta bort " + item.file.name} className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50">Ta bort</button>
                        </div>
                        <div className="mt-3 grid gap-3 sm:grid-cols-3">
                          <div><div className="mb-1 flex items-center text-sm font-medium"><label htmlFor={item.id + "-material"}>Material</label><MaterialsInfo material={item.material} /></div>
                            <select id={item.id + "-material"} value={item.material} disabled={materialPending} onChange={(event) => changeItemMaterial(item.id, event.target.value)} className={inputClass}>{materialOptions()}</select>
                          </div>
                          <ColorSelect id={item.id + "-color"} value={item.color} onChange={(color) => changeItem(item.id, { color })} options={item.availColors} disabled={materialPending} />
                          <div><label htmlFor={item.id + "-purpose"} className="mb-1 block text-sm font-medium">Användning</label>
                            <select id={item.id + "-purpose"} value={item.purpose} onChange={(event) => changeItem(item.id, { purpose: event.target.value as CartItem["purpose"] })} className={inputClass}>
                              <option value="general">Dekoration / allmänt bruk</option>
                              <option value="functional">Funktionell del / extra styrka</option>
                            </select>
                          </div>
                          <div><label htmlFor={item.id + "-copies"} className="mb-1 block text-sm font-medium">Kopior</label>
                            <input id={item.id + "-copies"} type="number" inputMode="numeric" min={1} max={MAX_MODEL_COPIES} step={1} required value={item.copies} onChange={(event) => changeItem(item.id, { copies: event.target.value })} className={inputClass} />
                          </div>
                        </div>
                        <button type="button" className="mt-3 rounded-lg border px-3 py-2 text-sm hover:bg-gray-50" aria-expanded={previewId === item.id} aria-controls={item.id + "-preview"} onClick={() => setPreviewId((current) => current === item.id ? null : item.id)}>
                          {previewId === item.id ? "Stäng förhandsvisning" : "Visa modell i 3D"}
                        </button>
                        {previewId === item.id && <div id={item.id + "-preview"}><ModelPreview key={item.id} file={item.file} color={item.availColors.find((color) => color.value === item.color)?.hex} /></div>}
                        {materialPending && <p role="status" className="mt-2 text-sm text-gray-600">Hämtar färger…</p>}
                      </div>;
                    })}
                  </div>}
                  <h2 className="mb-3 mt-6 text-lg font-semibold">2. Beräkna pris</h2>
                  <button type="button" onClick={doQuote} disabled={!items.length || busyQuote || pendingOptions} className="rounded-xl bg-black px-5 py-2.5 text-white hover:bg-black/90 disabled:opacity-50">{busyQuote ? "Beräknar…" : "Beräkna pris"}</button>
                  <div aria-live="polite" className="mt-3 text-sm text-gray-600">{showSlowQuoteHint ? "Jobbar fortfarande! För stora filer kan det ta upp till en minut…" : busyQuote ? "Laddar upp och beräknar dina filer…" : breakdown ? "Prisuppskattningen är klar: " + money(breakdown.total) + ". Se sammanställningen för detaljer." : items.length > 0 ? "Beräkna priset efter att du har gjort dina val." : ""}</div>
                </div>
                <div className="rounded-2xl border bg-white p-6 shadow-sm">
                  <h2 className="mb-3 text-lg font-semibold">3. Kontakt & leverans</h2>
                  <DeliveryMethodSelector value={deliveryMethod} onChange={(value) => { setDeliveryMethod(value); invalidateQuote(); }} />
                  <p className="mt-4 text-xs text-gray-600">Alla fält är obligatoriska om inget annat anges.</p>
                  <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    <div><label htmlFor="customer-name" className="mb-1 block text-sm font-medium">Namn</label><input id="customer-name" name="name" autoComplete="name" required value={name} onChange={(event) => setName(event.target.value)} className={inputClass} /></div>
                    <div><label htmlFor="customer-email" className="mb-1 block text-sm font-medium">E-post</label><input id="customer-email" name="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} className={inputClass} /></div>
                    <div><label htmlFor="customer-phone" className="mb-1 block text-sm font-medium">Telefon</label><input id="customer-phone" name="phone" type="tel" autoComplete="tel" required value={phone} onChange={(event) => setPhone(event.target.value)} className={inputClass} /></div>
                    {deliveryMethod === "shipping" ? <>
                      <div className="sm:col-span-2"><label htmlFor="address-line-1" className="mb-1 block text-sm font-medium">Adress</label><input id="address-line-1" name="addressLine1" autoComplete="shipping address-line1" required value={addressLine1} onChange={(event) => setAddressLine1(event.target.value)} placeholder="Gata och nummer" className={inputClass} /></div>
                      <div className="sm:col-span-2"><label htmlFor="address-line-2" className="mb-1 block text-sm font-medium">Adressrad 2 (valfritt)</label><input id="address-line-2" name="addressLine2" autoComplete="shipping address-line2" value={addressLine2} onChange={(event) => setAddressLine2(event.target.value)} placeholder="Lgh, c/o, etc." className={inputClass} /></div>
                      <div><label htmlFor="postal-code" className="mb-1 block text-sm font-medium">Postnummer</label><input id="postal-code" name="postalCode" autoComplete="shipping postal-code" inputMode="numeric" required value={postalCode} onChange={(event) => setPostalCode(event.target.value)} className={inputClass} /></div>
                      <div><label htmlFor="customer-city" className="mb-1 block text-sm font-medium">Ort</label><input id="customer-city" name="city" autoComplete="shipping address-level2" required value={city} onChange={(event) => setCity(event.target.value)} className={inputClass} /></div>
                      <div><label htmlFor="customer-country" className="mb-1 block text-sm font-medium">Land</label><input id="customer-country" name="country" autoComplete="shipping country-name" required value={country} onChange={(event) => setCountry(event.target.value)} className={inputClass} /></div>
                    </> : <p className="text-sm text-gray-600 sm:col-span-2">Ingen adress behövs. Jag kontaktar dig när beställningen är klar att hämta.</p>}
                  </div>
                  <div className="mt-6">
                    <button type="submit" disabled={!items.length || !breakdown || busyQuote || busyOrder || pendingOptions} className="rounded-xl bg-emerald-700 px-5 py-2.5 text-white hover:bg-emerald-800 disabled:opacity-50">{busyOrder ? "Skickar beställning…" : "Skicka beställning"}</button>
                    <p className="mt-2 text-sm text-gray-600" role="status">{busyOrder ? "Vänta medan beställningen skickas. Det kan ta en stund för stora filer." : !breakdown ? "Beräkna priset innan du skickar beställningen." : "Prisuppskattning: " + money(breakdown.total) + ". Betalning via Swish."}</p>
                  </div>
                </div>
              </div>
              <aside className="min-w-0 space-y-4" aria-label="Prisöversikt">
                <div className="rounded-2xl border bg-white p-4 shadow-sm">
                  <label htmlFor="coupon-code" className="mb-1 block text-sm font-medium">Rabattkod (valfritt)</label>
                  <div className="flex flex-wrap gap-2">
                    <input id="coupon-code" autoCapitalize="characters" autoComplete="off" spellCheck={false} value={couponCode} onChange={(event) => { setCouponCode(event.target.value); invalidateQuote(); }} className={inputClass + " min-w-0 flex-1 basis-32"} placeholder="Ange kod" />
                    <button type="button" onClick={doQuote} disabled={!items.length || busyQuote || pendingOptions} className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50">{busyQuote ? "Beräknar…" : "Använd"}</button>
                  </div>
                </div>
                <div className="rounded-2xl border bg-white p-6 shadow-sm">
                  <h2 className="text-lg font-semibold">Prisuppskattning</h2>
                  <dl className="mt-4 space-y-2 text-sm">
                    <div className="flex justify-between gap-3"><dt>Antal filer</dt><dd>{items.length}</dd></div>
                    <div className="flex justify-between gap-3"><dt>Totala kopior</dt><dd>{items.reduce((sum, item) => sum + (isValidCopies(Number(item.copies)) ? Number(item.copies) : 0), 0)}</dd></div>
                    {items.length > 0 && <div className="flex justify-between gap-3"><dt>Filstorlek totalt</dt><dd>{formatFileSize(items.reduce((sum, item) => sum + item.file.size, 0))}</dd></div>}
                  </dl>
                  {breakdown ? <div className="mt-4 text-sm">
                    <ul className="rounded-lg border bg-gray-50 p-3">
                      {breakdown.items.map((item) => <li key={item.index} className="border-b py-2 last:border-0">
                        <p className="break-all font-medium">{item.name}</p>
                        <p className="mt-1 text-gray-600">{item.material} / {items[item.index]?.availColors.find((color) => color.value === item.color)?.label || item.color} × {item.copies}</p>
                        <div className="mt-1 flex flex-wrap justify-between gap-2 text-xs text-gray-600"><span>{item.gramsEach} g per kopia · {money(item.perGram)}/g</span><span>{money(item.materialCost)}</span></div>
                      </li>)}
                    </ul>
                    <dl className="mt-4 space-y-2">
                      <div className="flex justify-between gap-3"><dt>Startavgift</dt><dd>{money(breakdown.baseFee)}</dd></div>
                      <div className="flex justify-between gap-3"><dt>Material</dt><dd>{money(breakdown.materialCost)}</dd></div>
                      <div className="flex justify-between gap-3"><dt>Filavgift</dt><dd>{money(breakdown.fileFee)}</dd></div>
                      <div className="flex justify-between gap-3"><dt>{deliveryMethod === "pickup" ? "Avhämtning" : "Frakt"}</dt><dd>{money(breakdown.shipping)}</dd></div>
                      {breakdown.coupon && <>
                        <div className="flex justify-between gap-3 text-gray-600"><dt>Ordinarie total</dt><dd>{money(breakdown.totalBeforeDiscount ?? breakdown.total + breakdown.coupon.discount)}</dd></div>
                        <div className="flex justify-between gap-3 text-emerald-800"><dt className="break-all">Rabatt ({breakdown.coupon.code})</dt><dd className="shrink-0">−{money(breakdown.coupon.discount)}</dd></div>
                      </>}
                      <div className="flex justify-between gap-3 border-t pt-3 text-base font-semibold"><dt>Totalt</dt><dd>{money(breakdown.total)}</dd></div>
                    </dl>
                    {deliveryMethod === "shipping" && <p className="mt-3 text-xs text-gray-600">Frakten inkluderar cirka {breakdown.packagingGrams} g emballage.</p>}
                  </div> : <p className="mt-4 text-sm text-gray-600">Välj ”Beräkna pris” för att se material, avgifter och leverans innan du beställer.</p>}
                </div>
                <p className="px-1 text-sm text-gray-600">Behöver du hjälp med filerna? <a href="mailto:info@carls3d.se" className="font-medium text-emerald-800 underline underline-offset-2">Kontakta mig</a>.</p>
              </aside>
            </div>
          </fieldset>
        </form>
      </section>
    </Layout>
  );
}
