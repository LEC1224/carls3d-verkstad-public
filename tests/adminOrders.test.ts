import { filterOrders, OrderFilters, SearchableOrder } from "../src/lib/adminOrders";

const filters: OrderFilters = { query: "", status: "all", type: "all", delivery: "all" };
const orders: SearchableOrder[] = [
  { id: 1, orderNumber: "20261106-001", name: "Åsa Öberg", email: "asa@example.test", city: "Västerås", phone: "070 123 45 67", type: "standard", status: "Ny", deliveryMethod: "pickup", files: ["token wheel.stl"] },
  { id: 2, orderNumber: "20261106-002", name: "Carl", email: "carl@example.test", type: "lithophane", status: "Klar", deliveryMethod: "shipping", files: ["token holiday.jpg"] },
  { id: 3, name: "Lina", email: "lina@example.test", type: "minecraft-torch", status: "Ny", files: [] },
];

describe("admin order filtering", () => {
  it("combines multiple search terms across customer and file fields, ignoring accents and case", () => {
    expect(filterOrders(orders, { ...filters, query: "  ASA   wheel  VASTERAS " }).map((order) => order.id)).toEqual([1]);
    expect(filterOrders(orders, { ...filters, query: "Åsa holiday" })).toEqual([]);
  });

  it("finds order numbers, phone numbers and Swedish product labels", () => {
    expect(filterOrders(orders, { ...filters, query: "20261106-002" }).map((order) => order.id)).toEqual([2]);
    expect(filterOrders(orders, { ...filters, query: "070 123" }).map((order) => order.id)).toEqual([1]);
    expect(filterOrders(orders, { ...filters, query: "Minecraft-fackla" }).map((order) => order.id)).toEqual([3]);
  });

  it("combines status, type and delivery filters without mutating the source", () => {
    const filtered = filterOrders(orders, { ...filters, status: "open", type: "standard", delivery: "pickup" });
    expect(filtered).toEqual([orders[0]]);
    expect(orders).toHaveLength(3);
    expect(filterOrders(orders, { ...filters, status: "complete" })).toEqual([orders[1]]);
  });

  it("includes legacy orders without deliveryMethod as shipping", () => {
    expect(filterOrders(orders, { ...filters, delivery: "shipping" }).map((order) => order.id)).toEqual([2, 3]);
    expect(filterOrders(orders, { ...filters, query: "   " })).toEqual(orders);
  });
});
