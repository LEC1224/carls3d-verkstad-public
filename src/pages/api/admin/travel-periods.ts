import type { NextApiRequest, NextApiResponse } from "next";
import { PrismaClient } from "@prisma/client";
import { requireAdmin } from "../../../lib/adminAuth";
import { dateOnlyToUtc, getTravelPeriodStatus } from "../../../lib/travelPeriods";

const prisma = new PrismaClient();

function withStatus<T extends { startsOn: Date; returnsOn: Date; cancelledAt: Date | null }>(period: T) {
  return { ...period, status: getTravelPeriodStatus(period) };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireAdmin(req, res)) return;

  if (req.method === "GET") {
    const periods = await prisma.travelPeriod.findMany({
      orderBy: [{ startsOn: "desc" }, { id: "desc" }],
      take: 100,
    });
    return res.status(200).json(periods.map(withStatus));
  }

  if (req.method === "POST") {
    const startsOn = dateOnlyToUtc(req.body?.startsOn);
    const returnsOn = dateOnlyToUtc(req.body?.returnsOn);

    if (!startsOn || !returnsOn) {
      return res.status(400).json({ error: "Avresedatum och hemkomstdatum krävs." });
    }
    if (returnsOn <= startsOn) {
      return res.status(400).json({ error: "Hemkomstdatum måste vara efter avresedatum." });
    }

    const overlappingPeriod = await prisma.travelPeriod.findFirst({
      where: {
        cancelledAt: null,
        startsOn: { lt: returnsOn },
        returnsOn: { gt: startsOn },
      },
      select: { id: true },
    });
    if (overlappingPeriod) {
      return res.status(409).json({ error: "Datumen överlappar en annan bortresa." });
    }

    const period = await prisma.travelPeriod.create({ data: { startsOn, returnsOn } });
    return res.status(201).json(withStatus(period));
  }

  return res.status(405).json({ error: "GET/POST stöds." });
}
