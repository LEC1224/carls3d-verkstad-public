import Head from "next/head";
import { useRouter } from "next/router";
import Header from "./Header";
import Footer from "./Footer";
import TravelNotice from "./TravelNotice";

type Props = {
  title?: string;
  description?: string;
  noIndex?: boolean;
  children: React.ReactNode;
};

const siteUrl = "https://carls3d.se";
const pageDetails: Record<string, { title: string; description: string; image?: string }> = {
  "/": {
    title: "3D-utskrifter på beställning",
    description: "Beställ 3D-utskrifter, prototyper, reservdelar och personliga presenter. Ladda upp STL eller OBJ och få en prisuppskattning hos Carl’s 3D-verkstad.",
    image: "/slide/dia.jpg",
  },
  "/bestall": {
    title: "Beställ 3D-utskrift",
    description: "Ladda upp dina STL- eller OBJ-filer, välj material och färg per fil och beräkna priset. Välj leverans med PostNord eller avhämtning.",
  },
  "/lithophane": {
    title: "Lithophane-lampa med egna foton",
    description: "Beställ en personlig lithophane-lampa med dina egna foton. Ladda upp bilder och se priset innan du skickar din beställning.",
    image: "/lithophane-cube.jpg",
  },
  "/minecraft-torch": {
    title: "Minecraft-fackla",
    description: "Beställ en 3D-utskriven Minecraft-fackla från Carl’s 3D-verkstad. Välj antal och leveranssätt och se priset före beställning.",
    image: "/minecraft-torch.jpg",
  },
  "/om-kontakt": {
    title: "Om verkstaden & kontakt",
    description: "Lär känna Carl och hans 3D-verkstad. Läs om skrivaren, material och hur du kontaktar oss om din idé eller en specialbeställning.",
    image: "/printer.png",
  },
};

export default function Layout({ title, description, noIndex, children }: Props) {
  const { pathname } = useRouter();
  const details = pageDetails[pathname];
  const heading = title || details?.title;
  const pageTitle = heading ? `${heading} – Carl’s 3D-verkstad` : "Carl’s 3D-verkstad";
  const pageDescription = description || details?.description || "3D-utskrifter på beställning i Sverige – Carl’s 3D-verkstad";
  const hiddenFromSearch = noIndex ?? !details;
  const canonicalUrl = details ? `${siteUrl}${pathname === "/" ? "" : pathname}` : undefined;
  return (
    <>
      <Head>
        <title>{pageTitle}</title>
        <meta name="description" content={pageDescription} key="description" />
        {hiddenFromSearch && <meta name="robots" content="noindex, nofollow" key="robots" />}
        {canonicalUrl && <link rel="canonical" href={canonicalUrl} key="canonical" />}
        <meta property="og:type" content="website" key="og:type" />
        <meta property="og:locale" content="sv_SE" key="og:locale" />
        <meta property="og:site_name" content="Carl’s 3D-verkstad" key="og:site_name" />
        <meta property="og:title" content={pageTitle} key="og:title" />
        <meta property="og:description" content={pageDescription} key="og:description" />
        {canonicalUrl && <meta property="og:url" content={canonicalUrl} key="og:url" />}
        <meta property="og:image" content={`${siteUrl}${details?.image || "/logo.png"}`} key="og:image" />
        <meta name="twitter:card" content="summary" key="twitter:card" />
        <link rel="icon" href="/logo.png" />
      </Head>
      <a
        href="#main-content"
        className="sr-only fixed left-4 top-4 z-50 rounded-xl bg-white px-4 py-3 font-medium shadow-lg focus:not-sr-only"
      >
        Hoppa till innehåll
      </a>
      <div className="flex min-h-screen flex-col bg-gradient-to-b from-white to-gray-50">
        <Header />
        <TravelNotice />
        <main id="main-content" tabIndex={-1} className="flex-1 px-4 py-6 outline-none sm:px-6 sm:py-10 lg:px-8">{children}</main>
        <Footer />
      </div>
    </>
  );
}
