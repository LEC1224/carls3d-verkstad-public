// src/pages/api/orders.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../lib/prisma";
import { requireAdmin } from "../../lib/adminAuth";
import { listWorkflowJobs } from "../../lib/orderWorkflow";


export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireAdmin(req, res)) return;

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Endast GET stöds." });
  }

  try {
    const rows = await prisma.order.findMany({
      orderBy: { createdAt: "desc" },
      include: { files: true },
    });

    const workflowJobs = new Map(listWorkflowJobs().map((job) => [job.order.id, job]));
    const data = rows.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      createdAt: o.createdAt,
      name: o.name,
      email: o.email,
      type: o.type,
      // material/color removed from Order header in schema; we no longer expose them here
      price: o.price,
      discount: o.discount,
      couponCode: o.couponCode,
      status: o.status,
      workflow: workflowJobs.has(o.id) ? {
        customerEmail: workflowJobs.get(o.id)!.email.customer.state,
        ownerEmail: workflowJobs.get(o.id)!.email.owner.state,
        print: workflowJobs.get(o.id)!.print.state,
        printError: workflowJobs.get(o.id)!.print.error,
      } : null,
      deliveryMethod: o.deliveryMethod,

      // shipping/contact
      addressLine1: o.addressLine1,
      addressLine2: o.addressLine2,
      postalCode: o.postalCode,
      city: o.city,
      country: o.country,
      phone: o.phone,

      // for admin table: show "TOKEN filename"
      files: o.files.map((f) => `${f.token} ${f.filename}`),
    }));

    res.status(200).json(data);
  } catch (e: any) {
    console.error("/api/orders error:", e);
    res.status(500).json({ error: "Kunde inte hämta ordrar." });
  }
}
