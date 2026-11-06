import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/router";

const nav = [
  { href: "/bestall", label: "Beställ" },
  { href: "/lithophane", label: "Lithophane-lampa" },
  { href: "/minecraft-torch", label: "Minecraft-fackla" },
  { href: "/om-kontakt", label: "Om & kontakt" },
];

export default function Header() {
  const { pathname } = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setMenuOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  return (
    <header
      className="sticky top-0 z-30 border-b bg-white/95 backdrop-blur"
      onKeyDown={(event) => {
        if (event.key === "Escape" && menuOpen) {
          setMenuOpen(false);
          menuButtonRef.current?.focus();
        }
      }}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex min-h-16 items-center justify-between gap-3 py-2">
        <Link href="/" className="flex min-w-0 items-center gap-3">
          <Image src="/logo.png" alt="" width={36} height={36} className="h-9 w-9 shrink-0 rounded-md" />
          <span className="text-base font-semibold tracking-tight sm:text-lg">Carl’s 3D‑verkstad</span>
        </Link>
        <button
          type="button"
          ref={menuButtonRef}
          onClick={() => setMenuOpen((open) => !open)}
          className="min-h-11 shrink-0 rounded-xl border px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 lg:hidden"
          aria-expanded={menuOpen}
          aria-controls="mobile-nav"
          aria-label={menuOpen ? "Stäng meny" : "Öppna meny"}
        >
          Meny
        </button>
        <nav aria-label="Huvudmeny" className="hidden items-center gap-1 lg:flex">
          {nav.map((n) => {
            const active = pathname === n.href || (n.href !== "/" && pathname.startsWith(n.href));
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={`px-3 py-2 rounded-xl text-sm hover:bg-gray-100 ${active ? "bg-gray-100 font-medium" : "text-gray-700"}`}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        </div>

          <nav id="mobile-nav" aria-label="Mobilmeny" className={`${menuOpen ? "grid" : "hidden"} gap-2 border-t pb-3 pt-2 lg:hidden`}>
            {nav.map((n) => {
              const active = pathname === n.href || (n.href !== "/" && pathname.startsWith(n.href));
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={active ? "page" : undefined}
                  className={`min-h-11 rounded-xl px-3 py-3 text-sm hover:bg-gray-100 ${
                    active ? "bg-gray-100 font-medium" : "text-gray-700"
                  }`}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
      </div>
    </header>
  );
}
