import Image from "next/image";
import Layout from "../components/Layout";
import FixedProductOrderForm from "../components/FixedProductOrderForm";
import lampImage from "../../public/lithophane-cube.jpg";
import { LITHOPHANE_SHIPPING_COST } from "../lib/delivery";

export default function LithophaneOrder() {
  return (
    <Layout title="Lithophane-lampa">
      <section className="mx-auto max-w-2xl">
        <h1 className="mb-4 text-3xl font-bold">Beställ Lithophane-lampa</h1>
        <Image src={lampImage} alt="Exempel på lithophane-kub" priority sizes="(max-width: 704px) calc(100vw - 32px), 672px" className="h-auto w-full rounded-xl shadow" />
        <p className="mb-2 mt-4">En personlig lampa med dina fyra bilder. När ljuset tänds framträder motiven i den vita kuben.</p>
        <p className="mb-2">Fast pris: <span className="font-semibold">500 kr</span>.</p>
        <p className="mb-6 text-gray-700">I priset ingår kuben i vit PLA, LED-ljuskälla, 3,5 m sladd med strömbrytare och {LITHOPHANE_SHIPPING_COST} kr frakt. Väljer du avhämtning tas frakten bort.</p>
        <FixedProductOrderForm product="lithophane" />
      </section>
    </Layout>
  );
}
