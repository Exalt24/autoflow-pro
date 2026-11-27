// Tests for the personal data (GDPR) handling: the export-my-data and delete-my-account Edge Functions and the
// purge_old_execution_logs retention function (migration 002).
//
// Everything runs against a local Supabase stack with the edge runtime on (`npx supabase start`, see docs/LOCAL_SETUP.md),
// migrations 001 and 002 applied, and SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_KEY in the environment.
// The "search every table" checks go through `docker exec ... psql` into the database container
// (SUPABASE_DB_CONTAINER, default supabase_db_autoflow-pro).
//
// Part A  export: user A's document holds all of A's rows and none of B's, and the other way round.
// Part B  the deliberate break: the export function's client is swapped for the service role for a moment, the same
//         leak check has to catch it, then the real file is put back byte for byte.
// Part C  retention: rows are back dated, the purge removes the old ones and keeps the newer ones, and callers
//         without the service role cannot run it.
// Part D  erasure: nobody can erase another account, and after A is erased no row in any table carries A's id or email.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const exportFile = join(here, "..", "..", "supabase", "functions", "export-my-data", "index.ts");

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_KEY;
const DB_CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_autoflow-pro";

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sorted = (xs: string[]) => [...xs].sort();
const same = (a: string[], b: string[]) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

async function call(
  fn: string,
  token: string | null,
  opts: { method?: string; body?: unknown; query?: string } = {},
): Promise<{ status: number; body: any; headers: Headers }> {
  const headers: Record<string, string> = { apikey: ANON as string };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${URL}/functions/v1/${fn}${opts.query ?? ""}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body, headers: res.headers };
}

function psql(sql: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-At", "-F", "|", "-v", "ON_ERROR_STOP=1", "-c", sql],
    { encoding: "utf8" },
  ).trim();
}

// Every base table in every schema except the Postgres catalogs: which rows, rendered as text, contain the needle.
// Returns "schema.table:count" entries, empty when nothing anywhere carries it.
function findEverywhere(needle: string): string[] {
  if (!/^[A-Za-z0-9@._+-]+$/.test(needle)) throw new Error(`unsafe search needle: ${needle}`);
  const out = psql(
    `SELECT t || ':' || n FROM (
       SELECT table_schema || '.' || table_name AS t,
              (xpath('/row/c/text()', query_to_xml(
                format('select count(*) as c from %I.%I x where x::text ilike %L', table_schema, table_name, '%${needle}%'),
                false, true, '')))[1]::text::int AS n
       FROM information_schema.tables
       WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('pg_catalog', 'information_schema')
     ) s WHERE n > 0 ORDER BY t`,
  );
  return out === "" ? [] : out.split("\n");
}

const PNG = Uint8Array.from(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"),
);

type Person = {
  tag: string;
  id: string;
  email: string;
  token: string;
  workflows: string[];
  executions: string[];
  logs: string[];
  jobs: string[];
  files: string[];
};

async function main(): Promise<void> {
  if (!URL || !ANON || !SERVICE) {
    console.log("Skipped: SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_KEY are not set.");
    console.log("\n0 passed, 0 failed");
    return;
  }
  if (readFileSync(exportFile, "utf8").includes("SUPABASE_SERVICE_ROLE_KEY")) {
    throw new Error("export-my-data/index.ts uses the service role key: a broken copy from an earlier run was left in place, restore it with git checkout");
  }

  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
  const stamp = Date.now();
  const password = "Gdpr-test-Passw0rd!";
  const day = 24 * 60 * 60 * 1000;
  const at = (daysAgo: number): string => new Date(Date.now() - daysAgo * day).toISOString();
  const created: string[] = [];

  const mkUser = async (tag: string): Promise<{ id: string; email: string; token: string }> => {
    const email = `gdpr-${tag}-${stamp}@autoflow.local`;
    const made = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (made.error || !made.data.user) throw new Error(`could not create user ${tag}: ${made.error?.message}`);
    created.push(made.data.user.id);
    const anonClient = createClient(URL, ANON, { auth: { persistSession: false } });
    const signed = await anonClient.auth.signInWithPassword({ email, password });
    if (signed.error || !signed.data.session) throw new Error(`could not sign in user ${tag}: ${signed.error?.message}`);
    return { id: made.data.user.id, email, token: signed.data.session.access_token };
  };

  const ok = <T>(r: { data: T | null; error: { message: string } | null }, what: string): T => {
    if (r.error || r.data === null) throw new Error(`${what} failed: ${r.error?.message}`);
    return r.data;
  };

  // A person gets workflows, executions with personal looking content, log lines, a scheduled job, a quota row
  // and two stored files (one in a sub folder).
  const seed = async (tag: string, wfCount: number, runsPerWf: number): Promise<Person> => {
    const u = await mkUser(tag);
    const p: Person = { tag, ...u, workflows: [], executions: [], logs: [], jobs: [], files: [] };
    for (let w = 0; w < wfCount; w++) {
      const wf = ok(
        await admin.from("workflows").insert({ user_id: p.id, name: `${tag} workflow ${w}`, definition: { owner: tag } }).select("id").single(),
        "workflow insert",
      );
      p.workflows.push(wf.id);
      for (let r = 0; r < runsPerWf; r++) {
        const ex = ok(
          await admin
            .from("executions")
            .insert({
              user_id: p.id,
              workflow_id: wf.id,
              status: "completed",
              started_at: at(1 + r),
              duration: 1000,
              extracted_data: { scraped: `${tag}-secret-${w}-${r}` },
            })
            .select("id")
            .single(),
          "execution insert",
        );
        p.executions.push(ex.id);
        const lg = ok(
          await admin.from("execution_logs").insert({ execution_id: ex.id, level: "info", message: `${tag} step ${w}-${r}` }).select("id").single(),
          "log insert",
        );
        p.logs.push(lg.id);
      }
      const job = ok(
        await admin
          .from("scheduled_jobs")
          .insert({ workflow_id: wf.id, user_id: p.id, cron_schedule: "0 * * * *", next_run_at: at(-1) })
          .select("id")
          .single(),
        "scheduled job insert",
      );
      p.jobs.push(job.id);
    }
    ok(await admin.from("usage_quotas").insert({ user_id: p.id }).select("user_id").single(), "quota insert");
    const f1 = `${p.id}/notes-${tag}.txt`;
    const f2 = `${p.id}/${p.workflows[0]}/shot.png`;
    let r = await admin.storage.from("workflow-attachments").upload(f1, new Blob([`attachment of ${tag}`], { type: "text/plain" }), { contentType: "text/plain" });
    if (r.error) throw new Error(`upload failed: ${r.error.message}`);
    r = await admin.storage.from("execution-screenshots").upload(f2, new Blob([PNG], { type: "image/png" }), { contentType: "image/png" });
    if (r.error) throw new Error(`upload failed: ${r.error.message}`);
    p.files = [f1, f2];
    return p;
  };

  const idsOf = (table: string, who: Person): string[] =>
    ({ workflows: who.workflows, executions: who.executions, execution_logs: who.logs, scheduled_jobs: who.jobs } as Record<string, string[]>)[table];

  const A = await seed("a", 2, 2); // 2 workflows, 4 executions, 4 logs, 2 jobs
  const B = await seed("b", 3, 2); // 3 workflows, 6 executions, 6 logs, 3 jobs
  const everyId = (p: Person) => [p.id, ...p.workflows, ...p.executions, ...p.logs, ...p.jobs];

  try {
    // ---------- Part A: export ----------
    console.log("Part A: export-my-data against a local Supabase stack, two users");
    const none = await call("export-my-data", null);
    check("no token gives 401", none.status === 401, `status ${none.status}`);
    const anonOnly = await call("export-my-data", ANON as string);
    check("the anon key as a token gives 401 (it is not a user)", anonOnly.status === 401, `status ${anonOnly.status}`);
    const junk = await call("export-my-data", "not-a-jwt");
    check("a junk token gives 401", junk.status === 401, `status ${junk.status}`);
    const post = await call("export-my-data", A.token, { method: "POST", body: {} });
    check("POST gives 405", post.status === 405, `status ${post.status}`);

    const exA = await call("export-my-data", A.token);
    check("A gets 200", exA.status === 200, `status ${exA.status}`);
    check("the answer is a download (Content-Disposition attachment, JSON)", /^attachment; filename="autoflow-pro-export-\d{4}-\d{2}-\d{2}\.json"$/.test(exA.headers.get("content-disposition") ?? "") && (exA.headers.get("content-type") ?? "").startsWith("application/json"));
    check("the document names its format and version", exA.body.format === "autoflow-pro-personal-data-export" && exA.body.version === 1);
    check("account block is A's id and email", exA.body.account.id === A.id && exA.body.account.email === A.email);
    for (const t of ["workflows", "executions", "execution_logs", "scheduled_jobs"]) {
      const got = (exA.body.data[t] as { id: string }[]).map((r) => r.id);
      check(`A's ${t}: exactly A's ${idsOf(t, A).length} rows`, same(got, idsOf(t, A)), `got ${got.length}`);
    }
    check("A's usage quota row is there", exA.body.data.usage_quotas.length === 1 && exA.body.data.usage_quotas[0].user_id === A.id);
    check("A's extracted content is in the document", exA.body.data.executions.every((e: any) => String(e.extracted_data.scraped).startsWith("a-secret-")));
    check("A's stored files are listed, sub folder included", same([...exA.body.stored_files["workflow-attachments"], ...exA.body.stored_files["execution-screenshots"]], A.files));

    const exB = await call("export-my-data", B.token);
    check("B gets 200", exB.status === 200, `status ${exB.status}`);
    for (const t of ["workflows", "executions", "execution_logs", "scheduled_jobs"]) {
      const got = (exB.body.data[t] as { id: string }[]).map((r) => r.id);
      check(`B's ${t}: exactly B's ${idsOf(t, B).length} rows`, same(got, idsOf(t, B)), `got ${got.length}`);
    }
    const textA = JSON.stringify(exA.body);
    const textB = JSON.stringify(exB.body);
    check("A's document holds no id, email or file of B", !everyId(B).some((id) => textA.includes(id)) && !textA.includes(B.email) && !textA.includes("b-secret-") && !textA.includes(`notes-${B.tag}`));
    check("B's document holds no id, email or file of A", !everyId(A).some((id) => textB.includes(id)) && !textB.includes(A.email) && !textB.includes("a-secret-") && !textB.includes(`notes-${A.tag}`));

    // ---------- Part B: the deliberate break ----------
    console.log("\nPart B: the export function with the service role client swapped in must leak, and the check must catch it");
    const original = readFileSync(exportFile, "utf8");
    const mutated = original
      .replace('Deno.env.get("SUPABASE_ANON_KEY")', 'Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")')
      .replace("global: { headers: { Authorization: auth } },", "");
    check("the mutant differs from the real function", mutated !== original && !mutated.includes("global: { headers"));
    const leaks = (body: any): boolean => (body?.data?.workflows ?? []).some((w: { id: string }) => B.workflows.includes(w.id));
    writeFileSync(exportFile, mutated);
    try {
      let leaked = false;
      let reached = false;
      // The runtime reloads an edited function after a moment: keep asking until the answer shows the swapped client.
      for (let i = 0; i < 40 && !leaked; i++) {
        const m = await call("export-my-data", A.token);
        if (m.status === 200 && m.body?.data) {
          reached = true;
          leaked = leaks(m.body);
        }
        if (!leaked) await sleep(500);
      }
      check("the mutant answered", reached);
      check("the leak check catches the mutant (A's export holds B's workflows)", leaked);
    } finally {
      writeFileSync(exportFile, original);
      check("the real function is back in place", readFileSync(exportFile, "utf8") === original);
    }
    let clean = false;
    for (let i = 0; i < 40 && !clean; i++) {
      const r = await call("export-my-data", A.token);
      if (r.status === 200 && r.body?.data) clean = !leaks(r.body) && r.body.data.workflows.length === A.workflows.length;
      if (!clean) await sleep(500);
    }
    check("after the restore A's export holds only A's workflows again", clean);

    // ---------- Part C: retention ----------
    console.log("\nPart C: retention (purge_old_execution_logs) removes old log lines and keeps newer ones");
    const R = await mkUser("r");
    const rwf = ok(await admin.from("workflows").insert({ user_id: R.id, name: "retention", definition: {} }).select("id").single(), "workflow insert");
    const rex = ok(await admin.from("executions").insert({ user_id: R.id, workflow_id: rwf.id, status: "completed" }).select("id").single(), "execution insert");
    const logAt = async (daysAgo: number, msg: string): Promise<string> =>
      ok(await admin.from("execution_logs").insert({ execution_id: rex.id, level: "info", message: msg, timestamp: at(daysAgo) }).select("id").single(), "log insert").id;
    const old120 = await logAt(120, "120 days old");
    const old91 = await logAt(91, "91 days old");
    const mid60 = await logAt(60, "60 days old");
    const mid89 = await logAt(89, "89 days old");
    const new10 = await logAt(10, "10 days old");
    const new0 = await logAt(0, "just now");
    const present = async (): Promise<string[]> =>
      ok(await admin.from("execution_logs").select("id").eq("execution_id", rex.id), "log read").map((r: { id: string }) => r.id);
    check("seeded six log lines", (await present()).length === 6);

    const noCron = psql("SELECT to_regclass('cron.job') IS NULL");
    if (noCron === "f") {
      const job = psql("SELECT schedule || ' | ' || command FROM cron.job WHERE jobname = 'purge-old-execution-logs'");
      check("a pg_cron job runs the purge daily at 03:17 UTC with 90 days", job === "17 3 * * * | SELECT public.purge_old_execution_logs(90)", job);
    } else {
      console.log("  skip  pg_cron is not installed in this database, so no schedule to check");
    }

    for (const bad of [0, -5]) {
      const r = await admin.rpc("purge_old_execution_logs", { p_days: bad });
      check(`p_days ${bad} is refused`, r.error !== null);
    }
    check("a refused call removed nothing", (await present()).length === 6);

    const asUser = createClient(URL, ANON, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${R.token}` } } });
    const byUser = await asUser.rpc("purge_old_execution_logs", { p_days: 1 });
    check("a signed in user cannot run the purge", byUser.error !== null);
    const byAnon = await createClient(URL, ANON, { auth: { persistSession: false } }).rpc("purge_old_execution_logs", { p_days: 1 });
    check("the anon key cannot run the purge", byAnon.error !== null);
    check("those refused calls removed nothing", (await present()).length === 6);

    const run90 = await admin.rpc("purge_old_execution_logs", { p_days: 90 });
    check("the 90 day purge reports 2 removed", run90.data === 2, `got ${run90.data} ${run90.error?.message ?? ""}`);
    const after90 = await present();
    check("the 120 and 91 day old lines are gone, the other four stay", same(after90, [mid60, mid89, new10, new0]) && !after90.includes(old120) && !after90.includes(old91));
    const logsOfOthers = ok(await admin.from("execution_logs").select("id").in("id", [...A.logs, ...B.logs]), "other users log read");
    check("A's and B's recent log lines were not touched", logsOfOthers.length === A.logs.length + B.logs.length);

    const run30 = await admin.rpc("purge_old_execution_logs", { p_days: 30 });
    check("a 30 day purge reports 2 removed (60 and 89 days old)", run30.data === 2, `got ${run30.data}`);
    check("the 10 day old and the new line stay", same(await present(), [new10, new0]));
    const again = await admin.rpc("purge_old_execution_logs", { p_days: 30 });
    check("running it again removes nothing", again.data === 0, `got ${again.data}`);

    // ---------- Part D: erasure ----------
    console.log("\nPart D: delete-my-account");
    const none2 = await call("delete-my-account", null, { method: "POST", body: { confirm: "DELETE MY ACCOUNT" } });
    check("no token gives 401", none2.status === 401, `status ${none2.status}`);
    const junk2 = await call("delete-my-account", "not-a-jwt", { method: "POST", body: { confirm: "DELETE MY ACCOUNT" } });
    check("a junk token gives 401", junk2.status === 401, `status ${junk2.status}`);
    const get2 = await call("delete-my-account", A.token);
    check("GET gives 405", get2.status === 405, `status ${get2.status}`);
    for (const [label, body] of [["no body", undefined], ["an empty body", {}], ["the wrong phrase", { confirm: "yes" }]] as const) {
      const r = await call("delete-my-account", A.token, { method: "POST", body });
      check(`${label} gives 400`, r.status === 400, `status ${r.status}`);
    }
    const stillA = await admin.auth.admin.getUserById(A.id);
    check("A still exists after the refused requests", !stillA.error && stillA.data.user?.id === A.id);

    // The sanity check for the search itself: before the erasure it must find A, or "finds nothing" proves nothing.
    const beforeId = findEverywhere(A.id);
    const beforeEmail = findEverywhere(A.email);
    check("before erasure the all tables search finds A's id in the app tables and in auth.users", ["public.workflows", "public.executions", "public.usage_quotas", "auth.users"].every((t) => beforeId.some((h) => h.startsWith(`${t}:`))), beforeId.join(", "));
    check("before erasure the all tables search finds A's email in auth.users and in Auth's own event log (auth.audit_log_entries)", ["auth.users", "auth.audit_log_entries"].every((t) => beforeEmail.some((h) => h.startsWith(`${t}:`))), beforeEmail.join(", "));

    // A third user tries to erase B by naming B in the body and in the query string. The function ignores both
    // and erases only the caller.
    const C = await mkUser("c");
    const probe = await call("delete-my-account", C.token, {
      method: "POST",
      body: { confirm: "DELETE MY ACCOUNT", user_id: B.id, id: B.id, email: B.email },
      query: `?user_id=${B.id}`,
    });
    check("C's request is accepted and erases C", probe.status === 200 && probe.body.erased === true, `status ${probe.status}`);
    check("C is gone", (await admin.auth.admin.getUserById(C.id)).error !== null);
    const bUser = await admin.auth.admin.getUserById(B.id);
    check("B still exists after C named B", !bUser.error && bUser.data.user?.id === B.id);
    const bAfterC = await call("export-my-data", B.token);
    check("B's export is unchanged after C's request", bAfterC.status === 200 && same(bAfterC.body.data.executions.map((r: any) => r.id), B.executions) && same(bAfterC.body.data.workflows.map((r: any) => r.id), B.workflows));

    // A erases A.
    const erase = await call("delete-my-account", A.token, { method: "POST", body: { confirm: "DELETE MY ACCOUNT" } });
    check("A's confirmed request gives 200 and erased true", erase.status === 200 && erase.body.erased === true && erase.body.warning === undefined, `status ${erase.status} ${JSON.stringify(erase.body)}`);
    const requestId: string = erase.body.request_id;
    check("the receipt is a request id that is not A's id", /^[0-9a-f-]{36}$/.test(requestId ?? "") && requestId !== A.id);

    check("A's auth user is gone", (await admin.auth.admin.getUserById(A.id)).error !== null);
    for (const t of ["workflows", "executions", "scheduled_jobs", "usage_quotas"]) {
      const r = await admin.from(t).select("*", { count: "exact", head: true }).eq("user_id", A.id);
      check(`no ${t} row is left for A`, r.error === null && r.count === 0, `count ${r.count} ${r.error?.message ?? ""}`);
    }
    const logsLeft = ok(await admin.from("execution_logs").select("id").in("id", A.logs), "log read");
    check("none of A's execution logs is left", logsLeft.length === 0);
    for (const bucket of ["workflow-attachments", "execution-screenshots"]) {
      const top = ok(await admin.storage.from(bucket).list(A.id), "storage list");
      check(`nothing is left in ${bucket} for A`, top.length === 0, `${top.length} entries`);
    }
    const reuse = await call("export-my-data", A.token);
    check("A's old token no longer works", reuse.status === 401, `status ${reuse.status}`);

    // The big one: any table, any schema.
    const afterId = findEverywhere(A.id);
    const afterEmail = findEverywhere(A.email);
    check("after erasure no row in any table carries A's id", afterId.length === 0, afterId.join(", "));
    check("after erasure no row in any table carries A's email", afterEmail.length === 0, afterEmail.join(", "));
    const rowIds = [...A.workflows, ...A.executions, ...A.logs, ...A.jobs];
    const strays = rowIds.flatMap((id) => findEverywhere(id).map((h) => `${id} in ${h}`));
    check(`after erasure no row in any table carries any of A's ${rowIds.length} row ids`, strays.length === 0, strays.join(", "));
    const cHits = [...findEverywhere(C.id), ...findEverywhere(C.email)];
    check("the same holds for C, erased by the same route", cHits.length === 0, cHits.join(", "));

    // The audit row.
    const audit = psql(`SELECT request_id || '|' || action || '|' || requested_at FROM erasure_audit WHERE request_id = '${requestId}'`);
    check("an audit row exists for the request", audit.startsWith(`${requestId}|account_erasure|`), audit);
    const columns = psql("SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'erasure_audit'");
    check("the audit table has only request_id, action and requested_at", columns === "request_id,action,requested_at", columns);
    const fresh = psql(`SELECT requested_at > NOW() - interval '5 minutes' FROM erasure_audit WHERE request_id = '${requestId}'`);
    check("the audit time is the time of the request", fresh === "t");
    const auditText = psql("SELECT string_agg(x::text, ' ') FROM erasure_audit x");
    check("no audit row holds A's id, A's email, B's id or B's email", ![A.id, A.email, B.id, B.email].some((s) => auditText.includes(s)));
    const bAudit = await createClient(URL, ANON, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${B.token}` } } })
      .from("erasure_audit")
      .select("*");
    check("a signed in user cannot read the audit table", bAudit.error !== null || (bAudit.data ?? []).length === 0, JSON.stringify(bAudit.data));

    // B is untouched by all of it.
    const bFinal = await call("export-my-data", B.token);
    check("B's data is intact after A's erasure", bFinal.status === 200 && same(bFinal.body.data.executions.map((r: any) => r.id), B.executions) && same(bFinal.body.data.execution_logs.map((r: any) => r.id), B.logs) && same([...bFinal.body.stored_files["workflow-attachments"], ...bFinal.body.stored_files["execution-screenshots"]], B.files));
  } finally {
    for (const id of created) await admin.auth.admin.deleteUser(id).catch(() => undefined);
    // Remove stored files the failed run may have left behind.
    for (const bucket of ["workflow-attachments", "execution-screenshots"]) {
      for (const id of created) {
        const names = await listAll(admin, bucket, id);
        if (names.length > 0) await admin.storage.from(bucket).remove(names);
      }
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

async function listAll(client: SupabaseClient, bucket: string, prefix: string): Promise<string[]> {
  const { data } = await client.storage.from(bucket).list(prefix, { limit: 100 });
  const out: string[] = [];
  for (const e of data ?? []) {
    if (e.id === null) out.push(...(await listAll(client, bucket, `${prefix}/${e.name}`)));
    else out.push(`${prefix}/${e.name}`);
  }
  return out;
}

main().catch((e) => {
  console.error("test run failed:", e);
  process.exit(1);
});
