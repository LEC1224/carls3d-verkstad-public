import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import fs from "fs";
import { completePrintJob, listWorkflowJobs, processPendingEmails, readWorkflowJob, workflowSourceFile } from "../../lib/orderWorkflow";

// Separate machine credential; never expose this endpoint via the customer UI.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  const expected = process.env.ORDER_WORKFLOW_TOKEN;
  const supplied = req.headers.authorization?.replace(/^Bearer /, "");
  if (!expected || !supplied || Buffer.byteLength(expected) !== Buffer.byteLength(supplied) ||
      !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    if (req.method === "GET" && req.query.file !== undefined) {
      const job = readWorkflowJob(Number(req.query.id));
      const file = workflowSourceFile(job, Number(req.query.file));
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Length", fs.statSync(file).size);
      const stream = fs.createReadStream(file);
      stream.on("error", () => res.destroy());
      stream.pipe(res);
      return;
    }
    if (req.method === "GET") {
      return res.json(listWorkflowJobs().filter(j => j.print.state === "pending").slice(0, 10).map(j => j.order));
    }
    if (req.method === "POST" && req.body?.action === "emails") {
      await processPendingEmails();
      return res.json({ ok: true });
    }
    if (req.method === "POST" && req.body?.action === "print") {
      const { id, state, output, error } = req.body;
      if (!["complete", "review"].includes(state)) return res.status(400).json({ error: "Invalid state" });
      await completePrintJob(Number(id), { state, output: String(output || "").slice(0, 500), error: String(error || "").slice(0, 1000) });
      return res.json({ ok: true });
    }
    return res.status(405).json({ error: "Unsupported operation" });
  } catch {
    return res.status(500).json({ error: "Workflow operation failed; inspect server state." });
  }
}
