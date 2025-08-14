import { NextApiRequest, NextApiResponse } from "next";
import { PrismaClient } from "@prisma/client";
import formidable from "formidable";
import { sendOrderEmail } from "@/lib/email";

export const config = {
  api: {
    bodyParser: false
  }
};

const prisma = new PrismaClient();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const form = formidable({ multiples: true, uploadDir: "./uploads", keepExtensions: true });

  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(500).json({ error: "Bilduppladdning misslyckades" });

    const name = fields.name as string;
    const email = fields.email as string;
    const fileList = Array.isArray(files.images) ? files.images : [files.images];
    const fileNames = fileList.map(f => (f as any).originalFilename);

    const price = 500;

    const order = await prisma.order.create({
      data: {
        name,
        email,
        type: "lithophane",
        price,
        files: fileNames
      }
    });

    await sendOrderEmail(email, "Bekräftelse på din Lithophane-beställning", `Tack för din beställning! Pris: ${price} kr`);
    await sendOrderEmail("carl.1224@outlook.com", "Ny 3D-printbeställning", `Ny lithophane-beställning #${order.id}`, fileList.map(f => ({
      filename: (f as any).originalFilename,
      path: (f as any).filepath
    })));

    res.json({ success: true });
  });
}
