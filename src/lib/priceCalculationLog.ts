type EstimateStats = {
  source?: string;
  fallbackReason?: string;
  volumeMm3?: number;
  layerCount?: number;
  layerHeight?: number;
  xyStep?: number;
  wallCount?: number;
  topBottomLayers?: number;
  infillDensity?: number;
  shellVolumeMm3?: number;
  solidVolumeMm3?: number;
  infillVolumeMm3?: number;
  shellFactor?: number;
  solidFactor?: number;
};

type PriceLogEntry = {
  index: number;
  name: string;
  material: string;
  color: string;
  copies: number;
  gramsEach: number;
  estimate?: EstimateStats;
};

type PriceBreakdown = {
  grams?: number;
  packagingGrams?: number;
  materialCost?: number;
  fileFee?: number;
  baseFee?: number;
  shipping?: number;
  total?: number;
  discount?: number;
  coupon?: unknown;
};

function round(value: unknown, decimals = 2) {
  if (typeof value !== "number" || !Number.isFinite(value)) return value;
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

export function logPriceCalculation(context: string, entries: PriceLogEntry[], breakdown: PriceBreakdown) {
  const items = entries.map((entry) => ({
    index: entry.index,
    name: entry.name,
    material: entry.material,
    color: entry.color,
    copies: entry.copies,
    gramsEach: round(entry.gramsEach),
    gramsTotal: round(entry.gramsEach * entry.copies),
    estimator: entry.estimate?.source || "unknown",
    fallbackReason: entry.estimate?.fallbackReason || null,
    modelVolumeCm3: round((entry.estimate?.volumeMm3 || 0) / 1000, 3),
    layerCount: entry.estimate?.layerCount ?? null,
    layerHeight: round(entry.estimate?.layerHeight, 3),
    xyStep: round(entry.estimate?.xyStep, 3),
    wallCount: entry.estimate?.wallCount ?? null,
    topBottomLayers: entry.estimate?.topBottomLayers ?? null,
    infillDensity: round(entry.estimate?.infillDensity, 3),
    shellVolumeCm3: round((entry.estimate?.shellVolumeMm3 || 0) / 1000, 3),
    solidVolumeCm3: round((entry.estimate?.solidVolumeMm3 || 0) / 1000, 3),
    infillVolumeCm3: round((entry.estimate?.infillVolumeMm3 || 0) / 1000, 3),
    shellFactor: round(entry.estimate?.shellFactor, 3),
    solidFactor: round(entry.estimate?.solidFactor, 3),
  }));

  console.info("[price-calculation]", JSON.stringify({
    context,
    at: new Date().toISOString(),
    items,
    totals: {
      modelGrams: round(breakdown.grams),
      packagingGrams: round(breakdown.packagingGrams),
      materialCost: breakdown.materialCost,
      fileFee: breakdown.fileFee,
      baseFee: breakdown.baseFee,
      shipping: breakdown.shipping,
      discount: breakdown.discount || 0,
      total: breakdown.total,
      couponApplied: Boolean(breakdown.coupon),
    },
  }));
}
