// LIFESPAN: permanent
// The telemetry worker against a real RabbitMQ broker, through the reliable consumer in src/messaging: readings go in as
// messages, the lake folder is the durable store, and the ack comes only after the files are written. Crash cases:
// a process that dies after the write and before the ack, a failed write that is retried, the same readings in many
// messages at once, a bad message body, and replays.
//   docker run -d --name afp-tel-rabbit -p 56730:5672 rabbitmq:3-management
//   RABBITMQ_URL=amqp://guest:guest@localhost:56730 npm run test:telemetry-rabbitmq
// Without RABBITMQ_URL it skips, unless REQUIRE_RABBITMQ=1, which turns the skip into a failure (CI sets it).
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import amqp from "amqplib";
import { ReliableConsumer, type Handler, type Logger } from "../src/messaging/consumer.js";
import { ReliablePublisher } from "../src/messaging/publisher.js";
import { InMemoryIdempotencyStore } from "../src/messaging/idempotency.js";
import { topologyFor, delayQueueName } from "../src/messaging/topology.js";
import type { RetryPolicy } from "../src/messaging/retryPolicy.js";
import { FsLakeStore, MemoryLakeStore, readQuarantine, readReadings, type LakeStore } from "../src/telemetry/lake.js";
import { TelemetryPipeline } from "../src/telemetry/pipeline.js";
import { generateSolarDay } from "../src/telemetry/generator.js";
import { batchIdFor, createTelemetryHandler } from "../src/telemetry/worker.js";

const url = process.env.RABBITMQ_URL;
if (!url) {
  if (process.env.REQUIRE_RABBITMQ === "1") {
    console.error("FAIL  RABBITMQ_URL is not set and REQUIRE_RABBITMQ=1");
    process.exit(1);
  }
  console.log("SKIP  RABBITMQ_URL is not set, so no broker tests ran");
  process.exit(0);
}

let failed = 0;
let passed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `\n      ${detail}`}`);
  if (ok) passed++;
  else failed++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond: () => boolean | Promise<boolean>, ms = 15000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return true;
    await sleep(25);
  }
  return false;
}
const quiet: Logger = { info() {}, warn() {}, error() {} };

const MIN = 60_000;
const LATE = 15 * MIN;
const NOW = Date.UTC(2026, 10, 7);
const POPTS = { expectedIntervalMs: MIN, allowedLatenessMs: LATE, maxFutureMs: 5 * MIN, now: () => NOW };

const conn = await amqp.connect(url);
const admin = await conn.createChannel();
const dirs: string[] = [];

async function count(queue: string): Promise<number> {
  return (await admin.checkQueue(queue)).messageCount;
}
async function cleanup(queue: string, delays: number[]) {
  const t = topologyFor(queue);
  for (const q of [t.queue, t.deadQueue, ...delays.map((d) => delayQueueName(t, d))]) await admin.deleteQueue(q);
  for (const e of [t.workExchange, t.retryExchange, t.deadExchange]) await admin.deleteExchange(e);
}
function tmpLake(): { dir: string; lake: FsLakeStore } {
  const dir = mkdtempSync(join(tmpdir(), "telemetry-rmq-"));
  dirs.push(dir);
  return { dir, lake: new FsLakeStore(dir) };
}
function snapshot(dir: string): string {
  const h = createHash("sha256");
  const walk = (d: string, rel: string) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((x, y) => (x.name < y.name ? -1 : 1))) {
      if (e.isDirectory()) walk(join(d, e.name), `${rel}${e.name}/`);
      else {
        h.update(`${rel}${e.name}\n`);
        h.update(readFileSync(join(d, e.name)));
      }
    }
  };
  walk(dir, "");
  return h.digest("hex");
}
async function memoryEntries(m: MemoryLakeStore): Promise<string> {
  return JSON.stringify([...m.objects.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
}
async function fsEntries(lake: FsLakeStore): Promise<string> {
  const keys = await lake.list("telemetry/");
  return JSON.stringify(await Promise.all(keys.map(async (k) => [k, await lake.get(k)])));
}

async function rig(label: string, delaysMs: number[]) {
  const queue = `t-tel-${label}-${randomUUID().slice(0, 8)}`;
  const policy: RetryPolicy = { delaysMs };
  const publisher = new ReliablePublisher(conn, queue, policy);
  await publisher.start();
  const consumers: ReliableConsumer[] = [];
  return {
    queue,
    publisher,
    async start(handler: Handler, prefetch = 1, connection: { createConfirmChannel(): Promise<amqp.ConfirmChannel> } = conn) {
      const c = new ReliableConsumer(connection, { queue, policy, store: new InMemoryIdempotencyStore(), handler, logger: quiet, prefetch, shutdownTimeoutMs: 500 });
      await c.start();
      consumers.push(c);
      return c;
    },
    async done() {
      for (const c of consumers) await c.stop().catch(() => undefined);
      await publisher.close();
      await cleanup(queue, delaysMs);
    },
  };
}

// A solar day with the planted defects, cut into messages of 200 readings, plus what a direct, in-process run gives.
const day = generateSolarDay({ assetId: "pv-001", day: "2026-11-06", allowedLatenessMs: LATE, seed: 21 });
const messages: { id: string; body: { readings: unknown[] } }[] = [];
for (let i = 0; i < day.raw.length; i += 200) messages.push({ id: `tel-${i / 200}`, body: { readings: day.raw.slice(i, i + 200) } });
const reference = new MemoryLakeStore();
{
  const p = new TelemetryPipeline(reference, POPTS);
  for (const m of messages) await p.process(m.body.readings, batchIdFor(m.id));
}
const referenceEntries = await memoryEntries(reference);

// 1. Messages in, files out, same as a direct run.
{
  const r = await rig("happy", [100]);
  const { dir, lake } = tmpLake();
  const pipeline = (await TelemetryPipeline.open(lake, POPTS)).pipeline;
  let handled = 0;
  const inner = createTelemetryHandler(pipeline);
  await r.start(async (p, c) => {
    await inner(p, c);
    handled++;
  });
  for (const m of messages) await r.publisher.publish(m.body, { messageId: m.id });
  check(`${messages.length} messages of a generated solar day are all handled and the queue ends up empty`, (await waitFor(() => handled === messages.length)) && (await waitFor(async () => (await count(r.queue)) === 0)), `handled ${handled}`);
  check("the lake the worker wrote equals, file for file and byte for byte, the lake of a direct in-process run", (await fsEntries(lake)) === referenceEntries);
  const stored = await readReadings(lake);
  check("the readings in the lake are exactly the clean readings of the day", JSON.stringify(stored.sort((a, b) => a.ts - b.ts)) === JSON.stringify(day.clean));
  check("the bad readings were quarantined, not loaded, and the messages that held them were still acked", (await readQuarantine(lake)).length === 5 && (await count(topologyFor(r.queue).deadQueue)) === 0);

  // 2. the same readings again, as new messages and as the same messages
  const before = snapshot(dir);
  for (const m of messages) await r.publisher.publish(m.body, { messageId: `again-${m.id}` });
  for (const m of messages) await r.publisher.publish(m.body, { messageId: m.id });
  await waitFor(() => handled === messages.length * 2, 8000);
  await sleep(300);
  check("publishing every message again, under new ids and under the same ids, changes no file in the lake", snapshot(dir) === before && (await waitFor(async () => (await count(r.queue)) === 0)));
  check("the replays under new ids reached the handler and found everything stored; the replays under old ids were skipped by the consumer", handled === messages.length * 2);
  await r.done();
}

// 3. The process dies after the files are written and before the ack: the broker redelivers, nothing is counted twice.
{
  const r = await rig("crash", [100]);
  const { dir, lake } = tmpLake();
  const connA = await amqp.connect(url);
  const pipelineA = new TelemetryPipeline(lake, POPTS);
  const innerA = createTelemetryHandler(pipelineA);
  let written = false;
  await r.start(
    async (p, c) => {
      await innerA(p, c);
      written = true;
      await new Promise(() => undefined); // the process is gone before it can ack
    },
    1,
    connA,
  );
  const first = messages[0];
  await r.publisher.publish(first.body, { messageId: first.id });
  check("the message is handled and its files are in the lake", await waitFor(() => written));
  const afterWrite = snapshot(dir);
  const countAfterWrite = pipelineA.store.count();
  check("while the process holds the message unacked it is not on the queue", (await count(r.queue)) === 0);
  await connA.close();
  check("when the process dies without acking, the broker puts the message back on the queue", await waitFor(async () => (await count(r.queue)) === 1));

  const opened = await TelemetryPipeline.open(lake, POPTS);
  check("a new process opening the lake rebuilds exactly the readings that were written", opened.restored === countAfterWrite && opened.rollupFilesRepaired === 0);
  let results: unknown;
  const innerB = createTelemetryHandler(opened.pipeline);
  const seen: number[] = [];
  const countBefore = opened.pipeline.store.count();
  await r.start(async (p, c) => {
    await innerB(p, c);
    seen.push(opened.pipeline.store.count());
    results = c;
  });
  check("the redelivered message is handled by the new process and acked", (await waitFor(() => results !== undefined)) && (await waitFor(async () => (await count(r.queue)) === 0)));
  check("it found every reading already stored: the count did not move and no file changed", seen[0] === countBefore && snapshot(dir) === afterWrite);
  const lines = (await readReadings(lake)).length;
  check("each reading of the message is in the lake exactly once", lines === countAfterWrite && lines === new Set((await readReadings(lake)).map((x) => `${x.assetId}|${x.ts}`)).size);
  await r.done();
}

// 4. A failed write is retried through the delay queue; nothing was applied by the failed try, nothing is lost.
{
  const r = await rig("retry", [100]);
  const { lake } = tmpLake();
  let failures = 1;
  let countDuringFailure = -1;
  let pipeline!: TelemetryPipeline;
  const flaky: LakeStore = {
    async put(key, body) {
      if (failures > 0 && key.includes("/readings/")) {
        failures--;
        countDuringFailure = pipeline.store.count();
        throw new Error("disk full");
      }
      return lake.put(key, body);
    },
    get: (k) => lake.get(k),
    list: (p) => lake.list(p),
  };
  pipeline = new TelemetryPipeline(flaky, POPTS);
  const inner = createTelemetryHandler(pipeline);
  let calls = 0;
  let completed = 0;
  await r.start(async (p, c) => {
    calls++;
    await inner(p, c);
    completed++;
  });
  await r.publisher.publish(messages[0].body, { messageId: "tel-retry" });
  check("a message whose write fails is called again after the delay and then succeeds", await waitFor(async () => calls === 2 && completed === 1 && (await count(r.queue)) === 0));
  const direct = new TelemetryPipeline(new MemoryLakeStore(), POPTS);
  const want = await direct.process(messages[0].body.readings, "x");
  check("the failed try had applied nothing to memory", countDuringFailure === 0);
  check("after the retry the lake holds every accepted reading of the message once", (await readReadings(lake)).length === want.accepted && pipeline.store.count() === want.accepted);
  check("nothing went to the dead letter queue", (await count(topologyFor(r.queue).deadQueue)) === 0);
  await r.done();
}

// 5. Bad bodies and mixed bodies.
{
  const r = await rig("bodies", [60]);
  const { lake } = tmpLake();
  const pipeline = new TelemetryPipeline(lake, POPTS);
  await r.start(createTelemetryHandler(pipeline));
  await r.publisher.publish({ readings: "not a list" }, { messageId: "bad-shape" });
  await r.publisher.publish({ readings: [{ asset_id: "pv-9", ts: "2026-11-06T10:00:00Z", power_kw: 2 }, { asset_id: "pv-9", ts: "2026-13-06T10:00:00Z", power_kw: 2 }, { asset_id: "pv-9", ts: "2026-11-06T10:01:00Z", power_kw: -4 }] }, { messageId: "mixed" });
  check("a body with no readings array goes to the dead letter queue after one try", await waitFor(async () => (await count(topologyFor(r.queue).deadQueue)) === 1));
  const dead = await admin.get(topologyFor(r.queue).deadQueue, { noAck: true });
  check("its dead letter reason is permanent-error", dead !== false && dead.properties.headers?.["x-dead-reason"] === "permanent-error");
  check("a body with one good and two bad readings is acked: the good one is stored, the two bad ones are quarantined with their reasons", (await waitFor(async () => pipeline.store.count() === 1)) && (await waitFor(async () => (await readQuarantine(lake)).length === 2)) && (await readQuarantine(lake)).map((e) => e.reason).sort().join() === "invalid_timestamp,out_of_range" && (await count(r.queue)) === 0);
  await r.done();
}

// 6. The same readings in many messages at once: stored once.
{
  const r = await rig("race", [60]);
  const { lake } = tmpLake();
  // a lake that takes 15 ms per file, so several messages are in flight inside the pipeline at the same moment
  const slow: LakeStore = { put: async (k, b) => (await sleep(15), lake.put(k, b)), get: (k) => lake.get(k), list: (p) => lake.list(p) };
  const pipeline = new TelemetryPipeline(slow, POPTS);
  let handled = 0;
  const inner = createTelemetryHandler(pipeline);
  await r.start(async (p, c) => {
    await inner(p, c);
    handled++;
  }, 10);
  const body = messages[2].body;
  await Promise.all(Array.from({ length: 20 }, (_, i) => r.publisher.publish(body, { messageId: `race-${i}` })));
  check("20 messages carrying the same 200 readings are all handled while 10 are in flight", await waitFor(() => handled === 20));
  const direct = new TelemetryPipeline(new MemoryLakeStore(), POPTS);
  const want = await direct.process(body.readings, "x");
  const stored = await readReadings(lake);
  check("the lake holds each reading once, not twenty times", stored.length === want.accepted && new Set(stored.map((x) => `${x.assetId}|${x.ts}`)).size === want.accepted && pipeline.store.count() === want.accepted, `${stored.length} vs ${want.accepted}`);
  await r.done();
}

await admin.close();
await conn.close();
for (const d of dirs) rmSync(d, { recursive: true, force: true });
console.log(failed === 0 ? `\nAll ${passed} telemetry RabbitMQ checks passed` : `\n${failed} of ${passed + failed} telemetry RabbitMQ check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
