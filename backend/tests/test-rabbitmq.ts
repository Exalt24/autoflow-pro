// LIFESPAN: permanent
// Runs the RabbitMQ consumer and publisher against a real broker: durable queues, manual ack, retry through the delay
// queues, dead-lettering, duplicate suppression, graceful stop and the Redis idempotency store.
//   docker run -d --name afp-rabbit -p 56720:5672 -p 56721:15672 rabbitmq:3-management
//   docker run -d --name afp-redis -p 56379:6379 redis:7-alpine
//   RABBITMQ_URL=amqp://guest:guest@localhost:56720 RABBITMQ_MGMT_URL=http://guest:guest@localhost:56721 REDIS_URL=redis://localhost:56379 npm run test:rabbitmq
// Without RABBITMQ_URL it skips, unless REQUIRE_RABBITMQ=1, which turns the skip into a failure (CI sets it).
import { randomUUID } from "node:crypto";
import amqp from "amqplib";
import { Redis } from "ioredis";
import { ReliableConsumer, type Handler, type Logger } from "../src/messaging/consumer.js";
import { ReliablePublisher } from "../src/messaging/publisher.js";
import { InMemoryIdempotencyStore, RedisIdempotencyStore, type IdempotencyStore } from "../src/messaging/idempotency.js";
import { topologyFor, delayQueueName } from "../src/messaging/topology.js";
import { PermanentError, type RetryPolicy } from "../src/messaging/retryPolicy.js";

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
async function waitFor(cond: () => boolean | Promise<boolean>, ms = 8000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return true;
    await sleep(25);
  }
  return false;
}
const quiet: Logger = { info() {}, warn() {}, error() {} };

const conn = await amqp.connect(url);
const admin = await conn.createChannel();
const created: string[] = [];

async function count(queue: string): Promise<number> {
  return (await admin.checkQueue(queue)).messageCount;
}
async function readDead(queue: string) {
  const t = topologyFor(queue);
  const got = await admin.get(t.deadQueue, { noAck: true });
  return got === false ? null : got;
}
async function cleanup(queue: string, delays: number[]) {
  const t = topologyFor(queue);
  for (const q of [t.queue, t.deadQueue, ...delays.map((d) => delayQueueName(t, d))]) await admin.deleteQueue(q);
  for (const e of [t.workExchange, t.retryExchange, t.deadExchange]) await admin.deleteExchange(e);
}

interface Rig {
  queue: string;
  policy: RetryPolicy;
  publisher: ReliablePublisher;
  start: (handler: Handler, store?: IdempotencyStore, extra?: { shutdownTimeoutMs?: number; prefetch?: number }) => Promise<ReliableConsumer>;
  done: () => Promise<void>;
}
async function rig(label: string, delaysMs: number[]): Promise<Rig> {
  const queue = `t-${label}-${randomUUID().slice(0, 8)}`;
  const policy = { delaysMs };
  const publisher = new ReliablePublisher(conn, queue, policy);
  await publisher.start();
  const consumers: ReliableConsumer[] = [];
  created.push(queue);
  return {
    queue,
    policy,
    publisher,
    async start(handler, store = new InMemoryIdempotencyStore(), extra = {}) {
      const c = new ReliableConsumer(conn, { queue, policy, store, handler, logger: quiet, ...extra });
      await c.start();
      consumers.push(c);
      return c;
    },
    async done() {
      for (const c of consumers) await c.stop();
      await publisher.close();
      await cleanup(queue, delaysMs);
    },
  };
}

// 1. The happy path, and what "durable" means on the wire.
{
  const r = await rig("happy", [100]);
  const seen: Array<{ payload: unknown; attempt: number; messageId: string }> = [];
  await r.start(async (payload, ctx) => {
    seen.push({ payload, ...ctx });
  });
  const id = await r.publisher.publish({ hello: "world" }, { messageId: "m-happy-1" });
  check("publish resolves with the message id after the broker confirm", id === "m-happy-1");
  check("the consumer receives the payload once with attempt 1", await waitFor(() => seen.length === 1) && seen[0].attempt === 1 && JSON.stringify(seen[0].payload) === '{"hello":"world"}');
  check("the message is acked: the queue ends up empty", await waitFor(async () => (await count(r.queue)) === 0));
  await r.done();
}

// 2. Broker side facts: durable queues, dead-letter arguments, TTL on the delay queue (needs the management API).
{
  const mgmt = process.env.RABBITMQ_MGMT_URL;
  if (mgmt) {
    const r = await rig("mgmt", [250, 1000]);
    const m = new URL(mgmt);
    const auth = "Basic " + Buffer.from(`${decodeURIComponent(m.username)}:${decodeURIComponent(m.password)}`).toString("base64");
    const t = topologyFor(r.queue);
    const info = async (name: string) => {
      for (let i = 0; i < 20; i++) {
        const res = await fetch(`${m.origin}/api/queues/%2F/${encodeURIComponent(name)}`, { headers: { authorization: auth } });
        if (res.ok) return (await res.json()) as any;
        await sleep(250);
      }
      return null;
    };
    const main = await info(t.queue);
    check("management API: the work queue is durable and not auto-delete", main?.durable === true && main?.auto_delete === false, JSON.stringify(main?.durable));
    check("management API: the work queue dead-letters to the dead exchange", main?.arguments?.["x-dead-letter-exchange"] === t.deadExchange);
    const d1 = await info(delayQueueName(t, 250));
    check("management API: the 250 ms delay queue is durable with TTL 250 and dead-letters back to the work exchange", d1?.durable === true && d1?.arguments?.["x-message-ttl"] === 250 && d1?.arguments?.["x-dead-letter-exchange"] === t.workExchange);
    const dead = await info(t.deadQueue);
    check("management API: the dead-letter queue is durable", dead?.durable === true);
    await r.done();
  } else {
    console.log("SKIP  management API checks (RABBITMQ_MGMT_URL not set)");
  }
}

// 3. Persistent delivery mode.
{
  const r = await rig("persist", [100]);
  await r.publisher.publish({ n: 1 }, { messageId: "m-persist" });
  const got = await admin.get(r.queue, { noAck: true });
  check("published messages are persistent (delivery mode 2) with the message id and JSON content type", got !== false && got.properties.deliveryMode === 2 && got.properties.messageId === "m-persist" && got.properties.contentType === "application/json");
  await r.done();
}

// 4. Transient failures retry through the delay queue, then succeed.
{
  const r = await rig("retry", [120, 180]);
  const attempts: number[] = [];
  const stamps: number[] = [];
  await r.start(async (_p, ctx) => {
    attempts.push(ctx.attempt);
    stamps.push(Date.now());
    if (ctx.attempt < 3) throw new Error("temporary");
  });
  await r.publisher.publish({ job: 1 }, { messageId: "m-retry" });
  check("a handler that fails twice is called 3 times with attempts 1, 2, 3", await waitFor(() => attempts.length === 3, 8000) && attempts.join() === "1,2,3", attempts.join());
  check("each retry waited at least its delay queue's TTL", stamps.length === 3 && stamps[1] - stamps[0] >= 110 && stamps[2] - stamps[1] >= 170, JSON.stringify(stamps.map((s) => s - stamps[0])));
  await sleep(300);
  check("after the success the work queue and the dead-letter queue are both empty", (await count(r.queue)) === 0 && (await count(topologyFor(r.queue).deadQueue)) === 0);
  await r.done();
}

// 5. Retries used up: the message ends in the dead-letter queue with the reason.
{
  const r = await rig("exhaust", [60, 60]);
  let calls = 0;
  await r.start(async () => {
    calls++;
    throw new Error("always broken");
  });
  await r.publisher.publish({ job: 2 }, { messageId: "m-exhaust" });
  check("a handler that always fails is tried 3 times (first try plus 2 retries)", await waitFor(async () => (await count(topologyFor(r.queue).deadQueue)) === 1, 8000) && calls === 3, `calls=${calls}`);
  const dead = await readDead(r.queue);
  check("the dead letter keeps the body and message id, and names retries-exhausted and the last error", dead !== null && dead.content.toString() === '{"job":2}' && dead.properties.messageId === "m-exhaust" && dead.properties.headers?.["x-dead-reason"] === "retries-exhausted" && String(dead.properties.headers?.["x-dead-error"]).includes("always broken"), JSON.stringify(dead?.properties.headers));
  check("the dead letter records the attempt count", dead?.properties.headers?.["x-attempt"] === 3);
  check("the work queue is empty after dead-lettering", (await count(r.queue)) === 0);
  await r.done();
}

// 6. A permanent error is not retried.
{
  const r = await rig("perm", [60, 60]);
  let calls = 0;
  await r.start(async () => {
    calls++;
    throw new PermanentError("bad input");
  });
  await r.publisher.publish({ job: 3 }, { messageId: "m-perm" });
  check("a PermanentError goes to the dead-letter queue after one call", await waitFor(async () => (await count(topologyFor(r.queue).deadQueue)) === 1) && calls === 1);
  const dead = await readDead(r.queue);
  check("its dead-letter reason is permanent-error", dead?.properties.headers?.["x-dead-reason"] === "permanent-error");
  await r.done();
}

// 7. Poison messages (not JSON, no message id) never reach the handler.
{
  const r = await rig("poison", [60]);
  let calls = 0;
  await r.start(async () => {
    calls++;
  });
  const t = topologyFor(r.queue);
  admin.publish(t.workExchange, t.routingKey, Buffer.from("{not json"), { messageId: "m-poison", persistent: true });
  admin.publish(t.workExchange, t.routingKey, Buffer.from('{"ok":true}'), { persistent: true });
  check("invalid JSON and a missing message id both land in the dead-letter queue", await waitFor(async () => (await count(t.deadQueue)) === 2));
  const reasons = [(await readDead(r.queue))?.properties.headers?.["x-dead-reason"], (await readDead(r.queue))?.properties.headers?.["x-dead-reason"]].sort();
  check("their reasons are invalid-json and missing-message-id", reasons.join() === "invalid-json,missing-message-id", reasons.join());
  check("the handler was never called for them", calls === 0);
  await r.done();
}

// 8. Duplicates: the same message id twice, and two competing consumers.
{
  const r = await rig("dupe", [60]);
  let calls = 0;
  const store = new InMemoryIdempotencyStore();
  const handler: Handler = async () => {
    calls++;
    await sleep(80);
  };
  await r.start(handler, store);
  await r.start(handler, store);
  await r.publisher.publish({ n: 1 }, { messageId: "m-dupe" });
  await r.publisher.publish({ n: 1 }, { messageId: "m-dupe" });
  await r.publisher.publish({ n: 1 }, { messageId: "m-dupe" });
  await r.publisher.publish({ n: 2 }, { messageId: "m-other" });
  check("four deliveries with 2 distinct message ids run the handler exactly twice", await waitFor(async () => (await count(r.queue)) === 0 && calls >= 2) && (await sleep(500), calls === 2), `calls=${calls}`);
  check("nothing is left in the work or dead-letter queue", (await count(r.queue)) === 0 && (await count(topologyFor(r.queue).deadQueue)) === 0);
  await r.done();
}

// 9. Manual ack: an unacked message comes back when its consumer's channel dies.
{
  const r = await rig("redeliver", [60]);
  await r.publisher.publish({ n: 1 }, { messageId: "m-redeliver" });
  const ch1 = await conn.createChannel();
  let first: amqp.ConsumeMessage | null = null;
  await ch1.consume(r.queue, (m) => (first = m), { noAck: false });
  await waitFor(() => first !== null);
  check("while a message is delivered but unacked it is not gone: it counts as unacked, not ready", (await count(r.queue)) === 0 && first !== null);
  await ch1.close();
  const ch2 = await conn.createChannel();
  let second: amqp.ConsumeMessage | null = null;
  await ch2.consume(r.queue, (m) => (second = m), { noAck: false });
  check("after the channel closes without an ack the broker redelivers it with the redelivered flag", await waitFor(() => second !== null) && (second as amqp.ConsumeMessage | null)?.fields.redelivered === true);
  if (second) ch2.ack(second);
  await ch2.close();
  await r.done();
}

// 10. Graceful stop: a running handler finishes and acks, and later messages stay queued.
{
  const r = await rig("stop", [60]);
  let started = false;
  let finished = false;
  const c = await r.start(async () => {
    started = true;
    await sleep(400);
    finished = true;
  });
  await r.publisher.publish({ n: 1 }, { messageId: "m-stop-1" });
  await waitFor(() => started);
  const stopping = c.stop();
  const t0 = Date.now();
  await stopping;
  check("stop() waits for the running handler (it finished before stop resolved)", finished && Date.now() - t0 >= 200, `finished=${finished} waited=${Date.now() - t0}`);
  check("the in-flight message was acked, not requeued or lost", (await count(r.queue)) === 0);
  await r.publisher.publish({ n: 2 }, { messageId: "m-stop-2" });
  await sleep(200);
  check("a message published after stop stays in the queue for the next consumer", (await count(r.queue)) === 1);
  check("stop() twice is harmless", (await c.stop(), true));
  await r.done();
}

// 11. Stop with a handler that never ends: the wait is bounded and the message is redelivered to the next consumer.
{
  const r = await rig("hang", [60]);
  let started = false;
  const c = await r.start(
    async () => {
      started = true;
      await sleep(5000);
    },
    new InMemoryIdempotencyStore(),
    { shutdownTimeoutMs: 300 },
  );
  await r.publisher.publish({ n: 1 }, { messageId: "m-hang" });
  await waitFor(() => started);
  const t0 = Date.now();
  await c.stop();
  const took = Date.now() - t0;
  check("stop() gives up after shutdownTimeoutMs instead of hanging", took >= 280 && took < 2500, `took ${took} ms`);
  check("the unfinished message is back on the queue", await waitFor(async () => (await count(r.queue)) === 1));
  await r.done();
}

// 12. Publisher: a message nothing is bound to is an error, not a silent drop.
{
  const r = await rig("unroutable", [60]);
  const t = topologyFor(r.queue);
  await admin.unbindQueue(t.queue, t.workExchange, t.routingKey);
  let err = "";
  try {
    await r.publisher.publish({ n: 1 }, { messageId: "m-lost" });
  } catch (e) {
    err = (e as Error).message;
  }
  check("publishing to an exchange with no bound queue rejects", err.includes("m-lost") && err.includes("no queue is bound"), err);
  await r.done();
}

// 13. The Redis store, against a real Redis.
if (process.env.REDIS_URL) {
  const redis = new Redis(process.env.REDIS_URL);
  const prefix = `test:${randomUUID().slice(0, 8)}:`;
  const s = new RedisIdempotencyStore(redis, prefix);
  check("redis store: first claim wins, second sees busy", (await s.claim("k1", 5000)) === "claimed" && (await s.claim("k1", 5000)) === "busy");
  await s.release("k1");
  check("redis store: after release the key can be claimed again", (await s.claim("k1", 5000)) === "claimed");
  await s.complete("k1", 5000);
  check("redis store: after complete the key reads done", (await s.claim("k1", 5000)) === "done");
  await s.release("k1");
  check("redis store: release never erases a done key", (await s.claim("k1", 5000)) === "done");
  check("redis store: a claim frees itself after its TTL", (await s.claim("k2", 100)) === "claimed" && (await sleep(180), await s.claim("k2", 100)) === "claimed");
  const racers = await Promise.all(Array.from({ length: 20 }, () => s.claim("k3", 5000)));
  check("redis store: 20 simultaneous claims give exactly one winner", racers.filter((x) => x === "claimed").length === 1 && racers.filter((x) => x === "busy").length === 19);

  // Whole path with the Redis store and two consumers, as the worker runs it.
  const r = await rig("redis", [60]);
  let calls = 0;
  const store = new RedisIdempotencyStore(redis, prefix);
  const handler: Handler = async () => {
    calls++;
    await sleep(60);
  };
  await r.start(handler, store);
  await r.start(handler, store);
  for (let i = 0; i < 5; i++) await r.publisher.publish({ i }, { messageId: "m-redis" });
  check("two consumers sharing the Redis store handle 5 copies of one message once", await waitFor(async () => (await count(r.queue)) === 0) && (await sleep(400), calls === 1), `calls=${calls}`);
  await r.done();
  const keys = await redis.keys(`${prefix}*`);
  if (keys.length) await redis.del(...keys);
  await redis.quit();
} else if (process.env.REQUIRE_RABBITMQ === "1") {
  check("REDIS_URL is set for the Redis store checks", false, "REQUIRE_RABBITMQ=1 needs REDIS_URL");
} else {
  console.log("SKIP  Redis store checks (REDIS_URL not set)");
}

await admin.close();
await conn.close();
console.log(failed === 0 ? `\nAll ${passed} RabbitMQ broker checks passed` : `\n${failed} of ${passed + failed} RabbitMQ broker check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
