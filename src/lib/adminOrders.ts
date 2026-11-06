export type OrderFilters = {
  query: string;
  status: "all" | "open" | "complete";
  type: string;
  delivery: "all" | "shipping" | "pickup";
};

export type SearchableOrder = {
  id: number;
  orderNumber?: string;
  name: string;
  email: string;
  phone?: string | null;
  city?: string;
  postalCode?: string;
  type: string;
  status: string;
  deliveryMethod?: "shipping" | "pickup";
  files: string[];
};

export const orderTypeLabels: Record<string, string> = {
  standard: "3D-utskrift",
  lithophane: "Lithophane-lampa",
  "minecraft-torch": "Minecraft-fackla",
};

function searchText(value: string) {
  return value.toLocaleLowerCase("sv-SE").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function filterOrders<T extends SearchableOrder>(orders: T[], filters: OrderFilters): T[] {
  const terms = searchText(filters.query.trim()).split(/\s+/).filter(Boolean);
  return orders.filter((order) => {
    if (filters.status === "open" && order.status === "Klar") return false;
    if (filters.status === "complete" && order.status !== "Klar") return false;
    if (filters.type !== "all" && order.type !== filters.type) return false;
    if (filters.delivery !== "all" && (order.deliveryMethod || "shipping") !== filters.delivery) return false;
    if (!terms.length) return true;
    const text = searchText([
      order.id, order.orderNumber, order.name, order.email, order.phone,
      order.city, order.postalCode, order.type, orderTypeLabels[order.type], ...order.files,
    ].filter((value) => value != null).join(" "));
    return terms.every((term) => text.includes(term));
  });
}
