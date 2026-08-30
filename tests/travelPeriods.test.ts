import {
  dateOnlyToUtc,
  getDateKeyInTimeZone,
  getTravelPeriodStatus,
} from "../src/lib/travelPeriods";

describe("travel periods", () => {
  test("accepts real date-only values and rejects invalid dates", () => {
    expect(dateOnlyToUtc("2028-02-29")?.toISOString()).toBe("2028-02-29T00:00:00.000Z");
    expect(dateOnlyToUtc("2027-02-29")).toBeNull();
    expect(dateOnlyToUtc("30/08/2026")).toBeNull();
  });

  test("uses the Swedish calendar day", () => {
    expect(getDateKeyInTimeZone(new Date("2026-08-30T22:30:00.000Z"))).toBe("2026-08-31");
  });

  test("is active from departure through the day before returning", () => {
    const period = { startsOn: "2026-09-10", returnsOn: "2026-09-15" };

    expect(getTravelPeriodStatus(period, "2026-09-09")).toBe("scheduled");
    expect(getTravelPeriodStatus(period, "2026-09-10")).toBe("active");
    expect(getTravelPeriodStatus(period, "2026-09-14")).toBe("active");
    expect(getTravelPeriodStatus(period, "2026-09-15")).toBe("ended");
  });

  test("cancelled periods stay cancelled", () => {
    expect(
      getTravelPeriodStatus(
        { startsOn: "2026-09-10", returnsOn: "2026-09-15", cancelledAt: "2026-09-11" },
        "2026-09-11"
      )
    ).toBe("cancelled");
  });
});
