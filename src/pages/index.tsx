import { useState } from "react";
import FileUploader from "@/components/FileUploader";
import { calculatePrice } from "@/lib/pricing";

export default function Home() {
  const [material, setMaterial] = useState("PLA");
  const [files, setFiles] = useState<File[]>([]);
  const [price, setPrice] = useState<number | null>(null);

  function updatePrice() {
    const weightEstimate = 50 * files.length; // placeholder weight logic
    setPrice(calculatePrice(weightEstimate, material, files.length));
  }

  return (
    <main className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Beställ 3D-utskrift</h1>
      <label>Material:</label>
      <select
        value={material}
        onChange={e => setMaterial(e.target.value)}
        className="border p-2 w-full"
      >
        <option>PLA</option>
        <option>PETG</option>
        <option>ABS</option>
        <option>ASA</option>
        <option>TPU</option>
      </select>

      <FileUploader onFiles={setFiles} />

      <button onClick={updatePrice} className="mt-4 bg-blue-500 text-white p-2 rounded">
        Beräkna pris
      </button>

      {price !== null && (
        <p className="mt-4 font-bold">Beräknat pris: {price} kr</p>
      )}
    </main>
  );
}
