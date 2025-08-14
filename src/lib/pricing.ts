export const MATERIAL_COSTS: Record<string, number> = {
  PLA: 0.5,
  PETG: 0.5,
  ABS: 1,
  ASA: 1,
  TPU: 3
};

export const SHIPPING_BANDS: { limit: number; cost: number }[] = [
  { limit: 50, cost: 22 },
  { limit: 100, cost: 44 },
  { limit: 250, cost: 66 },
  { limit: 500, cost: 88 },
  { limit: 1000, cost: 132 },
  { limit: 2000, cost: 154 }
];

export function calculateShipping(weightGrams: number): number {
  const band = SHIPPING_BANDS.find(b => weightGrams <= b.limit);
  return band ? band.cost : SHIPPING_BANDS[SHIPPING_BANDS.length - 1].cost;
}

export function calculatePrice(
  totalWeight: number,
  material: string,
  fileCount: number
): number {
  const materialCost = MATERIAL_COSTS[material] ?? 0;
  const basePrice = totalWeight * materialCost;
  const fileFee = fileCount > 1 ? (fileCount - 1) * 10 : 0;
  const shipping = calculateShipping(totalWeight);
  return Math.round(basePrice + fileFee + shipping);
}
