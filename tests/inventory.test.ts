import { validateAvailableColors } from "../src/lib/inventory";

function database(rows: unknown[]) {
  return { inventory: { findMany: jest.fn(async () => rows) } } as any;
}

test("unconfigured materials keep all known colors available", async () => {
  await expect(validateAvailableColors(database([]), [{ material: "PLA", color: "white" }])).resolves.toBeUndefined();
  await expect(validateAvailableColors(database([]), [{ material: "PLA", color: "invented" }])).rejects.toMatchObject({ statusCode: 400 });
});

test("configured inventory rejects unavailable and missing colors before estimation or ordering", async () => {
  const db = database([{ material: "PLA", color: "white", available: false }, { material: "PLA", color: "black", available: true }]);
  await expect(validateAvailableColors(db, [{ material: "PLA", color: "black" }])).resolves.toBeUndefined();
  await expect(validateAvailableColors(db, [{ material: "PLA", color: "white" }])).rejects.toThrow("inte längre tillgänglig");
  await expect(validateAvailableColors(db, [{ material: "PLA", color: "red" }])).rejects.toThrow("inte längre tillgänglig");
  await expect(validateAvailableColors(db, [{ material: "PETG", color: "white" }])).resolves.toBeUndefined();
});
