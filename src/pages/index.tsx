import { useEffect, useState } from "react";
import Link from "next/link";
import Layout from "../components/Layout";
import Slideshow from "../components/Slideshow";

type Slide = { src: string; alt?: string; caption?: string };

function labelFromFilename(path: string) {
  const file = decodeURIComponent(path.split("/").pop() || "");
  const base = file.replace(/\.[^.]+$/, "");
  return base.replace(/[-_]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

export default function HomeLanding() {
  const [slides, setSlides] = useState<Slide[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/slide/manifest.json", { cache: "no-store" });
        if (!res.ok) {
          // Fallback (utan captions)
          const fallback = ["/slide/01.jpg", "/slide/02.jpg", "/slide/03.jpg", "/slide/04.jpg", "/slide/05.jpg"]
            .map((src) => ({ src, caption: labelFromFilename(src) }));
          setSlides(fallback);
          return;
        }
        const j = await res.json();
        if (Array.isArray(j?.images) && j.images.length > 0) {
          const mapped: Slide[] = j.images
            .map((it: any) => {
              // Stöder både strängar och objekt { src, caption?, alt? }
              if (typeof it === "string") {
                const src = it.startsWith("/slide/") ? it : `/slide/${it}`;
                return { src, caption: labelFromFilename(src) };
              }
              if (it && typeof it === "object" && typeof it.src === "string") {
                const raw = it.src;
                const src = raw.startsWith("/slide/") ? raw : `/slide/${raw}`;
                const caption = it.caption ?? it.title ?? labelFromFilename(src);
                const alt = it.alt ?? caption;
                return { src, caption, alt };
              }
              return null;
            })
            .filter(Boolean);
          setSlides(mapped);
        }
      } catch {
        // Ignorera och lämna slides tomma
      }
    })();
  }, []);

  return (
    <Layout>
      <section className="mx-auto max-w-7xl">
        {/* Hero */}
        <div className="mt-4 text-center sm:mt-8">
          <div className="inline-flex max-w-full items-center gap-3 rounded-full border bg-white px-3 py-1 text-xs text-gray-600 shadow-sm">
            🧵 FDM-utskrift • PLA/PETG/ABS/ASA/TPU
          </div>
          <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
            3D-utskrifter på beställning – <br />
            <span className="text-gray-700">Carl’s 3D-verkstad</span>
          </h1>
          <p className="mx-auto mt-4 max-w-3xl text-base text-gray-700 sm:text-lg">
            Snabba och snygga prototyper, reservdelar, inredning och presenter.
            Jag skriver ut med en BambuLab P1S (25×25×25 cm) och kan skriva i upp till fyra färger i samma 3D-modell.
          </p>
          <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href="/bestall" className="rounded-xl bg-black px-5 py-2.5 text-white hover:bg-black/90">
              Beställ 3D-utskrift
            </Link>
            <Link href="/lithophane" className="rounded-xl border px-5 py-2.5 hover:bg-gray-50">
              Lithophane-lampa
            </Link>
          </div>
        </div>

        <br />

        {/* Slideshow */}
        <div className="mx-auto max-w-6xl">
          {/* fit="contain" gör att hela bilden syns */}
          <Slideshow images={slides} intervalMs={5000} aspect={16 / 9} fit="contain" />
        </div>

        {/* Why us */}
        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {[
            { t: "Modern utrustning", d: "BambuLab P1S ger hög ytfinish, pålitlig kalibrering och bra resultat i flera material." },
            { t: "Flera material", d: "PLA & PETG (0,5 kr/g), ABS & ASA (1 kr/g), TPU (3 kr/g). Färgutbudet varierar – fråga gärna!" },
            { t: "Enkel process", d: "Ladda upp STL/OBJ, välj material & färg per fil. Offert direkt – betalning via Swish." },
          ].map((c) => (
            <div key={c.t} className="rounded-2xl border bg-white p-6 shadow-sm">
              <h3 className="font-semibold">{c.t}</h3>
              <p className="mt-2 text-gray-700">{c.d}</p>
            </div>
          ))}
        </div>

        {/* Material guide (PLA/PETG/ABS/ASA/TPU + FAQ) */}
        <div className="mt-14 rounded-2xl border bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold">Material – vad ska jag välja?</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {/* PLA */}
            <div className="rounded-xl border p-4">
              <h3 className="font-semibold">PLA – standard & dekor</h3>
              <ul className="mt-2 list-disc pl-5 text-sm text-gray-700 space-y-1">
                <li>Lätt att skriva ut, många färger, bra ytfinish.</li>
                <li>För inredning, figurer, prototyper, enklare reservdelar.</li>
                <li>Mjuknar vid ~55–60 °C.</li>
              </ul>
            </div>
            {/* PETG */}
            <div className="rounded-xl border p-4">
              <h3 className="font-semibold">PETG – slitstarkt & halvsegt</h3>
              <ul className="mt-2 list-disc pl-5 text-sm text-gray-700 space-y-1">
                <li>Mer slagtåligt än PLA, tål fukt bättre.</li>
                <li>Bra till hållare, krokar, kökslådsinsatser, utomhus med måttlig värme.</li>
                <li>Kan bli lite glansig yta.</li>
              </ul>
            </div>
            {/* ABS/ASA */}
            <div className="rounded-xl border p-4">
              <h3 className="font-semibold">ABS / ASA – värmetåligt</h3>
              <ul className="mt-2 list-disc pl-5 text-sm text-gray-700 space-y-1">
                <li>Tål hög värme.</li>
                <li>För bilen, motorer, utomhus.</li>
                <li>ASA tål sol/UV bättre än ABS.</li>
              </ul>
            </div>
            {/* TPU */}
            <div className="rounded-xl border p-4">
              <h3 className="font-semibold">TPU – flexibelt (gummi-likt)</h3>
              <ul className="mt-2 list-disc pl-5 text-sm text-gray-700 space-y-1">
                <li>Böjligt och stötdämpande.</li>
                <li>För skydd, packningar, remmar, fötter.</li>
              </ul>
            </div>
          </div>

          {/* FAQ */}
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border p-4">
              <h4 className="font-medium">Behöver jag välja infill/väggtjocklek?</h4>
              <p className="mt-2 text-sm text-gray-700">
                Nej, jag använder bra standarder. Skicka ett mail i samband med beställningen om du behöver extra hållfasthet eller av andra skäl vill specificera infill/väggtjocklek.
              </p>
            </div>
            <div className="rounded-xl border p-4">
              <h4 className="font-medium">Tål delarna vatten/utomhus?</h4>
              <p className="mt-2 text-sm text-gray-700">
                3D-utskrifter blir aldrig helt vattentäta, men välj PETG eller ASA för utomhusbruk. PLA trivs bäst skyddad från UV och väta.
              </p>
            </div>
            <div className="rounded-xl border p-4">
              <h4 className="font-medium">Hur väljer jag färg?</h4>
              <p className="mt-2 text-sm text-gray-700">
                Färgutbudet varierar. Se beställningssidan eller kontakta mig! Om du vill ha en specifik plasttyp och färg kan jag beställa en rulle för din utskrift, till högre pris.
              </p>
            </div>
            <div className="rounded-xl border p-4">
              <h4 className="font-medium">Passform & toleranser</h4>
              <p className="mt-2 text-sm text-gray-700">
                Standardtolerans fungerar oftast. Vid presspassning, skicka ett mail om vad delen ska passa mot och vilka mått som gäller.
              </p>
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}
