import fs from "fs";
import os from "os";
import path from "path";
import { enqueueOrderWorkflow, readWorkflowJob, listWorkflowJobs, processOrderEmails, processPendingEmails, completePrintJob, fulfillOrder, workflowSourceFile } from "../src/lib/orderWorkflow";
import { sendOrderEmail, OrderEmailError } from "../src/lib/orderEmail";
import { notifyOrder, type OrderLike } from "../src/lib/notify";

jest.mock("../src/lib/orderEmail", () => ({ ...jest.requireActual("../src/lib/orderEmail"), sendOrderEmail: jest.fn() }));
jest.mock("../src/lib/notify", () => ({ notifyOrder: jest.fn().mockResolvedValue(undefined) }));

const order: OrderLike = {
  id: 41, orderNumber: "SP-2026-000041-TEST", name: "Testkund", email: "customer@example.com", type: "standard",
  price: 145, deliveryMethod: "pickup", items: [{ filename: "part.stl", token: "part", copies: 2, color: "red", material: "PLA", gramsEach: 10 }],
};
const originalEnv = { ...process.env };
let queue: string;
let now: number;
let nowSpy: jest.SpyInstance;
const sendMock = sendOrderEmail as jest.MockedFunction<typeof sendOrderEmail>;

function updateJob(id: number, update: (job: ReturnType<typeof readWorkflowJob>) => void) {
  const job = readWorkflowJob(id);
  update(job);
  fs.writeFileSync(path.join(queue, `${id}.json`), JSON.stringify(job));
}

beforeEach(() => {
  queue = fs.mkdtempSync(path.join(os.tmpdir(), "carls3d-workflow-test-"));
  process.env.ORDER_WORKFLOW_DIR = queue;
  process.env.ORDER_NOTIFICATION_EMAIL = "owner@example.com";
  delete process.env.ORDER_FROM_EMAIL;
  delete process.env.ORDER_REPLY_TO_EMAIL;
  now = Date.now();
  nowSpy = jest.spyOn(Date, "now").mockImplementation(() => now);
  sendMock.mockReset();
  sendMock.mockImplementation(async (_order, target) => ({ id: `sent-${target}` }));
  (notifyOrder as jest.Mock).mockClear();
});

afterEach(() => {
  nowSpy.mockRestore();
  // Queue is a newly created test-only directory, never the configured production queue.
  fs.rmSync(queue, { recursive: true, force: true });
  process.env = { ...originalEnv };
});

test("enqueue persists immutable initial order and does not reset completed work", async () => {
  enqueueOrderWorkflow(order);
  await processOrderEmails(order.id!);
  await completePrintJob(order.id!, { state: "complete", output: "test/order.3mf" });
  enqueueOrderWorkflow({ ...order, name: "Changed name", email: "different@example.com" });
  const saved = readWorkflowJob(order.id!);
  expect(saved.order.email).toBe("customer@example.com");
  expect(saved.email.customer).toMatchObject({ state: "sent", id: "sent-customer", attempts: 1 });
  expect(saved.email.owner).toMatchObject({ state: "sent", id: "sent-owner", attempts: 1 });
  expect(saved.print).toEqual({ state: "complete", output: "test/order.3mf" });
  await processOrderEmails(order.id!);
  expect(sendMock).toHaveBeenCalledTimes(2);
  expect(fs.readdirSync(queue)).toEqual(["41.json"]);
});

test("retry preserves recipient payload and never repeats an acknowledged email", async () => {
  enqueueOrderWorkflow(order);
  sendMock.mockResolvedValueOnce({ id: "customer-done" });
  sendMock.mockRejectedValueOnce(new OrderEmailError("temporary provider failure", true, 503));
  await processOrderEmails(order.id!);
  expect(readWorkflowJob(order.id!).email.customer.state).toBe("sent");
  expect(readWorkflowJob(order.id!).email.owner.state).toBe("pending");
  const originalPayload = sendMock.mock.calls[1][2];
  process.env.ORDER_NOTIFICATION_EMAIL = "changed@example.com";
  await processPendingEmails();
  expect(sendMock).toHaveBeenCalledTimes(2);
  now += 61_000;
  await processPendingEmails();
  expect(sendMock).toHaveBeenCalledTimes(3);
  expect(sendMock.mock.calls[2][1]).toBe("owner");
  expect(sendMock.mock.calls[2][2]).toEqual(originalPayload);
  expect(sendMock.mock.calls[2][2]?.to).toEqual(["owner@example.com"]);
  expect(readWorkflowJob(order.id!).email.owner.state).toBe("sent");
});

test("payload and attempt are durable before network begins", async () => {
  enqueueOrderWorkflow(order);
  sendMock.mockImplementation(async (_order, target, payload) => {
    const saved = readWorkflowJob(order.id!).email[target];
    expect(saved.payload).toEqual(payload);
    expect(saved.firstAttempt).toBe(now);
    expect(saved.attempts).toBe(1);
    expect(saved.state).toBe("pending");
    return { id: target };
  });
  await processOrderEmails(order.id!);
});

test("permanent recipient failure is isolated from owner email and print preparation", async () => {
  enqueueOrderWorkflow(order);
  sendMock.mockRejectedValueOnce(new OrderEmailError("invalid recipient", false, 422));
  await processOrderEmails(order.id!);
  const saved = readWorkflowJob(order.id!);
  expect(saved.email.customer.state).toBe("review");
  expect(saved.email.owner.state).toBe("sent");
  expect(saved.print.state).toBe("pending");
  now += 60_000;
  await processPendingEmails();
  expect(sendMock).toHaveBeenCalledTimes(2);
});

test("ambiguous delivery pauses before Resend's 24-hour idempotency expiry", async () => {
  enqueueOrderWorkflow(order);
  updateJob(order.id!, job => {
    job.email.customer.firstAttempt = now - 23 * 3600_000 - 1;
    job.email.customer.attempts = 1;
  });
  await processOrderEmails(order.id!);
  expect(readWorkflowJob(order.id!).email.customer.state).toBe("review");
  expect(sendMock).toHaveBeenCalledTimes(1);
  expect(sendMock.mock.calls[0][1]).toBe("owner");
});

test("concurrent workers cannot duplicate sends and print acknowledgment retries without data loss", async () => {
  enqueueOrderWorkflow(order);
  let release!: () => void;
  let started!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { started = resolve; });
  sendMock.mockImplementationOnce(async () => { started(); await blocked; return { id: "customer-done" }; });
  const first = processOrderEmails(order.id!);
  await entered;
  await processOrderEmails(order.id!);
  await expect(completePrintJob(order.id!, { state: "complete", output: "package.3mf" })).rejects.toThrow("busy");
  expect(sendMock).toHaveBeenCalledTimes(1);
  release();
  await first;
  await completePrintJob(order.id!, { state: "complete", output: "package.3mf" });
  await completePrintJob(order.id!, { state: "review", error: "late failure" });
  const saved = readWorkflowJob(order.id!);
  expect(saved.email.customer.id).toBe("customer-done");
  expect(saved.email.owner.id).toBe("sent-owner");
  expect(saved.print).toEqual({ state: "complete", output: "package.3mf" });
});

test("an interrupted worker lock is recovered on a later pass", async () => {
  enqueueOrderWorkflow(order);
  const lock = path.join(queue, `${order.id}.json.lock`);
  fs.writeFileSync(lock, "");
  fs.utimesSync(lock, new Date(now - 11 * 60_000), new Date(now - 11 * 60_000));
  await processOrderEmails(order.id!);
  await processOrderEmails(order.id!);
  expect(readWorkflowJob(order.id!).email.customer.state).toBe("sent");
  expect(fs.existsSync(lock)).toBe(false);
});

test("corrupt queue entries cannot stop unrelated order processing", async () => {
  enqueueOrderWorkflow(order);
  fs.writeFileSync(path.join(queue, "1.json"), "{broken");
  fs.writeFileSync(path.join(queue, "2.json"), JSON.stringify({ version: 1 }));
  const errorLog = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    await processPendingEmails();
    expect(readWorkflowJob(order.id!).email.customer.state).toBe("sent");
    expect(listWorkflowJobs().some(job => job.order.id === order.id)).toBe(true);
  } finally { errorLog.mockRestore(); }
});

test("a single locked-out order does not block the rest of the retry batch", async () => {
  enqueueOrderWorkflow(order);
  enqueueOrderWorkflow({ ...order, id: 42, orderNumber: "SP-2026-000042-TEST" });
  const realOpen = fs.openSync;
  const openSpy = jest.spyOn(fs, "openSync").mockImplementation(((file: fs.PathLike, ...args: any[]) => {
    if (String(file) === path.join(queue, "41.json.lock")) {
      throw Object.assign(new Error("test filesystem denial"), { code: "EACCES" });
    }
    return (realOpen as any)(file, ...args);
  }) as typeof fs.openSync);
  const errorLog = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    await processPendingEmails();
    expect(readWorkflowJob(41).email.customer.state).toBe("pending");
    expect(readWorkflowJob(42).email.customer.state).toBe("sent");
  } finally {
    openSpy.mockRestore();
    errorLog.mockRestore();
  }
});

test("accepted orders retain the pending job during provider failure", async () => {
  sendMock.mockRejectedValue(new OrderEmailError("temporary outage", true));
  await expect(fulfillOrder(order)).resolves.toBeUndefined();
  expect(readWorkflowJob(order.id!).email.customer.state).toBe("pending");
  expect(readWorkflowJob(order.id!).email.owner.state).toBe("pending");
  expect(notifyOrder).toHaveBeenCalledWith(order);
});

test("order IDs and upload traversal are rejected before filesystem access", () => {
  expect(() => enqueueOrderWorkflow({ ...order, id: -1 })).toThrow("Invalid order ID");
  expect(() => readWorkflowJob(Number.NaN)).toThrow("Invalid order ID");
  enqueueOrderWorkflow(order);
  const job = readWorkflowJob(order.id!);
  job.order.items![0].filename = "../.env.local";
  expect(() => workflowSourceFile(job, 0)).toThrow("Invalid file");
  expect(() => workflowSourceFile(job, -1)).toThrow("Invalid file");
});
