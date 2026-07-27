import { useEffect, useRef, useState } from "react";
import Layout from "../components/Layout";
import DeliveryMethodSelector from "../components/DeliveryMethodSelector";
import {
  LITHOPHANE_SHIPPING_COST,
  priceBeforeCouponForDelivery,
  type DeliveryMethod,
} from "../lib/delivery";

export default function LithophaneOrder() {
  const basePrice = 500;
  const [images, setImages] = useState<File[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>("shipping");
  const [couponCode, setCouponCode] = useState("");
  const [displayedPrice, setDisplayedPrice] = useState(basePrice);
  const [couponMessage, setCouponMessage] = useState("");
  const [isApplyingCoupon, setIsApplyingCoupon] = useState(false);

  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("Sverige");
  const [phone, setPhone] = useState("");

  const imgInputRef = useRef<HTMLInputElement | null>(null);
  const priceBeforeCoupon = priceBeforeCouponForDelivery(
    basePrice,
    LITHOPHANE_SHIPPING_COST,
    deliveryMethod
  );

  useEffect(() => {
    setDisplayedPrice(priceBeforeCoupon);
    setCouponMessage("");
  }, [priceBeforeCoupon]);

  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files) return;
    setImages(Array.from(e.target.files));
  }

  async function applyCoupon() {
    if (!couponCode.trim()) {
      setDisplayedPrice(priceBeforeCoupon);
      setCouponMessage("Fyll i en rabattkod först.");
      return;
    }

    setIsApplyingCoupon(true);
    setCouponMessage("");

    try {
      const res = await fetch("/api/fixed-coupon-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          price: priceBeforeCoupon,
          couponCode,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDisplayedPrice(priceBeforeCoupon);
        setCouponMessage(data.error || "Kunde inte tillämpa rabattkoden.");
        return;
      }

      setDisplayedPrice(data.price);
      setCouponMessage(`Rabattkod ${data.coupon?.code || couponCode.trim()} tillämpad.`);
    } catch {
      setDisplayedPrice(priceBeforeCoupon);
      setCouponMessage("Kunde inte tillämpa rabattkoden.");
    } finally {
      setIsApplyingCoupon(false);
    }
  }

  async function submitOrder() {
    if (!name || !email || !phone || images.length !== 4) {
      alert("Fyll i namn, e-post och telefon samt ladda upp exakt 4 bilder.");
      return;
    }
    if (deliveryMethod === "shipping" && (!addressLine1 || !postalCode || !city)) {
      alert("Fyll i adress, postnummer och ort för leveransen.");
      return;
    }
    const formData = new FormData();
    formData.append("name", name);
    formData.append("email", email);
    formData.append("deliveryMethod", deliveryMethod);

    formData.append("addressLine1", addressLine1);
    formData.append("addressLine2", addressLine2);
    formData.append("postalCode", postalCode);
    formData.append("city", city);
    formData.append("country", country);
    formData.append("phone", phone);
    formData.append("couponCode", couponCode);

    images.forEach(img => formData.append("images", img));

    const res = await fetch("/api/lithophane", { method: "POST", body: formData });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(j.error || "Något gick fel. Försök igen.");
      return;
    }
    alert("Tack! Din beställning har skickats.");

    setName(""); setEmail(""); setImages([]); setCouponCode(""); setDeliveryMethod("shipping");
    setAddressLine1(""); setAddressLine2(""); setPostalCode(""); setCity(""); setCountry("Sverige"); setPhone("");
    if (imgInputRef.current) imgInputRef.current.value = "";
  }

  return (
    <Layout>
      <section className="mx-auto max-w-2xl">
        <h1 className="text-3xl font-bold mb-4">Beställ Lithophane-lampa</h1>
        <img
          src="/lithophane-cube.jpg"
          alt="Exempel på lithophane-kub"
          className="rounded-xl shadow max-w-full"
        />
        <p className="mb-2">Ladda upp 4 bilder. Om de inte är kvadratiska beskärs de av oss.</p>
        <p className="mb-6">Fast pris: <span className="font-semibold">500 kr</span>.</p>
        <p className="mb-6">
          I priset ingår kuben i vit PLA, LED-ljuskälla, 3,5 m sladd med strömbrytare och{" "}
          {LITHOPHANE_SHIPPING_COST} kr frakt. Väljer du avhämtning tas frakten bort.
        </p>
        <p className="mb-6 text-gray-700">Totalt just nu: <span className="font-semibold">{displayedPrice} kr</span>.</p>

        <div className="space-y-6">
          <DeliveryMethodSelector
            value={deliveryMethod}
            onChange={setDeliveryMethod}
            shippingDescription="Levereras med PostNord. Frakt ingår i priset."
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block mb-1 text-sm font-medium">Namn</label>
              <input value={name} onChange={e => setName(e.target.value)} className="w-full rounded-xl border px-3 py-2" />
            </div>
            <div>
              <label className="block mb-1 text-sm font-medium">E-post</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full rounded-xl border px-3 py-2" />
            </div>
            <div>
              <label className="block mb-1 text-sm font-medium">Telefon</label>
              <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} className="w-full rounded-xl border px-3 py-2" required />
            </div>
          </div>

          {deliveryMethod === "shipping" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="block mb-1 text-sm font-medium">Adress</label>
              <input value={addressLine1} onChange={e => setAddressLine1(e.target.value)} className="w-full rounded-xl border px-3 py-2" />
            </div>
            <div className="sm:col-span-2">
              <label className="block mb-1 text-sm font-medium">Adressrad 2 (valfritt)</label>
              <input value={addressLine2} onChange={e => setAddressLine2(e.target.value)} className="w-full rounded-xl border px-3 py-2" />
            </div>
            <div>
              <label className="block mb-1 text-sm font-medium">Postnummer</label>
              <input value={postalCode} onChange={e => setPostalCode(e.target.value)} className="w-full rounded-xl border px-3 py-2" />
            </div>
            <div>
              <label className="block mb-1 text-sm font-medium">Ort</label>
              <input value={city} onChange={e => setCity(e.target.value)} className="w-full rounded-xl border px-3 py-2" />
            </div>
            <div>
              <label className="block mb-1 text-sm font-medium">Land</label>
              <input value={country} onChange={e => setCountry(e.target.value)} className="w-full rounded-xl border px-3 py-2" />
            </div>
          </div>
          ) : (
            <p className="text-sm text-gray-600">
              Du behöver inte fylla i någon adress. Jag kontaktar dig när lampan är klar att hämta.
            </p>
          )}

          <div>
            <label className="block mb-1 text-sm font-medium">Bilder (exakt 4)</label>
            <input ref={imgInputRef} type="file" accept="image/*" multiple onChange={handleFiles}
                   className="w-full rounded-xl border bg-white px-3 py-2 cursor-pointer" />
          </div>

          <div>
            <label className="block mb-1 text-sm font-medium">Rabattkod</label>
            <div className="flex max-w-md gap-2">
              <input
                value={couponCode}
                onChange={e => {
                  setCouponCode(e.target.value);
                  setDisplayedPrice(priceBeforeCoupon);
                  setCouponMessage("");
                }}
                className="w-full rounded-xl border px-3 py-2"
                placeholder="Valfritt"
              />
              <button
                type="button"
                onClick={applyCoupon}
                disabled={isApplyingCoupon}
                className="rounded-xl border border-emerald-600 px-4 py-2 text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Tillämpa
              </button>
            </div>
            {couponMessage ? <p className="mt-2 text-sm text-gray-600">{couponMessage}</p> : null}
          </div>

          <button onClick={submitOrder}
                  className="rounded-xl bg-emerald-600 px-5 py-2.5 text-white hover:bg-emerald-700">
            Skicka beställning
          </button>
        </div>
      </section>
    </Layout>
  );
}
