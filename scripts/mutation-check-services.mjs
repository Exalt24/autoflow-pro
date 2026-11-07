// LIFESPAN: permanent
// Mutation check for the Temporal workflow, the GraphQL API and the Rust CLI. Each mutant removes or breaks one guard in a
// scratch copy of the repo and the matching tests must go red; the real files are never touched.
//   temporal   backend/src/temporal  -> tests/test-temporal.ts (SDK test server, no setup)
//   e2e        backend/src/temporal  -> tests/test-temporal-e2e.ts against TEMPORAL_ADDRESS (a running `temporal server start-dev`)
//   graphql    backend/src/graphql   -> tests/test-graphql.ts
//   cli        cli/src               -> cargo test (needs cargo)
// Run: node scripts/mutation-check-services.mjs [check|temporal|e2e|graphql|cli|all]
// MUT_JOBS sets how many temporal/graphql mutants run at once (default 3). e2e and cli mutants run one at a time.
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, rmdirSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TW = "backend/src/temporal/workflows.ts";
const TT = "backend/src/temporal/types.ts";
const TV = "backend/src/temporal/validation.ts";
const TA = "backend/src/temporal/activities.ts";
const TC = "backend/src/temporal/client.ts";
const G = "backend/src/graphql/";

const m = (kind, name, file, from, to) => ({ kind, name, edits: [{ file, from, to }] });
const m2 = (kind, name, edits) => ({ kind, name, edits });

const mutants = [
  // ---- Temporal: the three the task names, then the rest of the guards
  m("temporal", "the retry policy is deleted from the activity options", TW, "  retry: RETRY_POLICY,\n", ""),
  m("temporal", "the retry policy allows one try only", TT, "maximumAttempts: 4,", "maximumAttempts: 1,"),
  m("temporal", "a validation error is retried like any other failure", TT, "  nonRetryableErrorTypes: [VALIDATION_ERROR],\n", ""),
  m("temporal", "the cancel signal handler does nothing", TW, "    cancelRequested = true;\n    cancelReason = reason;\n", "    void reason;\n"),
  m("temporal", "the step timeout is not part of the race", TW, "Promise.race([done, timer, cancel])", "Promise.race([done, cancel])"),
  m("temporal", "the cancel signal is not part of the race", TW, "Promise.race([done, timer, cancel])", "Promise.race([done, timer])"),
  m("temporal", "the timeout does not stop the step (no work.cancel())", TW, "        work.cancel();\n", ""),
  m("temporal", "the step budget is the default 60 s, not the input's", TV, "input.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS", "DEFAULT_STEP_TIMEOUT_MS"),
  m("temporal", "a run that did not complete is not archived", TW, "    status.state = \"archiving\";\n", "    status.state = \"archiving\";\n    if (state !== \"completed\") return { runId: input.runId, state, completedSteps: [...status.completedSteps] };\n"),
  m("temporal", "a finished step is not recorded as completed", TW, "    status.completedSteps.push(step.id);\n", ""),
  m("temporal", "the status query never learns which step is running", TW, "    status.currentStep = i + 1;\n", ""),
  m("temporal", "an archive failure fails the whole run", TW, "      result.archiveError = messageOf(e);\n", "      throw e;\n"),
  m("temporal", "the failure message loses the real cause", TW, "    msg = (cur as Error).message;\n", ""),
  m("temporal", "the steps run in reverse order", TW, "const step = input.steps[i]!;\n    let outcome", "const step = input.steps[input.steps.length - 1 - i]!;\n    let outcome"),
  m("temporal", "a repeated step id is allowed", TV, "if (seen.has(s.id)) return", "if (false) return"),
  m("temporal", "a run with no steps is allowed", TV, "i.steps.length === 0) return", "false) return"),
  m("temporal", "the step limit is off by one", TV, "i.steps.length > MAX_STEPS", "i.steps.length >= MAX_STEPS"),
  m("temporal", "a timeout under 100 ms is allowed", TV, "i.stepTimeoutMs < 100 ||", "i.stepTimeoutMs < 1 ||"),
  m("temporal", "the dry run executor fails one try too few", TA, "ctx.attempt <= cfg.failFirstAttempts", "ctx.attempt < cfg.failFirstAttempts"),

  // ---- Temporal against the real dev server
  m("e2e", "the retry policy is deleted from the activity options", TW, "  retry: RETRY_POLICY,\n", ""),
  m("e2e", "the retry policy allows one try only", TT, "maximumAttempts: 4,", "maximumAttempts: 1,"),
  m("e2e", "the cancel signal handler does nothing", TW, "    cancelRequested = true;\n    cancelReason = reason;\n", "    void reason;\n"),
  m("e2e", "the step timeout is not part of the race", TW, "Promise.race([done, timer, cancel])", "Promise.race([done, cancel])"),
  m("e2e", "the same run id can be started twice", TC, "WorkflowIdReusePolicy.REJECT_DUPLICATE", "WorkflowIdReusePolicy.ALLOW_DUPLICATE"),
  m("e2e", "the client sends the cancel signal under another name", TC, "signal(CANCEL_SIGNAL, reason)", 'signal("cancelRunX", reason)'),

  // ---- GraphQL
  m("graphql", "the depth limit is not installed", G + "server.ts", "addValidationRule(depthLimitRule(opts.maxDepth ?? DEFAULT_MAX_DEPTH));", "void depthLimitRule;"),
  m("graphql", "the depth limit is off by one (>=)", G + "depthLimit.ts", "if (depth > max) {", "if (depth >= max) {"),
  m("graphql", "the depth limit allows one level too many", G + "depthLimit.ts", "if (depth > max) {", "if (depth > max + 1) {"),
  m("graphql", "fragments are not followed by the depth limit", G + "depthLimit.ts", "if (frag && !seen.has(name))", "if (false && frag && !seen.has(name))"),
  m("graphql", "inline fragments are not followed by the depth limit", G + "depthLimit.ts", "deepest = Math.max(deepest, depthOf(sel.selectionSet, seen));\n        } else {", "} else {"),
  m("graphql", "the workflow loader does not batch (one store call per run)", G + "context.ts", "workflowById: new DataLoader((ids) => store.getWorkflowsByIds(ids)),", "workflowById: new DataLoader((ids) => store.getWorkflowsByIds(ids), { batch: false }),"),
  m("graphql", "the runs loader does not batch (one store call per workflow)", G + "context.ts", "runsByWorkflowId: new DataLoader((ids) => store.runsForWorkflows(ids)),", "runsByWorkflowId: new DataLoader((ids) => store.runsForWorkflows(ids), { batch: false }),"),
  m("graphql", "the workflow resolver skips the loader", G + "resolvers.ts", "const w = await ctx.loaders.workflowById.load(r.workflowId);", "const w = (await ctx.store.getWorkflowsByIds([r.workflowId]))[0] ?? null;"),
  m("graphql", "loaders are shared by every request", G + "server.ts", "context: () => createContext(opts.store, opts.launcher),", "context: ((c) => () => c)(createContext(opts.store, opts.launcher)),"),
  m("graphql", "the name may be empty", G + "inputs.ts", '.min(1, "must not be empty")', ""),
  m("graphql", "the name length is not limited", G + "inputs.ts", '.max(100, "must be at most 100 characters")', ""),
  m("graphql", "any text is a step type", G + "inputs.ts", "z.enum(STEP_TYPES, { error: `must be one of the ${STEP_TYPES.length} step types` })", "z.string()"),
  m("graphql", "step ids may repeat", G + "inputs.ts", '.refine((steps) => new Set(steps.map((s) => s.id)).size === steps.length, "step ids must be unique")', ""),
  m("graphql", "a workflow may have no steps", G + "inputs.ts", '.min(1, "a workflow needs at least one step")', ""),
  m("graphql", "a step timeout under 100 ms is allowed", G + "inputs.ts", '.min(100, "must be at least 100")', ".min(0, \"x\")"),
  m("graphql", "an id may hold a slash", G + "inputs.ts", "const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/,", "const id = z.string().regex(/^[A-Za-z0-9_/-]{1,128}$/,"),
  m("graphql", "a page of 0 or 100000 is allowed", G + "inputs.ts", '.min(1, "must be at least 1").max(100, "must be at most 100")', ""),
  m("graphql", "a made up cursor is accepted as the start", G + "resolvers.ts", 'const m = /^run:([1-9][0-9]{0,15})$/.exec(text);\n  return m ? Number(m[1]) : null;', "const m = /^run:([0-9]{1,16})$/.exec(text);\n  return m ? Number(m[1]) : 0;"),
  m("graphql", "an unknown workflow is not reported", G + "resolvers.ts", 'if (!workflow) return notFound("workflow", parsed.data.workflowId);', ""),
  m("graphql", "an ended run can be cancelled again", G + "resolvers.ts", "if (TERMINAL_STATES.has(run.state)) {", "if (false) {"),
  m("graphql", "a run that never started stays QUEUED", G + "resolvers.ts", 'await ctx.store.markRunFailed(run.id, "could not start the Temporal workflow");', ""),
  m("graphql", "cancel does not signal Temporal", G + "resolvers.ts", "await ctx.launcher.cancel(run.id);", ""),
  m("graphql", "unexpected errors are shown to the client", G + "server.ts", "maskedErrors: true,", "maskedErrors: false,"),
  m("graphql", "runs come oldest first", G + "store.ts", ".sort((a, b) => b.seq - a.seq);", ".sort((a, b) => a.seq - b.seq);"),
  m("graphql", "a page starts at the cursor run again (a repeat)", G + "store.ts", "r.seq < page.after!.seq", "r.seq <= page.after!.seq"),
  m("graphql", "hasNextPage is always false", G + "store.ts", "hasNextPage: rest.length > page.first,", "hasNextPage: false,"),
  m("graphql", "the state filter is ignored", G + "store.ts", "(filter.state === undefined || r.state === filter.state)", "true"),
  m("graphql", "a workflow's runs page skips its first run", G + "resolvers.ts", "start = all.findIndex((r) => r.seq < seq);", "start = all.findIndex((r) => r.seq < seq) + 1;"),
  m("graphql", "the schema changes without the snapshot", G + "typeDefs.ts", "    runCount: Int!\n", "    runCount: Int!\n    nickname: String\n"),

  // ---- Rust CLI (cargo test)
  m("cli", "follow stops polling after the first look", "cli/src/follow.rs", "if is_terminal(&run.state) {", "if true {"),
  m("cli", "follow treats QUEUED as finished", "cli/src/follow.rs", 'matches!(state, "COMPLETED" | "FAILED" | "CANCELLED" | "TIMED_OUT")', 'matches!(state, "COMPLETED" | "FAILED" | "CANCELLED" | "TIMED_OUT" | "QUEUED")'),
  m("cli", "the back-off never grows", "cli/src/follow.rs", "(current * 2).min(max)", "current"),
  m("cli", "the back-off has no ceiling", "cli/src/follow.rs", "(current * 2).min(max)", "current * 2"),
  m("cli", "follow never gives up", "cli/src/follow.rs", "if started.elapsed() >= opts.timeout {", "if false {"),
  m("cli", "a GraphQL error in the answer is ignored", "cli/src/client.rs", "if let Some(errors) = body.errors {", "if let Some(errors) = None::<Vec<GraphQlError>> {"),
  m("cli", "an HTTP error status is ignored", "cli/src/client.rs", "if !status.is_success() {", "if false {"),
  m("cli", "a typed error from a mutation is shown as success", "cli/src/commands.rs", "if let Some(msg) = typed_error(value) {", "if let Some(msg) = None::<String> {"),
  m("cli", "the exit code of a failed run is 0", "cli/src/follow.rs", '"FAILED" => 1,', '"FAILED" => 0,'),
];

function scratch(mutant, kind) {
  const dir = mkdtempSync(join(tmpdir(), "svc-mutant-"));
  const keep = (src) => !/[\\/](node_modules|dist|target|\.git)([\\/]|$)/.test(src);
  const subs = kind === "cli" ? ["cli"] : ["backend/src", "backend/tests", "backend/package.json", "backend/tsconfig.json"];
  for (const sub of subs) cpSync(join(root, sub), join(dir, sub), { recursive: true, filter: keep });
  if (kind !== "cli") symlinkSync(join(root, "backend", "node_modules"), join(dir, "backend", "node_modules"), "junction");
  if (mutant) {
    for (const e of mutant.edits) {
      const path = join(dir, e.file);
      const text = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
      if (!text.includes(e.from)) throw new Error(`mutation target not found in ${e.file}: ${e.from}`);
      writeFileSync(path, text.replace(e.from, () => e.to));
    }
  }
  // Windows copies keep the old file times, and cargo trusts file times, so a copy could reuse a build of a mutant that
  // ran before it in the shared target folder. Touching every file makes cargo rebuild what it must.
  if (kind === "cli") touchAll(join(dir, "cli"));
  return dir;
}

function touchAll(folder) {
  const now = new Date();
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) touchAll(path);
    else utimesSync(path, now, now);
  }
}

function cleanup(dir) {
  try {
    rmdirSync(join(dir, "backend", "node_modules")); // drop the junction first so the real modules are never walked
  } catch {}
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  } catch (e) {
    console.log(`note: could not remove ${dir} (${e.code})`);
  }
}

function runCmd(cmd, cwd, env, timeoutMs) {
  return new Promise((resolveRun) => {
    const child = spawn(cmd, { cwd, env, shell: true });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    // On Windows child.kill() ends only the shell and leaves the test running, so end the whole tree.
    const timer = setTimeout(() => {
      if (process.platform === "win32" && child.pid) spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
      else child.kill();
    }, timeoutMs);
    child.on("close", (status) => {
      clearTimeout(timer);
      resolveRun({ status, out });
    });
  });
}

const cargoEnv = () => ({ ...process.env, CARGO_TARGET_DIR: process.env.MUT_CARGO_TARGET ?? join(tmpdir(), "svc-mutant-cargo-target") });
function run(kind, dir) {
  if (kind === "cli") return runCmd("cargo test --quiet", join(dir, "cli"), cargoEnv(), 600000);
  const script = { temporal: "test-temporal.ts", e2e: "test-temporal-e2e.ts", graphql: "test-graphql.ts" }[kind];
  const env = kind === "e2e" ? { ...process.env, REQUIRE_TEMPORAL: "1" } : process.env;
  return runCmd(`npx tsx tests/${script}`, join(dir, "backend"), env, 240000);
}

// A failing check line is the clean signal. A crash counts only when it is a runtime error from the code under test, so a
// broken harness (a syntax error in the mutated copy, a missing module) can never pass as a catch.
const HARNESS_TROUBLE = /SyntaxError|Transform failed|Cannot find module|ERR_MODULE_NOT_FOUND|ERR_UNKNOWN|ENOENT|EPERM|error: could not compile|error\[E/;
function verdict(kind, r) {
  const out = r.out;
  if (kind === "cli") {
    const compile = /error: could not compile|error\[E/.test(out);
    const failing = out.split("\n").filter((l) => /^test .* FAILED$|^---- .* stdout ----$/.test(l)).slice(0, 2).map((l) => l.trim());
    if (r.status !== 0 && !compile && failing.length > 0) return { red: true, note: `first red: ${failing.join(" | ")}` };
    return { red: false, note: compile ? "did not compile (harness problem)" : `no failing test, last output: ${out.trim().split("\n").slice(-4).join(" / ")}` };
  }
  const failing = out.split("\n").filter((l) => /^FAIL {2}/.test(l)).slice(0, 2).map((l) => l.trim().slice(0, 160));
  if (r.status !== 0 && failing.length > 0) return { red: true, note: `first red: ${failing.join(" | ")}` };
  const lines = out.split("\n");
  const firstAt = lines.findIndex((l) => /^\s+at /.test(l));
  const crash = firstAt > 0 && /^Node\.js v/m.test(out) ? lines.slice(0, firstAt).reverse().find((l) => l.trim() !== "") : undefined;
  if (r.status !== 0 && r.status !== null && crash && !HARNESS_TROUBLE.test(out)) return { red: true, note: `test crashed: ${crash.trim().slice(0, 140)}` };
  return { red: false, note: `no failing check line, last output: ${out.trim().split("\n").slice(-6).join(" / ").slice(0, 300)}` };
}

async function pool(items, jobs, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: jobs }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]);
      }
    }),
  );
  return results;
}

const want = process.argv[2] ?? "all";

if (want === "check") {
  // Every mutation target must exist in the real files, so a refactor that moves a guard cannot leave a dead mutant.
  let missing = 0;
  for (const mu of mutants) {
    for (const e of mu.edits) {
      const p = join(root, e.file);
      if (!existsSync(p)) {
        if (mu.kind === "cli") continue; // the cli folder may not be on this checkout yet
        missing++;
        console.log(`MISSING FILE  ${e.file}`);
        continue;
      }
      if (!readFileSync(p, "utf8").replace(/\r\n/g, "\n").includes(e.from)) {
        missing++;
        console.log(`MISSING  [${mu.kind}] ${mu.name}: ${e.from.slice(0, 90)}`);
      }
    }
  }
  console.log(`${mutants.length} mutants, ${missing} with a target that is not in the code`);
  process.exit(missing === 0 ? 0 : 1);
}

const kinds = want === "all" ? ["temporal", "e2e", "graphql", "cli"] : [want];
let killed = 0;
let total = 0;
let harnessProblems = 0;
for (const kind of kinds) {
  if (kind === "e2e" && !process.env.TEMPORAL_ADDRESS) {
    console.log("SKIPPED  e2e mutants: TEMPORAL_ADDRESS is not set (start `temporal server start-dev` and set it)");
    continue;
  }
  {
    const dir = scratch(null, kind);
    const r = await run(kind, dir);
    cleanup(dir);
    const ok = r.status === 0;
    console.log(`${ok ? "BASELINE PASS" : "BASELINE FAIL"}  ${kind} tests on the unmutated copy`);
    if (!ok) {
      harnessProblems++;
      console.log(String(r.out).slice(-1500));
      continue;
    }
  }
  const list = mutants.filter((x) => x.kind === kind);
  const jobs = kind === "temporal" || kind === "graphql" ? Number(process.env.MUT_JOBS ?? 3) : 1;
  const results = await pool(list, jobs, async (mu) => {
    const dir = scratch(mu, kind);
    const r = await run(kind, dir);
    cleanup(dir);
    return verdict(kind, r);
  });
  list.forEach((mu, i) => {
    total++;
    if (results[i].red) killed++;
    console.log(`${results[i].red ? "KILLED  " : "SURVIVED"}  [${kind}] ${mu.name}\n          ${results[i].note}`);
  });
}
console.log(`\nmutants killed: ${killed} of ${total}${harnessProblems ? ` (${harnessProblems} baseline problem(s))` : ""}`);
process.exit(killed === total && harnessProblems === 0 ? 0 : 1);
