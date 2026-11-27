// Tests for the execution-summary Supabase Edge Function.
//
// Part A is pure logic (the same summarize.ts the function imports): fixed cases plus 300 seeded random worlds
// checked against a straight loop that shares no code with it.
// Part B needs a local Supabase stack with the edge runtime on (`npx supabase start`, see docs/LOCAL_SETUP.md) and
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_KEY in the environment. It signs up two users, gives each
// workflows and executions, and calls the deployed function with each user's own token.
// Part C is the deliberate break: the function's client is swapped for the service role for a moment, and the
// same leak check has to catch it, then the real file is put back. A check that cannot fail proves nothing.
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseDays,
  summarize,
  type ExecutionRow,
  type Summary,
} from "../../supabase/functions/execution-summary/summarize.ts";

const here = dirname(fileURLToPath(import.meta.url));
const functionsDir = join(here, "..", "..", "supabase", "functions");

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    passed += 1;
    console.log(`  ok    ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? `: ${detail}` : ""}`);
  }
}

// A small seeded random generator so a failing world can be replayed.
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Part A: logic ----------
console.log("Part A: summary logic");

check("days missing gives 7", JSON.stringify(parseDays(null)) === JSON.stringify({ ok: true, days: 7 }));
check("days 1 and 90 are accepted", parseDays("1").ok && parseDays("90").ok);
for (const bad of ["0", "91", "-3", "2.5", "abc", "1e2", " 5"]) {
  check(`days "${bad}" is refused`, !parseDays(bad).ok);
}

const now = new Date("2026-11-20T00:00:00Z");
const empty = summarize([], now, 7);
check("no rows gives an empty summary", empty.total === 0 && empty.workflows.length === 0);
check("since is exactly days before now", empty.since === "2026-11-13T00:00:00.000Z");

const fixed = summarize(
  [
    { workflow_id: "w1", status: "completed", started_at: "2026-11-19T00:00:00Z", duration: 1000 },
    { workflow_id: "w1", status: "failed", started_at: "2026-11-19T00:00:00Z", duration: 3000 },
    { workflow_id: "w1", status: "running", started_at: "2026-11-19T00:00:00Z", duration: null },
    { workflow_id: "w2", status: "queued", started_at: "2026-11-19T00:00:00Z", duration: null },
  ],
  now,
  7,
);
const w1 = fixed.workflows.find((w) => w.workflow_id === "w1");
const w2 = fixed.workflows.find((w) => w.workflow_id === "w2");
check("w1 counts", w1?.total === 3 && w1.completed === 1 && w1.failed === 1 && w1.in_flight === 1);
check("w1 success rate ignores unfinished runs", w1?.success_rate === 0.5);
check("w1 average duration uses finished runs only", w1?.avg_duration_ms === 2000);
check("w2 has no finished run so rate and duration are null", w2?.success_rate === null && w2?.avg_duration_ms === null);
check("the busiest workflow is first", fixed.workflows[0].workflow_id === "w1");

function oracle(rows: ExecutionRow[]): Map<string, [number, number, number, number, number]> {
  // workflow -> [total, completed, failed, durationSum, durationCount]
  const m = new Map<string, [number, number, number, number, number]>();
  for (const r of rows) {
    const e = m.get(r.workflow_id) ?? [0, 0, 0, 0, 0];
    e[0] += 1;
    if (r.status === "completed") e[1] += 1;
    if (r.status === "failed") e[2] += 1;
    if ((r.status === "completed" || r.status === "failed") && r.duration !== null) {
      e[3] += r.duration;
      e[4] += 1;
    }
    m.set(r.workflow_id, e);
  }
  return m;
}

let worldsOk = 0;
const statuses: ExecutionRow["status"][] = ["queued", "running", "completed", "failed"];
for (let seed = 1; seed <= 300; seed++) {
  const r = rng(seed);
  const rows: ExecutionRow[] = [];
  const n = Math.floor(r() * 60);
  for (let i = 0; i < n; i++) {
    const status = statuses[Math.floor(r() * 4)];
    rows.push({
      workflow_id: `w${Math.floor(r() * 5)}`,
      status,
      started_at: "2026-11-19T00:00:00Z",
      duration: r() < 0.2 ? null : Math.floor(r() * 10000),
    });
  }
  const got = summarize(rows, now, 7);
  const want = oracle(rows);
  let ok = got.total === rows.length && got.workflows.length === want.size;
  let sum = 0;
  for (const w of got.workflows) {
    const e = want.get(w.workflow_id);
    sum += w.total;
    if (!e) {
      ok = false;
      continue;
    }
    const finished = e[1] + e[2];
    ok = ok && w.total === e[0] && w.completed === e[1] && w.failed === e[2] && w.in_flight === e[0] - finished;
    ok = ok && w.success_rate === (finished === 0 ? null : Math.round((e[1] / finished) * 1000) / 1000);
    ok = ok && w.avg_duration_ms === (e[4] === 0 ? null : Math.round(e[3] / e[4]));
  }
  ok = ok && sum === rows.length;
  if (ok) worldsOk += 1;
  else console.log(`    world ${seed} disagrees with the oracle`);
}
check("300 seeded random worlds agree with the oracle", worldsOk === 300, `${worldsOk} of 300`);

// ---------- Part B and C: the real function ----------
const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_KEY;

async function call(fn: string, token: string | null, query = ""): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { apikey: ANON as string };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${URL}/functions/v1/${fn}${query}`, { headers });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

function workflowIds(s: Summary): string[] {
  return (s.workflows ?? []).map((w) => w.workflow_id).sort();
}

async function main(): Promise<void> {
  if (!URL || !ANON || !SERVICE) {
    console.log("\nPart B and C skipped: SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_KEY are not set.");
    finish();
    return;
  }
  if (readFileSync(join(functionsDir, "execution-summary", "index.ts"), "utf8").includes("SUPABASE_SERVICE_ROLE_KEY")) {
    throw new Error("execution-summary/index.ts uses the service role key: a broken copy from an earlier run was left in place, restore it with git checkout");
  }
  console.log("\nPart B: the function against a local Supabase stack, two users");

  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
  const stamp = Date.now();
  const password = "Edge-test-Passw0rd!";
  const users: { id: string; token: string; email: string }[] = [];
  for (const tag of ["a", "b"]) {
    const email = `edge-${tag}-${stamp}@autoflow.local`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw new Error(`could not create user ${tag}: ${created.error?.message}`);
    const anonClient = createClient(URL, ANON, { auth: { persistSession: false } });
    const signed = await anonClient.auth.signInWithPassword({ email, password });
    if (signed.error || !signed.data.session) throw new Error(`could not sign in user ${tag}: ${signed.error?.message}`);
    users.push({ id: created.data.user.id, token: signed.data.session.access_token, email });
  }
  const [A, B] = users;

  try {
    // Each user gets two workflows. A has completed, failed and running runs, plus one run older than the window.
    const mk = async (u: typeof A, name: string): Promise<string> => {
      const { data, error } = await admin.from("workflows").insert({ user_id: u.id, name, definition: {} }).select("id").single();
      if (error || !data) throw new Error(`workflow insert failed: ${error?.message}`);
      return data.id as string;
    };
    const wA1 = await mk(A, "A one");
    const wA2 = await mk(A, "A two");
    const wB1 = await mk(B, "B one");
    const wB2 = await mk(B, "B two");
    const day = 24 * 60 * 60 * 1000;
    const at = (daysAgo: number): string => new Date(Date.now() - daysAgo * day).toISOString();
    const ex = (u: typeof A, w: string, status: string, daysAgo: number, duration: number | null) => ({
      user_id: u.id,
      workflow_id: w,
      status,
      started_at: at(daysAgo),
      duration,
    });
    const rows = [
      ex(A, wA1, "completed", 1, 1000),
      ex(A, wA1, "completed", 2, 3000),
      ex(A, wA1, "failed", 2, 2000),
      ex(A, wA2, "running", 1, null),
      ex(A, wA2, "completed", 30, 500), // outside the 7 day window, inside 90
      ex(B, wB1, "failed", 1, 4000),
      ex(B, wB1, "failed", 1, 6000),
      ex(B, wB2, "completed", 3, 100),
      ex(B, wB2, "completed", 3, 300),
      ex(B, wB2, "completed", 4, 500),
    ];
    const ins = await admin.from("executions").insert(rows);
    if (ins.error) throw new Error(`execution insert failed: ${ins.error.message}`);

    const none = await call("execution-summary", null);
    check("no token gives 401", none.status === 401, `status ${none.status}`);
    const anonOnly = await call("execution-summary", ANON as string);
    check("the anon key as a token gives 401 (it is not a user)", anonOnly.status === 401, `status ${anonOnly.status}`);
    const junk = await call("execution-summary", "not-a-jwt");
    check("a junk token gives 401", junk.status === 401, `status ${junk.status}`);
    for (const q of ["?days=0", "?days=91", "?days=abc"]) {
      const r = await call("execution-summary", A.token, q);
      check(`${q} gives 400`, r.status === 400, `status ${r.status}`);
    }

    const a7 = await call("execution-summary", A.token);
    check("A gets 200", a7.status === 200, `status ${a7.status}`);
    check("a small account is not marked truncated", a7.body.truncated === false);
    check("A sees exactly A's workflows", JSON.stringify(workflowIds(a7.body)) === JSON.stringify([wA1, wA2].sort()));
    check("A total is 4 inside 7 days (the 30 day old run is out)", a7.body.total === 4, `got ${a7.body.total}`);
    const a1 = a7.body.workflows.find((w: any) => w.workflow_id === wA1);
    check("A workflow one: 3 runs, 2 completed, 1 failed", a1?.total === 3 && a1.completed === 2 && a1.failed === 1);
    check("A workflow one: success rate 0.667 and mean duration 2000", a1?.success_rate === 0.667 && a1?.avg_duration_ms === 2000);

    const a90 = await call("execution-summary", A.token, "?days=90");
    check("A sees the 30 day old run with days=90", a90.body.total === 5, `got ${a90.body.total}`);

    const b7 = await call("execution-summary", B.token);
    check("B sees exactly B's workflows", JSON.stringify(workflowIds(b7.body)) === JSON.stringify([wB1, wB2].sort()));
    check("B total is 5", b7.body.total === 5, `got ${b7.body.total}`);
    const leakA = workflowIds(a7.body).some((id) => id === wB1 || id === wB2);
    const leakB = workflowIds(b7.body).some((id) => id === wA1 || id === wA2);
    check("nothing crosses between A and B in either direction", !leakA && !leakB);

    // ---------- Part C: the deliberate break ----------
    console.log("\nPart C: the function with the service role client swapped in must leak, and the check must catch it");
    // The runtime lists its functions when it starts, so a new folder is not served; an edit to an existing function
    // is hot reloaded. So the real file is rewritten for the break and always put back byte for byte afterwards.
    const file = join(functionsDir, "execution-summary", "index.ts");
    const original = readFileSync(file, "utf8");
    const mutated = original
      .replace('Deno.env.get("SUPABASE_ANON_KEY")', 'Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")')
      .replace("global: { headers: { Authorization: auth } },", "");
    check("the mutant differs from the real function", mutated !== original && !mutated.includes("global: { headers"));
    writeFileSync(file, mutated);
    try {
      let leaked = false;
      let reached = false;
      // Hot reload takes a moment: keep asking until the answer shows the swapped client (leaked) or time runs out.
      for (let i = 0; i < 40 && !leaked; i++) {
        const m = await call("execution-summary", A.token);
        if (m.status === 200 && m.body && Array.isArray(m.body.workflows)) {
          reached = true;
          leaked = workflowIds(m.body).some((id) => id === wB1 || id === wB2);
        }
        if (!leaked) await new Promise((r) => setTimeout(r, 500));
      }
      check("the mutant answered", reached);
      check("the leak check catches the mutant (A sees B's workflows)", leaked);
    } finally {
      writeFileSync(file, original);
      check("the real function is back in place", readFileSync(file, "utf8") === original);
    }
    // And after the restore the real function is clean again (the runtime reloads it).
    let clean = false;
    for (let i = 0; i < 40 && !clean; i++) {
      const r = await call("execution-summary", A.token);
      if (r.status === 200 && Array.isArray(r.body?.workflows)) {
        const ids = workflowIds(r.body);
        clean = !ids.includes(wB1) && !ids.includes(wB2);
      }
      if (!clean) await new Promise((r) => setTimeout(r, 500));
    }
    check("after the restore A sees only A's workflows again", clean);
  } finally {
    for (const u of users) await admin.auth.admin.deleteUser(u.id);
  }
  finish();
}

function finish(): void {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("test run failed:", e);
  process.exit(1);
});
