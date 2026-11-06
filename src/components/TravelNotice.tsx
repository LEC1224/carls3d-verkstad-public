import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { formatSwedishDate } from "../lib/travelPeriods";
import { fetchCheckoutJson } from "../lib/checkoutRequest";

type ActiveTravelPeriod = {
  id: number;
  startsOn: string;
  returnsOn: string;
};

const ORDER_PATHS = new Set(["/bestall", "/lithophane", "/minecraft-torch"]);

function isTravelPeriod(value: unknown): value is ActiveTravelPeriod {
  if (!value || typeof value !== "object") return false;
  const period = value as ActiveTravelPeriod;
  return Number.isInteger(period.id)
    && typeof period.startsOn === "string" && Number.isFinite(Date.parse(period.startsOn))
    && typeof period.returnsOn === "string" && Number.isFinite(Date.parse(period.returnsOn))
    && Date.parse(period.returnsOn) > Date.parse(period.startsOn);
}

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
    let activeRequest: AbortController | null = null;

    async function loadCurrentPeriod() {
      if (disposed || document.hidden || activeRequest) return;
      const controller = new AbortController();
      activeRequest = controller;
      try {
        const { response, data } = await fetchCheckoutJson("/api/travel-period", {
          cache: "no-store", signal: controller.signal,
        }, 10_000);
        if (!response.ok || disposed || controller.signal.aborted) return;
        if (data?.period === null) setPeriod(null);
        else if (isTravelPeriod(data?.period)) setPeriod(data.period);
      } catch {
        // Orders should remain usable even if the notice cannot be loaded.
      } finally {
        if (activeRequest === controller) activeRequest = null;
      }
    }

    const onVisibilityChange = () => {
      if (!document.hidden) void loadCurrentPeriod();
    };

    void loadCurrentPeriod();
    const refreshTimer = window.setInterval(loadCurrentPeriod, 5 * 60 * 1000);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      disposed = true;
      activeRequest?.abort();
      window.clearInterval(refreshTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [isOrderPage]);

  if (!isOrderPage || !period) return null;

  return (
    <aside
      role="status"
      aria-live="polite"
      aria-atomic="true"
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
