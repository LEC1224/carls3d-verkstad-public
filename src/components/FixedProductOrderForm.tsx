import { useEffect, useRef, useState } from "react";
import CustomerFields, { emptyCustomer } from "./CustomerFields";
import DeliveryMethodSelector from "./DeliveryMethodSelector";
import ProductImagePicker from "./ProductImagePicker";
import { LITHOPHANE_SHIPPING_COST, MINECRAFT_TORCH_SHIPPING_COST, priceBeforeCouponForDelivery, type DeliveryMethod } from "../lib/delivery";
import { PRODUCT_IMAGE_COUNT, validateProductImages } from "../lib/productUploads";
import { MAX_TORCH_QUANTITY } from "../lib/validation";
import { CheckoutRequestTimeoutError, fetchCheckoutJson } from "../lib/checkoutRequest";

type Product = "lithophane" | "minecraft-torch";
type CouponResult = { key: string; price?: number; message: string; applied: boolean };
type Confirmation = { orderNumber: string; price: number; deliveryMethod: DeliveryMethod };

export default function FixedProductOrderForm({ product }: { product: Product }) {
  const isLamp = product === "lithophane";
  const [customer, setCustomer] = useState(emptyCustomer);
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>("shipping");
  const [quantity, setQuantity] = useState("1");
  const [images, setImages] = useState<File[]>([]);
  const [couponCode, setCouponCode] = useState("");
  const [couponResult, setCouponResult] = useState<CouponResult | null>(null);
  const [couponBusy, setCouponBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const submitLock = useRef(false);
  const couponRequest = useRef<AbortController | null>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const numericQuantity = Number(quantity);
  const quantityValid = Number.isInteger(numericQuantity) && numericQuantity >= 1 && numericQuantity <= MAX_TORCH_QUANTITY;
  const basePrice = isLamp ? 500 : 100 + (quantityValid ? numericQuantity : 1) * 200;
  const shippingCost = isLamp ? LITHOPHANE_SHIPPING_COST : MINECRAFT_TORCH_SHIPPING_COST;
  const priceBeforeCoupon = priceBeforeCouponForDelivery(basePrice, shippingCost, deliveryMethod);
  const couponKey = JSON.stringify([priceBeforeCoupon, couponCode.trim()]);
  const currentCoupon = couponResult?.key === couponKey ? couponResult : null;
  const displayedPrice = currentCoupon?.price ?? priceBeforeCoupon;

  useEffect(() => () => couponRequest.current?.abort(), []);
  useEffect(() => {
    couponRequest.current?.abort();
    couponRequest.current = null;
    setCouponBusy(false);
  }, [couponKey]);
  useEffect(() => { if (confirmation) feedbackRef.current?.focus(); }, [confirmation]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  async function applyCoupon() {
    couponRequest.current?.abort();
    if (!couponCode.trim()) {
      setCouponResult({ key: couponKey, message: "Fyll i en rabattkod först.", applied: false });
      setCouponBusy(false);
      return;
    }
    const controller = new AbortController();
    couponRequest.current = controller;
    setCouponBusy(true);
    setCouponResult(null);
    try {
      const { response, data } = await fetchCheckoutJson("/api/fixed-coupon-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ price: priceBeforeCoupon, couponCode, ...(!isLamp ? { startFee: 100, allowStartFeeRemoval: true } : {}) }),
        signal: controller.signal,
      }, 15000);
      const result = data || {};
      if (controller.signal.aborted) return;
      if (!response.ok || !Number.isFinite(result.price)) {
        setCouponResult({ key: couponKey, message: result.error || "Kunde inte tillämpa rabattkoden.", applied: false });
        return;
      }
      setCouponResult({ key: couponKey, price: result.price, message: `Rabattkod ${result.coupon?.code || couponCode.trim()} tillämpad.`, applied: true });
    } catch (cause) {
      if (!controller.signal.aborted) setCouponResult({ key: couponKey, message: cause instanceof CheckoutRequestTimeoutError
        ? "Kontrollen tog för lång tid. Försök igen eller ta bort rabattkoden."
        : "Kunde inte kontrollera rabattkoden. Kontrollera anslutningen och försök igen.", applied: false });
    } finally {
      if (couponRequest.current === controller) setCouponBusy(false);
    }
  }

  async function submitOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitLock.current) return;
    if (!customer.name.trim() || !customer.email.trim() || !customer.phone.trim()) {
      setError("Fyll i namn, e-post och telefon.");
      return;
    }
    if (!isLamp && !quantityValid) { setError("Ange ett helt antal mellan 1 och 999 facklor."); return; }
    if (isLamp && (images.length !== PRODUCT_IMAGE_COUNT || validateProductImages(images))) {
      setError(validateProductImages(images) || "Välj exakt 4 bilder till lampan.");
      return;
    }
    if (couponCode.trim() && !currentCoupon?.applied) {
      setError("Tillämpa rabattkoden för att kontrollera priset, eller ta bort koden innan du beställer.");
      return;
    }
    submitLock.current = true;
    setSubmitting(true);
    setError("");
    const payload = { ...customer, deliveryMethod, couponCode: couponCode.trim() };
    try {
      let response: Response;
      if (isLamp) {
        const body = new FormData();
        Object.entries(payload).forEach(([key, value]) => body.append(key, value));
        images.forEach((file) => body.append("images", file));
        response = await fetch("/api/lithophane", { method: "POST", body });
      } else {
        response = await fetch("/api/minecraft-torch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, quantity: numericQuantity }) });
      }
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { setError(result.error || "Beställningen kunde inte skickas. Försök igen."); return; }
      if (!result.success || typeof result.orderNumber !== "string" || !Number.isFinite(result.price)) {
        throw new Error("Missing order confirmation");
      }
      setConfirmation({ orderNumber: result.orderNumber, price: result.price, deliveryMethod });
      setImages([]);
      setCustomer(emptyCustomer());
      setCouponCode("");
      setCouponResult(null);
    } catch {
      setError("Anslutningen bröts och vi kunde inte bekräfta beställningen. Kontakta info@carls3d.se innan du skickar igen, så undviker vi en dubbelbeställning.");
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  }

  if (confirmation) return (
    <div ref={feedbackRef} tabIndex={-1} role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
      <h2 className="text-xl font-semibold">Tack! Din beställning har skickats.</h2>
      <p className="mt-3">Ordernummer: <strong className="break-all">{confirmation.orderNumber}</strong></p>
      <p className="mt-1">Totalt: <strong>{confirmation.price} kr</strong></p>
      <p className="mt-3 text-sm text-gray-700">Spara ordernumret. {confirmation.deliveryMethod === "pickup" ? "Jag kontaktar dig när beställningen är klar att hämta." : "Jag kontaktar dig om din beställning."}</p>
      <a href="mailto:info@carls3d.se" className="mt-3 inline-block text-sm underline underline-offset-4">Frågor? Skriv till info@carls3d.se</a>
      <div className="mt-5"><button type="button" onClick={() => { setConfirmation(null); setQuantity("1"); setDeliveryMethod("shipping"); }} className="rounded-xl border border-emerald-700 bg-white px-4 py-2 text-sm">Gör en ny beställning</button></div>
    </div>
  );

  return (
    <form onSubmit={submitOrder} className="rounded-2xl border bg-white p-4 shadow-sm sm:p-6" aria-busy={submitting}>
      {error && <div ref={errorRef} tabIndex={-1} role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
      <fieldset disabled={submitting} className="min-w-0 space-y-6">
        <legend className="text-xl font-semibold">Din beställning</legend>
        {isLamp ? <ProductImagePicker images={images} onChange={setImages} onError={setError} /> : (
          <div>
            <label htmlFor="torch-quantity" className="mb-1 block text-sm font-medium">Antal facklor</label>
            <input id="torch-quantity" name="quantity" type="number" min={1} max={MAX_TORCH_QUANTITY} step={1} required value={quantity} onChange={(event) => setQuantity(event.target.value)} className="w-full rounded-xl border px-3 py-2 sm:max-w-40" />
          </div>
        )}
        <DeliveryMethodSelector value={deliveryMethod} onChange={setDeliveryMethod} shippingDescription="Levereras med PostNord. Frakt ingår i priset." />
        <div>
          <h2 className="mb-3 font-semibold">Kontakt & leverans</h2>
          <CustomerFields idPrefix={product} value={customer} onChange={setCustomer} deliveryMethod={deliveryMethod} />
        </div>
        <div>
          <label htmlFor="product-coupon" className="mb-1 block text-sm font-medium">Rabattkod (valfritt)</label>
          <div className="flex gap-2">
            <input id="product-coupon" value={couponCode} maxLength={64} onChange={(event) => setCouponCode(event.target.value)} autoCapitalize="characters" spellCheck={false} className="min-w-0 flex-1 rounded-xl border px-3 py-2" aria-describedby={currentCoupon ? "product-coupon-message" : undefined} />
            <button type="button" onClick={applyCoupon} disabled={couponBusy || (!isLamp && !quantityValid)} className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-60">{couponBusy ? "Kontrollerar…" : "Tillämpa"}</button>
          </div>
          {currentCoupon && <p id="product-coupon-message" role="status" className={`mt-2 text-sm ${currentCoupon.applied ? "text-emerald-800" : "text-red-700"}`}>{currentCoupon.message}</p>}
        </div>
        <div className="rounded-xl bg-gray-50 p-4" aria-live="polite" aria-atomic="true">
          <div className="flex justify-between gap-4 text-sm"><span>{isLamp ? "Lithophane-lampa" : `Facklor (${quantityValid ? numericQuantity : "–"} st), inkl. startavgift`}</span><span className="whitespace-nowrap">{basePrice} kr</span></div>
          {deliveryMethod === "pickup" && <div className="mt-2 flex justify-between gap-4 text-sm"><span>Fraktavdrag vid avhämtning</span><span>−{shippingCost} kr</span></div>}
          {currentCoupon?.applied && <div className="mt-2 flex justify-between gap-4 text-sm text-emerald-800"><span>Rabatt</span><span>−{priceBeforeCoupon - displayedPrice} kr</span></div>}
          <div className="mt-3 flex justify-between border-t pt-3 text-lg font-semibold"><span>Totalt</span><span>{!isLamp && !quantityValid ? "–" : `${displayedPrice} kr`}</span></div>
          <p className="mt-2 text-xs text-gray-600">{deliveryMethod === "shipping" ? "Frakt ingår." : "Ingen frakt vid avhämtning."}</p>
        </div>
        <button type="submit" disabled={submitting || couponBusy} className="w-full rounded-xl bg-emerald-700 px-5 py-3 font-medium text-white hover:bg-emerald-800 disabled:opacity-60">{submitting ? "Skickar beställning…" : "Skicka beställning"}</button>
      </fieldset>
    </form>
  );
}
