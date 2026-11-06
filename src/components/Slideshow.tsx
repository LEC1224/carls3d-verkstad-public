import { useEffect, useState } from "react";
import Image from "next/image";

type Slide = { src: string; alt?: string; caption?: string };

type Props = {
  images: Array<string | Slide>;
  intervalMs?: number;
  aspect?: number;
  fit?: "cover" | "contain";
};

export default function Slideshow({
  images,
  intervalMs = 7000,
  aspect = 16 / 9,
  fit = "contain",
}: Props) {
  const slides: Slide[] = images
    .map((slide) => (typeof slide === "string" ? { src: slide } : slide))
    .filter((slide) => Boolean(slide.src));
  const [index, setIndex] = useState(0);
  const [visitedIndexes, setVisitedIndexes] = useState([0]);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [pageHidden, setPageHidden] = useState(false);
  const many = slides.length > 1;
  const activeIndex = slides.length ? index % slides.length : 0;
  const playing = many && !paused && !hovered && !reducedMotion && !pageHidden;

  useEffect(() => {
    setVisitedIndexes((visited) => visited.includes(activeIndex) ? visited : [...visited, activeIndex]);
  }, [activeIndex]);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setReducedMotion(preference.matches);
    const updateVisibility = () => setPageHidden(document.hidden);
    updatePreference();
    updateVisibility();
    preference.addEventListener("change", updatePreference);
    document.addEventListener("visibilitychange", updateVisibility);
    return () => {
      preference.removeEventListener("change", updatePreference);
      document.removeEventListener("visibilitychange", updateVisibility);
    };
  }, []);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(
      () => setIndex((current) => (current + 1) % slides.length),
      intervalMs
    );
    return () => window.clearTimeout(timer);
  }, [activeIndex, intervalMs, playing, slides.length]);

  function move(direction: number) {
    setPaused(true);
    setIndex((current) => (current + direction + slides.length) % slides.length);
  }

  if (!slides.length) return null;

  return (
    <figure
      role="region"
      aria-roledescription="bildspel"
      aria-label="Exempel på 3D-utskrifter"
      className="overflow-hidden rounded-2xl border bg-white shadow-sm"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={(event) => {
        if (event.target.matches(":focus-visible")) setPaused(true);
      }}
      onKeyDown={(event) => {
        if (!many || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
        event.preventDefault();
        move(event.key === "ArrowLeft" ? -1 : 1);
      }}
    >
      <div className="relative overflow-hidden bg-black" style={{ aspectRatio: aspect }}>
        <div
          className="absolute inset-0 flex transition-transform duration-500 ease-out motion-reduce:transition-none"
          style={{ transform: `translateX(-${activeIndex * 100}%)` }}
        >
          {slides.map((slide, slideIndex) => (
            <div
              key={`${slide.src}-${slideIndex}`}
              className="relative h-full min-w-full"
              role="group"
              aria-roledescription="bild"
              aria-label={`${slideIndex + 1} av ${slides.length}`}
              aria-hidden={slideIndex !== activeIndex}
            >
              {/* Load on demand, keeping visited images mounted for smooth transitions. */}
              {(visitedIndexes.includes(slideIndex) || slideIndex === activeIndex || slideIndex === (activeIndex + 1) % slides.length) && (
                <Image
                  src={slide.src}
                  alt={slide.alt || slide.caption || `3D-utskrift ${slideIndex + 1}`}
                  fill
                  sizes="(min-width: 1216px) 1152px, (min-width: 1024px) calc(100vw - 64px), (min-width: 640px) calc(100vw - 48px), calc(100vw - 32px)"
                  className={fit === "contain" ? "object-contain" : "object-cover"}
                  priority={slideIndex === 0}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      <figcaption className="border-t px-4 py-3 text-sm text-gray-700">
        <div aria-live={playing ? "off" : "polite"} aria-atomic="true" className="min-h-20 text-center sm:min-h-12">
          <span className="block text-xs tabular-nums text-gray-500">
            Bild {activeIndex + 1} av {slides.length}
          </span>
          <span className="mt-1 block">{slides[activeIndex].caption || slides[activeIndex].alt}</span>
        </div>
        {many && (
          <div className="mt-3 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => move(-1)}
              className="min-h-11 min-w-11 rounded-xl border px-3 py-2 hover:bg-gray-50"
              aria-label="Föregående bild"
            >
              <span aria-hidden="true">←</span>
            </button>
            {!reducedMotion && (
              <button
                type="button"
                onClick={() => setPaused((current) => !current)}
                className="min-h-11 min-w-32 rounded-xl border px-3 py-2 hover:bg-gray-50 sm:min-w-40"
                aria-label={paused ? "Starta automatiskt bildspel" : "Pausa automatiskt bildspel"}
              >
                {paused ? "Spela bildspel" : "Pausa bildspel"}
              </button>
            )}
            <button
              type="button"
              onClick={() => move(1)}
              className="min-h-11 min-w-11 rounded-xl border px-3 py-2 hover:bg-gray-50"
              aria-label="Nästa bild"
            >
              <span aria-hidden="true">→</span>
            </button>
          </div>
        )}
      </figcaption>
    </figure>
  );
}
