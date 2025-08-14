import { NextApiRequest, NextApiResponse } from "next";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const orders = await prisma.order.findMany({
    orderBy: { createdAt: "desc" }
  });
  res.json(orders);
}
