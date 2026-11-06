import fs from "fs";
import path from "path";
import crypto from "crypto";
import { notifyOrder, type OrderLike } from "./notify";
import { buildOrderEmail, sendOrderEmail, OrderEmailError } from "./orderEmail";

type EmailState = { state: "pending" | "sent" | "review"; payload?: ReturnType<typeof buildOrderEmail>; id?: string; firstAttempt?: number; attempts: number; nextAttempt: number; error?: string };
export type WorkflowJob = {
  version: 1; order: OrderLike; createdAt: string;
  email: Record<"customer" | "owner", EmailState>;
  print: { state: "pending" | "complete" | "review"; output?: string; error?: string };
};
export function workflowDirectory() {
  return process.env.ORDER_WORKFLOW_DIR || path.join(process.cwd(), "data", "order-workflow");
}
function jobPath(id: number) {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("Invalid order ID");
  return path.join(workflowDirectory(), `${id}.json`);
}
function writeJob(job: WorkflowJob) {
  const destination = jobPath(job.order.id!);
  const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(job, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, destination);
}
export function readWorkflowJob(id: number): WorkflowJob {
  return JSON.parse(fs.readFileSync(jobPath(id), "utf8"));
}
export function listWorkflowJobs(): WorkflowJob[] {
  fs.mkdirSync(workflowDirectory(), { recursive: true });
  return fs.readdirSync(workflowDirectory()).filter(f => /^\d+\.json$/.test(f))
    .flatMap(f => {
      try {
        const job = readWorkflowJob(Number(f.slice(0, -5)));
        if (job.version !== 1 || !job.order || !job.email?.customer || !job.email?.owner || !job.print) throw new Error("Invalid job");
        return [job];
      } catch { console.error(`Invalid workflow record: ${f}; manual recovery required`); return []; }
    });
}
// Atomic initial creation: retries never reset delivered email or completed print state.
export function enqueueOrderWorkflow(order: OrderLike) {
  fs.mkdirSync(workflowDirectory(), { recursive: true });
  if (fs.existsSync(jobPath(order.id!))) return;
  const initial = (): EmailState => ({ state: "pending", attempts: 0, nextAttempt: 0 });
  const job: WorkflowJob = { version: 1, order, createdAt: new Date().toISOString(),
    email: { customer: initial(), owner: initial() }, print: { state: "pending" } };
  const temp = `${jobPath(order.id!)}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(job, null, 2), { mode: 0o600 });
  try { fs.linkSync(temp, jobPath(order.id!)); }
  catch (e: any) { if (e.code !== "EEXIST") throw e; }
  finally { fs.unlinkSync(temp); }
}
async function withJobLock(id: number, action: () => Promise<void>) {
  const lock = `${jobPath(id)}.lock`;
  let descriptor: number;
  try { descriptor = fs.openSync(lock, "wx"); }
  catch (e: any) {
    if (e.code !== "EEXIST") throw e;
    // Only recover locks older than the maximum request/send duration.
    try { if (Date.now() - fs.statSync(lock).mtimeMs > 10 * 60_000) fs.unlinkSync(lock); } catch {}
    return false;
  }
  try { await action(); return true; }
  finally { fs.closeSync(descriptor); fs.unlinkSync(lock); }
}
export async function processOrderEmails(id: number) {
  await withJobLock(id, async () => {
    const job = readWorkflowJob(id);
    for (const target of ["customer", "owner"] as const) {
      const state = job.email[target];
      if (state.state !== "pending" || state.nextAttempt > Date.now()) continue;
      if (state.firstAttempt && Date.now() - state.firstAttempt > 23 * 3600_000) {
        state.state = "review";
        state.error = "Check Resend delivery history before retrying: idempotency window ending.";
        writeJob(job);
        continue;
      }
      try {
        state.payload ||= buildOrderEmail(job.order, target);
        state.firstAttempt ||= Date.now();
        state.attempts++;
        state.nextAttempt = Date.now() + Math.min(15 * 60_000, 30_000 * 2 ** Math.min(state.attempts, 5));
        writeJob(job); // Persist immutable payload BEFORE attempting the network send.
        const result = await sendOrderEmail(job.order, target, state.payload);
        state.id = result.id;
        state.state = "sent";
        delete state.error;
      } catch (e) {
        state.error = e instanceof Error ? e.message : "Email delivery failed";
        if (e instanceof OrderEmailError && !e.retryable) state.state = "review";
        state.nextAttempt = Date.now() + 60_000;
      }
      writeJob(job);
    }
  });
}
export async function processPendingEmails(limit = 5) {
  for (const job of listWorkflowJobs().filter(j => Object.values(j.email).some(s => s.state === "pending" && s.nextAttempt <= Date.now())).slice(0, limit)) {
    try { await processOrderEmails(job.order.id!); }
    catch { console.error(`Workflow retry failed for order ${job.order.id}`); }
  }
}
export async function completePrintJob(id: number, result: WorkflowJob["print"]) {
  const saved = await withJobLock(id, async () => {
    const job = readWorkflowJob(id);
    if (job.print.state === "complete") return;
    job.print = result;
    writeJob(job);
  });
  if (!saved) throw new Error("Order busy; retry acknowledgment");
}
export async function fulfillOrder(order: OrderLike) {
  enqueueOrderWorkflow(order);
  // The accepted order remains accepted if a downstream service is unavailable.
  try { await processOrderEmails(order.id!); }
  catch { console.error(`Email workflow deferred for order ${order.id}`); }
  await notifyOrder(order);
}
export function workflowSourceFile(job: WorkflowJob, index: number) {
  const item = job.order.items?.[index];
  if (!item || !Number.isInteger(index) || path.basename(item.filename) !== item.filename) throw new Error("Invalid file");
  const uploads = path.resolve(process.cwd(), "uploads");
  const file = fs.realpathSync(path.join(uploads, item.filename));
  if (!file.startsWith(uploads + path.sep)) throw new Error("Invalid source path");
  return file;
}
