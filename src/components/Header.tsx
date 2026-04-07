import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/router";

const nav = [
  { href: "/bestall", label: "Beställ" },
  { href: "/lithophane", label: "Lithophane-lampa" },
  { href: "/minecraft-torch", label: "Minecraft-fackla" },
  { href: "/om-kontakt", label: "Om & kontakt" },
  // { href: "/admin", label: "Admin" },
];

export default function Header() {
  const { pathname } = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  return (
    <header className="sticky top-0 z-30 backdrop-blur bg-white/80 border-b">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex min-h-16 items-center justify-between gap-3 py-2">
        <Link href="/" className="flex min-w-0 items-center gap-3">
          <Image src="/logo.png" alt="Carl’s 3D‑verkstad" width={36} height={36} className="rounded-md" />
          <span className="text-base font-semibold tracking-tight sm:text-lg">Carl’s 3D‑verkstad</span>
        </Link>
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          className="rounded-xl border px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 md:hidden"
          aria-expanded={menuOpen}
          aria-controls="mobile-nav"
          aria-label={menuOpen ? "Stäng meny" : "Öppna meny"}
        >
          Meny
        </button>
        <nav className="hidden items-center gap-1 md:flex">
          {nav.map((n) => {
            const active = pathname === n.href || (n.href !== "/" && pathname.startsWith(n.href));
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`px-3 py-2 rounded-xl text-sm hover:bg-gray-100 ${active ? "bg-gray-100 font-medium" : "text-gray-700"}`}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        </div>

        {menuOpen && (
          <nav id="mobile-nav" className="grid gap-2 border-t pb-3 pt-2 md:hidden">
            {nav.map((n) => {
              const active = pathname === n.href || (n.href !== "/" && pathname.startsWith(n.href));
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`rounded-xl px-3 py-2 text-sm hover:bg-gray-100 ${
                    active ? "bg-gray-100 font-medium" : "text-gray-700"
                  }`}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
        )}
      </div>
    </header>
  );
}
