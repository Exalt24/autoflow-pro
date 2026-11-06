// LIFESPAN: permanent
// RabbitMQ consumer logic that needs no broker: retry and dead-letter decisions, header parsing, config parsing,
// topology names, the idempotency store, and the run request check. The broker itself is exercised by test-rabbitmq.ts.
// Run: npm run test:rabbitmq-logic
import {
  PermanentError,
  decideOnFailure,
  maxAttempts,
  parseEnvelope,
  readAttempt,
  uniqueDelays,
  type RetryPolicy,
} from "../src/messaging/retryPolicy.js";
import { loadRabbitConfig, parseDelays, redactUrl } from "../src/messaging/config.js";
import { delayQueueName, topologyFor } from "../src/messaging/topology.js";
import { InMemoryIdempotencyStore, type ClaimResult, type IdempotencyStore } from "../src/messaging/idempotency.js";
import { validateRunRequest } from "../src/messaging/runRequest.js";

let failed = 0;
let passed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `\n      ${detail}`}`);
  if (ok) passed++;
  else failed++;
};
const throws = (fn: () => unknown, match: RegExp) => {
  try {
    fn();
    return false;
  } catch (e) {
    return match.test(String((e as Error).message));
  }
};

// Seeded generator so a failure can be replayed.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- retry decisions ----
const policy: RetryPolicy = { delaysMs: [100, 200, 300] };
check("a transient failure on attempt 1 retries after the first delay", JSON.stringify(decideOnFailure(1, new Error("x"), policy)) === JSON.stringify({ action: "retry", delayMs: 100, nextAttempt: 2 }));
check("attempt 2 uses the second delay", (decideOnFailure(2, new Error("x"), policy) as any).delayMs === 200);
check("attempt 3 uses the third delay", (decideOnFailure(3, new Error("x"), policy) as any).delayMs === 300);
check("attempt 4 (the last allowed) is dead-lettered as retries-exhausted", JSON.stringify(decideOnFailure(4, new Error("x"), policy)) === JSON.stringify({ action: "dead", reason: "retries-exhausted" }));
check("a permanent error is dead-lettered on attempt 1", JSON.stringify(decideOnFailure(1, new PermanentError("bad"), policy)) === JSON.stringify({ action: "dead", reason: "permanent-error" }));
check("a non-Error throw is treated as transient", decideOnFailure(1, "oops", policy).action === "retry");
check("an empty delay list means one try and then dead", decideOnFailure(1, new Error("x"), { delaysMs: [] }).action === "dead");
check("maxAttempts is the delay count plus one", maxAttempts(policy) === 4);
check("uniqueDelays sorts and removes duplicates", JSON.stringify(uniqueDelays({ delaysMs: [300, 100, 300, 100] })) === "[100,300]");

// Property: over many seeded worlds, a message is tried at most maxAttempts times, every retry waits the delay
// for its attempt, a permanent error stops at once, and every run ends in success or exactly one dead letter.
function simulate(decide: typeof decideOnFailure, seed: number): string | null {
  const r = rng(seed);
  const delays = Array.from({ length: Math.floor(r() * 6) }, () => 1 + Math.floor(r() * 5000));
  const p: RetryPolicy = { delaysMs: delays };
  const failureRate = r();
  const permanentRate = r() * 0.3;
  let attempt = 1;
  let tries = 0;
  for (;;) {
    tries++;
    if (tries > 50) return `seed ${seed}: never ended`;
    if (r() >= failureRate) return tries <= maxAttempts(p) ? null : `seed ${seed}: succeeded after more than maxAttempts tries`;
    const permanent = r() < permanentRate;
    const d = decide(attempt, permanent ? new PermanentError("p") : new Error("t"), p);
    if (d.action === "dead") {
      if (permanent && d.reason !== "permanent-error") return `seed ${seed}: permanent error got reason ${d.reason}`;
      if (!permanent && attempt <= delays.length) return `seed ${seed}: dead-lettered at attempt ${attempt} with ${delays.length} delays`;
      if (tries > maxAttempts(p)) return `seed ${seed}: tried ${tries} times, max ${maxAttempts(p)}`;
      return null;
    }
    if (permanent) return `seed ${seed}: permanent error was retried`;
    if (d.delayMs !== delays[attempt - 1]) return `seed ${seed}: attempt ${attempt} waited ${d.delayMs}, expected ${delays[attempt - 1]}`;
    if (d.nextAttempt !== attempt + 1) return `seed ${seed}: next attempt ${d.nextAttempt} after ${attempt}`;
    attempt = d.nextAttempt;
  }
}
function runProperty(decide: typeof decideOnFailure) {
  for (let seed = 1; seed <= 2000; seed++) {
    const problem = simulate(decide, seed);
    if (problem) return problem;
  }
  return null;
}
const propResult = runProperty(decideOnFailure);
check("2000 seeded retry runs obey the attempt, delay and dead-letter rules", propResult === null, propResult ?? "");

// Mutation controls: broken versions of the decision must turn the property red.
const offByOne: typeof decideOnFailure = (a, e, p) => decideOnFailure(a - 1 || 1, e, p);
const retriesPermanent: typeof decideOnFailure = (a, _e, p) => decideOnFailure(a, new Error("t"), p);
const neverDies: typeof decideOnFailure = (a, e, p) => {
  const d = decideOnFailure(a, e, p);
  return d.action === "dead" && d.reason === "retries-exhausted" ? { action: "retry", delayMs: 1, nextAttempt: a + 1 } : d;
};
check("control: an off-by-one in the attempt index is caught", runProperty(offByOne) !== null);
check("control: retrying a permanent error is caught", runProperty(retriesPermanent) !== null);
check("control: never dead-lettering is caught", runProperty(neverDies) !== null);

// ---- headers and bodies ----
check("readAttempt defaults to 1 when the header is missing", readAttempt(undefined) === 1 && readAttempt({}) === 1);
check("readAttempt reads a number", readAttempt({ "x-attempt": 3 }) === 3);
check("readAttempt reads a numeric string", readAttempt({ "x-attempt": "2" }) === 2);
check("readAttempt ignores zero, negative, fractional, NaN, huge and non-numeric values", [0, -1, 1.5, NaN, 99999, "abc", null, {}].every((v) => readAttempt({ "x-attempt": v }) === 1));
check("parseEnvelope accepts JSON", JSON.stringify(parseEnvelope(Buffer.from('{"a":1}'))) === '{"ok":true,"payload":{"a":1}}');
check("parseEnvelope rejects invalid JSON", JSON.stringify(parseEnvelope(Buffer.from("{nope"))) === '{"ok":false,"reason":"invalid-json"}');
check("parseEnvelope rejects an empty body", JSON.stringify(parseEnvelope(Buffer.alloc(0))) === '{"ok":false,"reason":"empty-body"}');

// ---- config ----
const base = { RABBITMQ_URL: "amqp://user:pw@rabbit:5672", REDIS_URL: "redis://redis:6379" };
const cfg = loadRabbitConfig(base);
check("config defaults: queue, prefetch, delays, ports", cfg.queue === "autoflow.workflow.execute" && cfg.prefetch === 5 && JSON.stringify(cfg.policy.delaysMs) === "[5000,30000,120000]" && cfg.healthPort === 8081 && cfg.shutdownTimeoutMs === 25000);
check("config reads overrides", loadRabbitConfig({ ...base, RABBITMQ_QUEUE: "q.one", RABBITMQ_PREFETCH: "20", RABBITMQ_RETRY_DELAYS_MS: "10, 20", HEALTH_PORT: "9000" }).policy.delaysMs.join() === "10,20");
check("config needs RABBITMQ_URL", throws(() => loadRabbitConfig({ REDIS_URL: "redis://x" }), /RABBITMQ_URL/));
check("config needs REDIS_URL", throws(() => loadRabbitConfig({ RABBITMQ_URL: "amqp://x" }), /REDIS_URL/));
check("config rejects a non-amqp URL", throws(() => loadRabbitConfig({ ...base, RABBITMQ_URL: "http://x" }), /amqp/));
check("config rejects a prefetch of 0", throws(() => loadRabbitConfig({ ...base, RABBITMQ_PREFETCH: "0" }), /RABBITMQ_PREFETCH/));
check("config rejects a queue name with a space or slash", throws(() => loadRabbitConfig({ ...base, RABBITMQ_QUEUE: "a b" }), /RABBITMQ_QUEUE/) && throws(() => loadRabbitConfig({ ...base, RABBITMQ_QUEUE: "a/b" }), /RABBITMQ_QUEUE/));
check("parseDelays rejects zero, decimals and words", [["0"], ["1.5"], ["abc"], [""]].every(([v]) => throws(() => parseDelays(v), /RABBITMQ_RETRY_DELAYS_MS/)));
check("parseDelays rejects more than 10 entries", throws(() => parseDelays("1,2,3,4,5,6,7,8,9,10,11"), /1 to 10/));
check("redactUrl removes the user and password", !redactUrl("amqp://user:secretpw@rabbit:5672/vhost").includes("secretpw") && !redactUrl("amqp://user:secretpw@rabbit:5672").includes("user"));
check("redactUrl does not echo a bad URL", redactUrl("not a url with secretpw") === "(unparseable url)");

// ---- topology names ----
const t = topologyFor("autoflow.workflow.execute");
check("topology names are derived from the queue name", t.workExchange === "autoflow.workflow.execute.work" && t.retryExchange === "autoflow.workflow.execute.retry" && t.deadQueue === "autoflow.workflow.execute.dead" && t.routingKey === t.queue);
check("each delay gets its own queue name", delayQueueName(t, 5000) !== delayQueueName(t, 30000) && delayQueueName(t, 5000).endsWith(".retry.5000ms"));

// ---- idempotency store: seeded property against a reference model, with injected clock ----
function checkStore(make: (now: () => number) => IdempotencyStore): Promise<string | null> {
  return (async () => {
    for (let seed = 1; seed <= 300; seed++) {
      const r = rng(seed * 7919);
      let clock = 1000;
      const store = make(() => clock);
      // Reference: for each key the time until which it is locked / done.
      const lockUntil = new Map<string, number>();
      const doneUntil = new Map<string, number>();
      const keys = ["a", "b", "c"]; // few keys so operations collide
      for (let step = 0; step < 60; step++) {
        const key = keys[Math.floor(r() * keys.length)];
        const op = r();
        if (op < 0.25) clock += Math.floor(r() * 400); // time passes, claims expire
        else if (op < 0.65) {
          const ttl = 1 + Math.floor(r() * 300);
          const got: ClaimResult = await store.claim(key, ttl);
          const expected: ClaimResult = (doneUntil.get(key) ?? 0) > clock ? "done" : (lockUntil.get(key) ?? 0) > clock ? "busy" : "claimed";
          if (got !== expected) return `seed ${seed} step ${step}: claim(${key}) gave ${got}, expected ${expected}`;
          if (got === "claimed") lockUntil.set(key, clock + ttl);
        } else if (op < 0.82) {
          const ttl = 1 + Math.floor(r() * 500);
          await store.complete(key, ttl);
          doneUntil.set(key, clock + ttl);
          lockUntil.delete(key);
        } else {
          await store.release(key);
          // Release only gives back a live lock; it must never erase a "done".
          if ((doneUntil.get(key) ?? 0) <= clock) lockUntil.delete(key);
          else {
            // done stays
          }
        }
      }
    }
    return null;
  })();
}
const storeResult = await checkStore((now) => new InMemoryIdempotencyStore(now));
check("300 seeded store runs match the reference model (claim, busy, done, expiry, release)", storeResult === null, storeResult ?? "");

class ReleaseWipesDone extends InMemoryIdempotencyStore {
  override async release(key: string) {
    await super.complete(key, 0); // forgets that the message was handled
  }
}
class IgnoresExpiry implements IdempotencyStore {
  private held = new Set<string>();
  async claim(key: string): Promise<ClaimResult> {
    if (this.held.has(key)) return "busy";
    this.held.add(key);
    return "claimed";
  }
  async complete() {}
  async release(key: string) {
    this.held.delete(key);
  }
}
check("control: a store whose release forgets a finished message is caught", (await checkStore((now) => new ReleaseWipesDone(now))) !== null);
check("control: a store that ignores expiry and never records done is caught", (await checkStore(() => new IgnoresExpiry())) !== null);

// ---- run request check ----
const good = { workflowId: "wf_1", executionId: "ex-1", userId: "u1", definition: { nodes: [] } };
check("a good run request passes", validateRunRequest(good).executionId === "ex-1");
const bad = (p: unknown) => throws(() => validateRunRequest(p), /.+/);
check("a run request that is null, an array or a string is rejected", bad(null) && bad([]) && bad("x"));
check("a run request with a missing or odd id is rejected", bad({ ...good, workflowId: undefined }) && bad({ ...good, executionId: "a b" }) && bad({ ...good, userId: "x".repeat(200) }) && bad({ ...good, executionId: 5 }));
check("a run request with no definition object is rejected", bad({ ...good, definition: null }) && bad({ ...good, definition: "x" }));
check("a bad run request throws a PermanentError, so it is never retried", (() => {
  try {
    validateRunRequest({});
    return false;
  } catch (e) {
    return e instanceof PermanentError;
  }
})());

console.log(failed === 0 ? `\nAll ${passed} RabbitMQ logic checks passed` : `\n${failed} of ${passed + failed} RabbitMQ logic check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
