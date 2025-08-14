import { useState } from "react";

export default function LithophaneOrder() {
  const [images, setImages] = useState<File[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files) return;
    const fileArray = Array.from(e.target.files);
    if (fileArray.length !== 4) {
      alert("Du måste ladda upp exakt 4 bilder.");
      return;
    }
    setImages(fileArray);
  }

  async function submitOrder() {
    if (!name || !email || images.length !== 4) {
      alert("Fyll i alla fält och ladda upp 4 bilder.");
      return;
    }
    const formData = new FormData();
    formData.append("name", name);
    formData.append("email", email);
    images.forEach(img => formData.append("images", img));

    await fetch("/api/lithophane", {
      method: "POST",
      body: formData
    });

    alert("Beställning skickad!");
  }

  return (
    <main className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Beställ Lithophane-lampa</h1>
      <p className="mb-2">
        Ladda upp 4 bilder. Om de inte är kvadratiska beskärs de av admin.
      </p>
      <p className="mb-4">Fast pris: 500 kr (vit PLA, inkluderar LED och sladd).</p>

      <label>Namn:</label>
      <input value={name} onChange={e => setName(e.target.value)} className="w-full mb-2" />

      <label>E-post:</label>
      <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full mb-2" />

      <label>Bilder:</label>
      <input type="file" accept="image/*" multiple onChange={handleFiles} className="w-full mb-4" />

      <button onClick={submitOrder} className="bg-green-600 text-white p-2 rounded">
        Skicka beställning
      </button>
    </main>
  );
}
