import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { formatSwedishDate } from "../lib/travelPeriods";

type ActiveTravelPeriod = {
  id: number;
  startsOn: string;
  returnsOn: string;
};

const ORDER_PATHS = new Set(["/bestall", "/lithophane", "/minecraft-torch"]);

export default function TravelNotice() {
  const { pathname } = useRouter();
  const [period, setPeriod] = useState<ActiveTravelPeriod | null>(null);
  const isOrderPage = ORDER_PATHS.has(pathname);

  useEffect(() => {
    if (!isOrderPage) {
      setPeriod(null);
      return;
    }

    let disposed = false;

    async function loadCurrentPeriod() {
      try {
        const response = await fetch("/api/travel-period", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json();
        if (!disposed) setPeriod(data.period ?? null);
      } catch {
        // Orders should remain usable even if the notice cannot be loaded.
      }
    }

    loadCurrentPeriod();
    const refreshTimer = window.setInterval(loadCurrentPeriod, 5 * 60 * 1000);

    return () => {
      disposed = true;
      window.clearInterval(refreshTimer);
    };
  }, [isOrderPage]);

  if (!isOrderPage || !period) return null;

  return (
    <aside
      role="status"
      aria-live="polite"
      className="border-b border-amber-300 bg-amber-100 text-amber-950"
    >
      <div className="mx-auto flex max-w-7xl items-start gap-3 px-4 py-4 sm:px-6 lg:px-8">
        <span aria-hidden="true" className="text-2xl leading-none">✈️</span>
        <p className="text-sm leading-6 sm:text-base">
          <strong>Jag är bortrest och är tillbaka den {formatSwedishDate(period.returnsOn)}.</strong>{" "}
          Du kan fortfarande beställa, men det kan därför dröja innan din beställning skickas.
        </p>
      </div>
    </aside>
  );
}
