import type { PrismaClient } from "@prisma/client";
import { ALL_COLORS } from "./colors";
import { RequestError } from "./requestErrors";

export async function validateAvailableColors(prisma: PrismaClient, items: Array<{ material: string; color: string }>) {
  const materials = Array.from(new Set(items.map((item) => item.material)));
  const rows = await prisma.inventory.findMany({ where: { material: { in: materials } } });
  const configured = new Set(ALL_COLORS.map((color) => color.value));
  for (const item of items) {
    const materialRows = rows.filter((row) => row.material === item.material);
    const available = configured.has(item.color) && (materialRows.length === 0 || materialRows.some((row) => row.color === item.color && row.available));
    if (!available) {
      throw new RequestError(`Den valda färgen är inte längre tillgänglig för ${item.material}. Välj en annan färg och beräkna priset igen.`, 400, "COLOR_UNAVAILABLE");
    }
  }
}
