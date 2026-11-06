import Link from "next/link";
import Layout from "../components/Layout";

export default function NotFound() {
  return (
    <Layout title="Sidan hittades inte" noIndex>
      <section className="mx-auto max-w-2xl rounded-2xl border bg-white px-6 py-12 text-center shadow-sm">
        <p className="text-sm font-semibold text-gray-500">404</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">Sidan hittades inte</h1>
        <p className="mt-4 text-gray-600">
          Länken kan vara gammal eller adressen felstavad. Du kan gå tillbaka till startsidan
          eller fortsätta till en ny beställning.
        </p>
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <Link href="/" className="rounded-xl bg-black px-5 py-3 text-white hover:bg-black/90">Till startsidan</Link>
          <Link href="/bestall" className="rounded-xl border px-5 py-3 hover:bg-gray-50">Beställ 3D-utskrift</Link>
        </div>
        <p className="mt-8 text-sm text-gray-600">
          Behöver du hjälp? <a href="mailto:info@carls3d.se" className="underline">Kontakta Carl</a>.
        </p>
      </section>
    </Layout>
  );
}
