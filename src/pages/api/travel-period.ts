import type { NextApiRequest, NextApiResponse } from "next";
import { PrismaClient } from "@prisma/client";
import { dateOnlyToUtc, getDateKeyInTimeZone } from "../../lib/travelPeriods";

const prisma = new PrismaClient();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET stöds." });

  const today = dateOnlyToUtc(getDateKeyInTimeZone());
  if (!today) return res.status(500).json({ error: "Kunde inte fastställa dagens datum." });

  const period = await prisma.travelPeriod.findFirst({
    where: {
      cancelledAt: null,
      startsOn: { lte: today },
      returnsOn: { gt: today },
    },
    orderBy: { startsOn: "desc" },
    select: { id: true, startsOn: true, returnsOn: true },
  });

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ period });
}
