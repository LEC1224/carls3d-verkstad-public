export const SWEDISH_TIME_ZONE = "Europe/Stockholm";

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type TravelPeriodStatus = "scheduled" | "active" | "ended" | "cancelled";

export function dateOnlyToUtc(value: unknown): Date | null {
  if (typeof value !== "string" || !DATE_KEY_PATTERN.test(value)) return null;

  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return date;
}

export function dateKey(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 10);
}

export function getDateKeyInTimeZone(
  value = new Date(),
  timeZone = SWEDISH_TIME_ZONE
): string {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

export function getTravelPeriodStatus(
  period: { startsOn: Date | string; returnsOn: Date | string; cancelledAt?: Date | string | null },
  today = getDateKeyInTimeZone()
): TravelPeriodStatus {
  if (period.cancelledAt) return "cancelled";

  const startsOn = dateKey(period.startsOn);
  const returnsOn = dateKey(period.returnsOn);
  if (today < startsOn) return "scheduled";
  if (today >= returnsOn) return "ended";
  return "active";
}

export function formatSwedishDate(value: Date | string): string {
  return new Intl.DateTimeFormat("sv-SE", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(value instanceof Date ? value : new Date(value));
}
