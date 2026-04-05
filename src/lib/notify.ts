export interface NotifyItem {
  filename: string;
  token: string;
  material: string;
  color: string;
  copies: number;
  gramsEach: number;
}

export interface OrderLike {
  id?: number;
  orderNumber?: string;
  name?: string;
  email?: string;
  type?: "standard" | "lithophane" | string;
  price?: number;

  // leverans
  addressLine1?: string;
  addressLine2?: string | null;
  postalCode?: string;
  city?: string;
  country?: string;
  phone?: string | null;

  // filer/produkter
  items?: NotifyItem[];
}

function chunk(text: string, max = 950) {
  return text.length <= max ? text : text.slice(0, max - 1) + "…";
}

export async function notifyOrder(order: OrderLike) {
  const url = process.env.DISCORD_WEBHOOK;
  if (!url) {
    console.warn("DISCORD_WEBHOOK saknas – skickar ingen Discord-notis.");
    return;
  }

  const now = new Date().toISOString();
  const title =
    order.type === "lithophane"
      ? "🖼️ Ny Lithophane-beställning"
      : order.type === "minecraft-torch"
        ? "🔥 Ny Minecraft-fackla-beställning"
      : "🖨️ Ny 3D-printbeställning";

  // Build file/item list
  const itemsList = (order.items ?? [])
    .map(
      (it) =>
        `• \`${it.token}\` — ${it.filename} • ${it.material}/${it.color} ×${it.copies} (${it.gramsEach} g/st)`
    )
    .join("\n");
  const itemsValue = itemsList ? chunk(itemsList, 950) : "—";

  const addressLines =
    [
      order.addressLine1,
      order.addressLine2,
      `${order.postalCode ?? ""} ${order.city ?? ""}`.trim(),
      order.country,
      order.phone ? `Tel: ${order.phone}` : undefined,
    ]
      .filter(Boolean)
      .join("\n") || "—";

  const embeds = [
    {
      title,
      description: `Beställning ${order.orderNumber ?? "#" + order.id ?? "—"} • ${now}`,
      color: order.type === "lithophane" ? 0x5865f2 : order.type === "minecraft-torch" ? 0xf59e0b : 0x57f287,
      fields: [
        { name: "Namn", value: order.name || "—", inline: true },
        { name: "E-post", value: order.email || "—", inline: true },
        { name: "Typ", value: order.type || "standard", inline: true },
        {
          name: "Pris",
          value: order.price != null ? `${order.price} kr` : "—",
          inline: true,
        },
        { name: "Leverans", value: addressLines, inline: false },
        { name: "Produkter", value: itemsValue, inline: false },
      ],
    },
  ];

  const payload = { username: "3D-Print Notifier", content: "", embeds };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error("Discord webhook svarade ej OK:", res.status, txt);
    }
  } catch (err) {
    console.error("Kunde inte skicka Discord-notis:", err);
  }
}
