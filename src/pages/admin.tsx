import { useEffect, useState } from "react";

export default function Admin() {
  const [orders, setOrders] = useState<any[]>([]);

  useEffect(() => {
    fetch("/api/orders")
      .then(res => res.json())
      .then(data => setOrders(data));
  }, []);

  return (
    <main className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Admin - Beställningar</h1>
      <table className="w-full border-collapse border">
        <thead>
          <tr>
            <th className="border p-2">ID</th>
            <th className="border p-2">Namn</th>
            <th className="border p-2">E-post</th>
            <th className="border p-2">Typ</th>
            <th className="border p-2">Material</th>
            <th className="border p-2">Färg</th>
            <th className="border p-2">Pris</th>
            <th className="border p-2">Status</th>
            <th className="border p-2">Filer</th>
          </tr>
        </thead>
        <tbody>
          {orders.map(order => (
            <tr key={order.id}>
              <td className="border p-2">{order.id}</td>
              <td className="border p-2">{order.name}</td>
              <td className="border p-2">{order.email}</td>
              <td className="border p-2">{order.type}</td>
              <td className="border p-2">{order.material || "-"}</td>
              <td className="border p-2">{order.color || "-"}</td>
              <td className="border p-2">{order.price} kr</td>
              <td className="border p-2">{order.status}</td>
              <td className="border p-2">{order.files.join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
