import { useEffect, useId, useRef, useState } from "react";

const TEXTS: Record<string, string> = {
  PLA: "Snyggast finish. Fossilfri plast från förnyelsebara källor.",
  PETG: "Slag- och fukttåligt. Klarar högre temperaturer än PLA.",
  ABS: "Värmetåligt. Bra för bilar, maskiner och andra varma miljöer.",
  ASA: "Som ABS men UV-tåligt. Bäst utomhus.",
  TPU: "Flexibelt (gummi-likt). Packningar, skydd, dämpning.",
};

export default function MaterialInfo({ material }: { material: string }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 16, top: 0, width: 256 });
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  function positionPanel() {
    const trigger = buttonRef.current?.getBoundingClientRect();
    if (!trigger) return;
    const width = Math.min(256, window.innerWidth - 32);
    const height = panelRef.current?.offsetHeight || 110;
    const fitsBelow = trigger.bottom + height + 24 <= window.innerHeight;
    setPosition({
      left: Math.max(16, Math.min(trigger.left, window.innerWidth - width - 16)),
      top: Math.max(16, fitsBelow ? trigger.bottom + 8 : trigger.top - height - 8),
      width,
    });
  }

  useEffect(() => {
    if (!open) return;
    positionPanel();
    const closeOutside = (event: Event) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("focusin", closeOutside);
    document.addEventListener("keydown", onEscape);
    window.addEventListener("resize", positionPanel);
    window.addEventListener("scroll", positionPanel, true);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("focusin", closeOutside);
      document.removeEventListener("keydown", onEscape);
      window.removeEventListener("resize", positionPanel);
      window.removeEventListener("scroll", positionPanel, true);
    };
  }, [open, material]);

  const mat = (material || "").toUpperCase();
  const text = TEXTS[mat] ?? "Välj material efter användning.";

  return (
    <div ref={ref} className="relative inline-block align-middle ml-1">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => { if (!open) positionPanel(); setOpen((value) => !value); }}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border p-0 text-xs leading-none text-gray-600 hover:bg-gray-50"
        aria-label={`Info om ${mat}`}
        aria-expanded={open}
        aria-controls={panelId}
        aria-describedby={open ? panelId : undefined}
        title="Kort materialinfo"
      >
        i
      </button>
      {open && (
        <div ref={panelRef} id={panelId} style={position} className="fixed z-40 max-h-[calc(100vh-32px)] overflow-auto rounded-xl border bg-white p-3 text-sm font-normal text-gray-700 shadow-lg">
          <div className="font-medium mb-1">{mat}</div>
          <p>{text}</p>
        </div>
      )}
    </div>
  );
}
