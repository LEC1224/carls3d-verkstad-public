import Image from "next/image";
import Layout from "../components/Layout";
import FixedProductOrderForm from "../components/FixedProductOrderForm";
import torchImage from "../../public/minecraft-torch.jpg";
import { MINECRAFT_TORCH_SHIPPING_COST } from "../lib/delivery";

export default function MinecraftTorchOrder() {
  return (
    <Layout title="Minecraft-fackla">
      <section className="mx-auto max-w-2xl">
        <h1 className="mb-4 text-3xl font-bold">Beställ väggmonterad Minecraft-fackla</h1>
        <Image src={torchImage} alt="3D-printad Minecraft-fackla för väggmontering" priority sizes="(max-width: 704px) calc(100vw - 32px), 672px" className="h-auto w-full rounded-xl shadow" />
        <p className="mb-2 mt-4">En väggansluten 3D-printad Minecraft-fackla som passar fint i spelrum, barnrum eller som nördig detalj i hemmet.</p>
        <p className="mb-2">Pris: <span className="font-semibold">100 kr startavgift</span> + <span className="font-semibold">200 kr per fackla</span>.</p>
        <p className="mb-6 text-gray-700">I priset ingår alla 3D-utskrifter, LED-ljuskälla, 3 m sladd med strömbrytare, montering, skruvar och {MINECRAFT_TORCH_SHIPPING_COST} kr frakt. Väljer du avhämtning tas frakten bort.</p>
        <FixedProductOrderForm product="minecraft-torch" />
      </section>
    </Layout>
  );
}
