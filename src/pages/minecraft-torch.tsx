import { useState } from "react";
import Layout from "../components/Layout";

const BASE_PRICE = 100;
const PRICE_PER_TORCH = 200;

export default function MinecraftTorchOrder() {
  const [quantity, setQuantity] = useState(1);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("Sverige");
  const [phone, setPhone] = useState("");

  const totalPrice = BASE_PRICE + quantity * PRICE_PER_TORCH;

  async function submitOrder() {
    if (!name || !email || !addressLine1 || !postalCode || !city) {
      alert("Fyll i namn, e-post, adress, postnummer och ort.");
      return;
    }

    if (!Number.isInteger(quantity) || quantity < 1) {
      alert("Ange minst 1 fackla.");
      return;
    }

    const res = await fetch("/api/minecraft-torch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        email,
        quantity,
        addressLine1,
        addressLine2,
        postalCode,
        city,
        country,
        phone,
      }),
    });

    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(j.error || "Något gick fel. Försök igen.");
      return;
    }

    alert(`Tack! Din beställning har skickats.${j.orderNumber ? `\nOrdernummer: ${j.orderNumber}` : ""}`);

    setQuantity(1);
    setName("");
    setEmail("");
    setAddressLine1("");
    setAddressLine2("");
    setPostalCode("");
    setCity("");
    setCountry("Sverige");
    setPhone("");
  }

  return (
    <Layout title="Minecraft-fackla">
      <section className="mx-auto max-w-2xl">
        <h1 className="mb-4 text-3xl font-bold">Beställ väggmonterad Minecraft-fackla</h1>
        <img
          src="/minecraft-torch.jpg"
          alt="3D-printad Minecraft-fackla för väggmontering"
          className="max-w-full rounded-xl shadow"
        />
        <p className="mb-2 mt-4">
          En väggansluten 3D-printad Minecraft-fackla som passar fint i spelrum, barnrum eller som nördig detalj i
          hemmet.
        </p>
        <p className="mb-2">
          Pris: <span className="font-semibold">100 kr startavgift</span> +{" "}
          <span className="font-semibold">200 kr per fackla</span>.
        </p>
        <p className="mb-6">I priset ingår alla 3D-utskrifter, LED-ljuskälla, 3 m sladd med strömbrytare, montering, skruvar och frakt!</p>
        <p className="mb-6 text-gray-700">
          Totalt just nu: <span className="font-semibold">{totalPrice} kr</span> för {quantity} st.
        </p>

        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">Namn</label>
              <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-xl border px-3 py-2" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">E-post</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border px-3 py-2"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Antal facklor</label>
            <input
              type="number"
              min={1}
              step={1}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value || "1", 10)))}
              className="w-full rounded-xl border px-3 py-2"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium">Adress</label>
              <input
                value={addressLine1}
                onChange={(e) => setAddressLine1(e.target.value)}
                className="w-full rounded-xl border px-3 py-2"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium">Adressrad 2 (valfritt)</label>
              <input
                value={addressLine2}
                onChange={(e) => setAddressLine2(e.target.value)}
                className="w-full rounded-xl border px-3 py-2"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Postnummer</label>
              <input
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
                className="w-full rounded-xl border px-3 py-2"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Ort</label>
              <input value={city} onChange={(e) => setCity(e.target.value)} className="w-full rounded-xl border px-3 py-2" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Land</label>
              <input value={country} onChange={(e) => setCountry(e.target.value)} className="w-full rounded-xl border px-3 py-2" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Telefon (valfritt)</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full rounded-xl border px-3 py-2" />
            </div>
          </div>

          <button
            onClick={submitOrder}
            className="rounded-xl bg-emerald-600 px-5 py-2.5 text-white hover:bg-emerald-700"
          >
            Skicka beställning
          </button>
        </div>
      </section>
    </Layout>
  );
}
