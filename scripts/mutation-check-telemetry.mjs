// LIFESPAN: permanent
// Mutation check for the telemetry pipeline and its Terraform. Each mutant removes or breaks one guard in a scratch copy
// of the repo and the matching tests must go red; the real files are never touched.
//   unit       backend/src/telemetry (rules, rollups, lake, pipeline) -> test-telemetry-logic.ts, then test-telemetry-e2e.ts
//   terraform  deploy/athena (telemetry.tf and what it touches)        -> test-telemetry-terraform.ts (plan JSON)
//   broker     the worker and the order of write and apply             -> test-telemetry-rabbitmq.ts alone (needs RABBITMQ_URL)
// Run: node scripts/mutation-check-telemetry.mjs [unit|terraform|broker|all]
// MUT_JOBS sets how many unit mutants run at once (default 6). Terraform mutants run one at a time (they share the provider cache).
import { cpSync, mkdtempSync, readFileSync, rmSync, rmdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tfData = join(root, "deploy", "athena", ".terraform");
const T = "backend/src/telemetry/";
const SCHEMA = `${T}schema.ts`;
const STORE = `${T}store.ts`;
const ROLL = `${T}rollup.ts`;
const LAKE = `${T}lake.ts`;
const PIPE = `${T}pipeline.ts`;
const WORK = `${T}worker.ts`;
const GEN = `${T}generator.ts`;
const TFT = "deploy/athena/telemetry.tf";
const TFM = "deploy/athena/main.tf";
const TFV = "deploy/athena/variables.tf";

const u = (name, file, from, to) => ({ kind: "unit", name, edits: [{ file, from, to }] });
const u2 = (name, edits) => ({ kind: "unit", name, edits });
const t = (name, file, from, to) => ({ kind: "terraform", name, edits: [{ file, from, to }] });
const b = (name, edits) => ({ kind: "broker", name, edits });

const mutants = [
  // ---- the reading schema
  u("a negative power is accepted", SCHEMA, "power_kw: { min: 0, max: 10000, required: true },", "power_kw: { min: -10000, max: 10000, required: true },"),
  u("power_kw is no longer required", SCHEMA, "power_kw: { min: 0, max: 10000, required: true },", "power_kw: { min: 0, max: 10000, required: false },"),
  u("the upper range limit is not checked", SCHEMA, "if (v < spec.min || v > spec.max) return bad(", "if (v < spec.min) return bad("),
  u("a missing required value is accepted", SCHEMA, "if (spec.required) return bad(", "if (false) return bad("),
  u("a numeric string is coerced to a number", SCHEMA, 'if (typeof v !== "number" || !Number.isFinite(v)) return bad("invalid_value"', 'if (!Number.isFinite(Number(v))) return bad("invalid_value"'),
  u("the time zone offset is ignored", SCHEMA, "if (zulu) return local;", "return local;"),
  u2("a time with no zone is accepted as UTC", [
    { file: SCHEMA, from: "(?:(Z)|([+-])(\\d{2}):(\\d{2}))$/;", to: "(?:(Z)|([+-])(\\d{2}):(\\d{2}))?$/;" },
    { file: SCHEMA, from: "if (zulu) return local;", to: "if (zulu || !sign) return local;" },
  ]),
  u("the calendar check on the month is removed", SCHEMA, "    back.getUTCMonth() === Number(mo) - 1 &&\n", ""),
  u("hour 24 is accepted", SCHEMA, "Number(h) <= 23 &&", "Number(h) <= 24 &&"),
  u("a time before 2000 is accepted", SCHEMA, "if (ts < MIN_TS) return bad(", "if (false) return bad("),
  u("a time in the far future is accepted", SCHEMA, "if (ts > opts.nowMs + opts.maxFutureMs) return bad(", "if (false) return bad("),
  u("the future skew limit is off by one", SCHEMA, "if (ts > opts.nowMs + opts.maxFutureMs) return bad(", "if (ts >= opts.nowMs + opts.maxFutureMs) return bad("),
  u("an unknown field is ignored", SCHEMA, "if (!ALLOWED_KEYS.has(key)) return bad(", "if (false) return bad("),
  u("an asset id may hold a slash", SCHEMA, "const ASSET_ID = /^[A-Za-z0-9_-]{1,64}$/;", "const ASSET_ID = /^[A-Za-z0-9_/-]{1,64}$/;"),
  u("two readings differing only in temperature count as the same", SCHEMA, "a.voltage_v === b.voltage_v && a.temp_c === b.temp_c", "a.voltage_v === b.voltage_v"),

  // ---- idempotent ingest, the duplicate rule, the watermark
  u("an already stored key is not looked up (duplicates are not noticed)", STORE, "const existing = pending.get(key) ?? this.get(r.assetId, r.ts);", "const existing = pending.get(key);"),
  u("a repeat inside one batch is not noticed", STORE, "const existing = pending.get(key) ?? this.get(r.assetId, r.ts);", "const existing = this.get(r.assetId, r.ts);"),
  u("a conflicting repeat is treated as a plain duplicate and not quarantined", STORE, "if (sameValues(existing, r)) duplicates++;", "if (true) duplicates++;"),
  u("a reading exactly at the watermark is too late", STORE, "if (r.ts < watermark) {", "if (r.ts <= watermark) {"),
  u("no reading is ever too late", STORE, "if (r.ts < watermark) {", "if (false) {"),
  u("the watermark follows the oldest reading, not the newest", STORE, "top = s && s.ts.length > 0 ? s.ts[s.ts.length - 1] : -Infinity;", "top = s && s.ts.length > 0 ? s.ts[0] : -Infinity;"),
  u2("one watermark is shared by every asset", [
    { file: STORE, from: "let top = batchTop.get(r.assetId);", to: 'let top = batchTop.get("*");' },
    { file: STORE, from: "else batchTop.set(r.assetId, r.ts);", to: 'else batchTop.set("*", r.ts);' },
  ]),
  u("late and merged readings are not counted", STORE, "if (r.ts < top) lateMerged++;", "if (false) lateMerged++;"),
  u("a rejected input is not counted by reason", STORE, "reasons[reason] = (reasons[reason] ?? 0) + 1;", "reasons[reason] = (reasons[reason] ?? 0) + 0;"),
  u("the same rejected input is quarantined again every time", STORE, "if (!this.quarantine.has(key) && !seenKeys.has(key)) {", "if (true) {"),
  u("apply forgets the quarantined inputs", STORE, "for (const e of staged.quarantined) this.quarantine.set(quarantineKeyOf(e), e);", ""),
  u("a late reading is appended instead of placed in time order", STORE, "s.ts.splice(i, 0, r.ts);\n    s.rows.splice(i, 0, r);", "s.ts.push(r.ts);\n    s.rows.push(r);"),
  u("a late reading does not report the reading before it", STORE, "const prevTs = i > 0 ? s.ts[i - 1] : null;", "const prevTs = null;"),
  u("restore overwrites a key it already holds", STORE, "if (this.get(r.assetId, r.ts)) continue;", ""),

  // ---- rollups and gaps
  u("energy is a rectangle (left value) instead of a trapezoid", ROLL, "energy += (((r.power_kw + next.power_kw) / 2) * dt) / HOUR_MS;", "energy += (r.power_kw * dt) / HOUR_MS;"),
  u("a gap segment is integrated like any other", ROLL, "if (dt <= gapMs) energy +=", "if (true) energy +="),
  u("a segment of exactly 1.5 intervals is called a gap", ROLL, "if (dt <= gapMs) energy +=", "if (dt < gapMs) energy +="),
  u("the mean divides by all readings, not the readings that have the channel", ROLL, "row[`${ch}_mean`] = n[c] ? sum[c] / n[c] : null;", "row[`${ch}_mean`] = n[c] ? sum[c] / count : null;"),
  u("a missing channel value is counted as zero", ROLL, "if (v === null) continue;", ""),
  u("the minimum is never updated", ROLL, "if (v < min[c]) min[c] = v;", ""),
  u("a channel with no values reports 0 instead of null", ROLL, "row[`${ch}_max`] = n[c] ? max[c] : null;", "row[`${ch}_max`] = n[c] ? max[c] : 0;"),
  u("buckets are rounded to the nearest start instead of floored", ROLL, "const start = Math.floor(rows[i].ts / resMs) * resMs;", "const start = Math.round(rows[i].ts / resMs) * resMs;"),
  u("a gap exactly 1.5 intervals long is reported", ROLL, "if (dt > gapThresholdMs(cfg)) gaps.push", "if (dt >= gapThresholdMs(cfg)) gaps.push"),
  u("a gap counts one reading too many", ROLL, "missing: Math.round(dt / e) - 1 });", "missing: Math.round(dt / e) });"),
  u("a gap at the start of a window is not reported", ROLL, "if (missing >= 1) gaps.push({ assetId, fromMs: window.fromMs, toMs: ts[lo], missing });", ""),
  u("a gap at the end of a window is not reported", ROLL, "if (missing >= 1) gaps.push({ assetId, fromMs: ts[hi - 1], toMs: window.toMs, missing });", ""),
  u("an asset with no data in the window reports no gap", ROLL, "if (missing >= 1) gaps.push({ assetId, fromMs: window.fromMs, toMs: window.toMs, missing });", ""),
  u("missingBuckets reports nothing", ROLL, "if (!have.has(t)) out.push(t);", ""),
  u("a new reading does not re-roll the bucket of the reading before it", ROLL, "if (prevTs !== null) d[k].add(Math.floor(prevTs / ms) * ms);", ""),
  u("a changed bucket is not marked for its day file", ROLL, "days.add(`${assetId}|${dayOf(start)}`);", ""),
  u("rows come back in insertion order, not time order", ROLL, ".sort((a, b) => a[0] - b[0])", ""),

  // ---- the lake
  u("the hour in the key is not zero padded", LAKE, "hour: isoOf(ts).slice(11, 13) });", "hour: String(new Date(ts).getUTCHours()) });"),
  u("the readings folder says asset_ instead of asset=", LAKE, "readings: `${TELEMETRY_PREFIX}readings/asset={asset}/dt={dt}/hour={hour}/`,", "readings: `${TELEMETRY_PREFIX}readings/asset_{asset}/dt={dt}/hour={hour}/`,"),
  u("the 5 minute rollup moves to another folder", LAKE, "rollup_5m: `${TELEMETRY_PREFIX}rollups_5m/asset={asset}/dt={dt}/`,", "rollup_5m: `${TELEMETRY_PREFIX}rollup5/asset={asset}/dt={dt}/`,"),
  u("an asset id may hold dots and slashes in a key", LAKE, "const ASSET = /^[A-Za-z0-9_-]{1,64}$/;", "const ASSET = /^[A-Za-z0-9_./-]{1,64}$/;"),
  u("a batch id may hold slashes", LAKE, "const BATCH_ID = /^[A-Za-z0-9_-]{1,64}$/;", "const BATCH_ID = /^[A-Za-z0-9_/.-]{1,64}$/;"),
  u("a key with .. is accepted by the local store", LAKE, 'key.split("/").some((p) => p === ".." || p === "." || p === "")', 'key.split("/").some((p) => p === "." || p === "")'),
  u("the local store lists half written temporary files", LAKE, '!entry.name.includes(".tmp-") && ', ""),
  u("lines in a reading file are not sorted by time", LAKE, "rows.sort((a, b) => a.ts - b.ts);", ""),
  u("a reading line drops the temperature", LAKE, "voltage_v: r.voltage_v, temp_c: r.temp_c });", "voltage_v: r.voltage_v });"),
  u("the S3 listing stops after the first page", LAKE, "token = res.IsTruncated ? res.NextContinuationToken : undefined;", "token = undefined;"),
  u("the S3 store throws on a missing key instead of answering null", LAKE, 'if (err.name === "NoSuchKey" || err.Code === "NoSuchKey") return null;', ""),
  u("the lake read skips a missing file silently but also skips corrupt lines", LAKE, "for (const line of parseLines(text)) out.push(readingFromLine(line));", "for (const line of parseLines(text)) { try { out.push(readingFromLine(line)); } catch {} }"),

  // ---- the pipeline: order of write and apply, restart, concurrency
  u2("the store is changed before the files are written", [
    { file: PIPE, from: "    await writeReadings(this.lake, staged.accepted, batchId);\n    await writeQuarantine(this.lake, dayOf(nowMs), staged.quarantined, batchId);\n    const inserted = this.store.apply(staged);", to: "    const inserted = this.store.apply(staged);\n    await writeReadings(this.lake, staged.accepted, batchId);\n    await writeQuarantine(this.lake, dayOf(nowMs), staged.quarantined, batchId);" },
  ]),
  u("quarantined input is not written to the lake", PIPE, "    await writeQuarantine(this.lake, dayOf(nowMs), staged.quarantined, batchId);\n", ""),
  u2("a rollup day that failed to write is forgotten", [
    { file: PIPE, from: '      const [assetId, day] = entry.split("|");\n      for (const res of RESOLUTIONS) {\n        await writeRollupDay(this.lake, res.name, assetId, day, this.rollups.rowsForDay(assetId, res.name, day));\n        written++;\n      }\n      this.pendingDays.delete(entry);', to: '      const [assetId, day] = entry.split("|");\n      this.pendingDays.delete(entry);\n      for (const res of RESOLUTIONS) {\n        await writeRollupDay(this.lake, res.name, assetId, day, this.rollups.rowsForDay(assetId, res.name, day));\n        written++;\n      }' },
  ]),
  u("batches are processed at the same time, not one after another", PIPE, "const run = this.tail.then(() => this.processNow(raws, batchId));", "const run = this.processNow(raws, batchId);"),
  u("one failed batch blocks every batch behind it", PIPE, "this.tail = run.catch(() => undefined);", "this.tail = run;"),
  u("opening the lake does not reload the quarantine", PIPE, "for (const e of await readQuarantine(lake)) p.store.quarantine.set(quarantineKeyOf(e), e);", ""),
  u("opening the lake does not repair a wrong rollup file", PIPE, "if (have !== want) {", "if (false) {"),
  u("the clock for quarantine days is ignored", PIPE, "dayOf(nowMs)", "dayOf(0)"),

  // ---- the worker
  u("the batch id is random, so a redelivery writes other file names", WORK, 'createHash("sha256").update(messageId).digest("hex").slice(0, 24)', 'createHash("sha256").update(String(Math.random())).digest("hex").slice(0, 24)'),
  u("a body whose readings is not an array is accepted", WORK, 'if (!Array.isArray(readings)) throw new PermanentError("payload.readings must be an array");', ""),
  u("the message size limit is off by one", WORK, "readings.length > MAX_READINGS_PER_MESSAGE", "readings.length >= MAX_READINGS_PER_MESSAGE"),

  // ---- the generator
  u("the generator is not deterministic", GEN, "const rnd = mulberry32(seedFor(opts.assetId, opts.seed ?? 1));", "const rnd = mulberry32(Math.floor(Math.random() * 1e9));"),
  u("the planted late reading arrives past the allowed lateness", GEN, "const lateDelay = Math.max(1, Math.floor(opts.allowedLatenessMs / interval / 2));", "const lateDelay = Math.max(1, Math.floor(opts.allowedLatenessMs / interval) * 2);"),
  u("the planted too late reading arrives inside the allowed lateness", GEN, "const tooLateDelay = Math.ceil(opts.allowedLatenessMs / interval) + 5;", "const tooLateDelay = Math.ceil(opts.allowedLatenessMs / interval) - 5;"),

  // ---- Terraform
  t("the telemetry prefix is no longer validated", TFV, 'condition     = can(regex("^[a-z0-9][a-z0-9_-]*/$", var.telemetry_prefix))', "condition     = true"),
  t("telemetry files expire on the events schedule", TFM, "days = var.telemetry_expiry_days", "days = var.events_expiry_days"),
  t("the telemetry lifecycle rule covers the whole bucket", TFM, "prefix = var.telemetry_prefix", 'prefix = ""'),
  t("the telemetry expiry default changes", TFV, "default     = 400", "default     = 40"),
  t("asset is no longer an injected projection", TFT, '"projection.asset.type" = "injected"', '"projection.asset.type" = "enum"'),
  t("hour is padded to one digit", TFT, '"projection.hour.digits" = "2"', '"projection.hour.digits" = "1"'),
  t("hour projects 0 to 24", TFT, '"projection.hour.range"  = "0,23"', '"projection.hour.range"  = "0,24"'),
  t("the 5 minute table reads date= instead of dt=", TFT, "rollups_5m/asset=$${asset}/dt=$${dt}/", "rollups_5m/asset=$${asset}/date=$${dt}/"),
  t("the projection range stops at a fixed day", TFT, '"projection.dt.range"         = "${var.projection_start_day},NOW"', '"projection.dt.range"         = "${var.projection_start_day},2026-12-31"'),
  t("the power column becomes a bigint", TFT, '{ name = "power_kw", type = "double" },', '{ name = "power_kw", type = "bigint" },'),
  t("the rollup energy column is dropped", TFT, '    { name = "energy_kwh", type = "double" },\n', ""),
  t("the gap_segments column becomes a string", TFT, '{ name = "gap_segments", type = "bigint" },', '{ name = "gap_segments", type = "string" },'),
  t("the quarantine detail column is dropped", TFT, '    { name = "detail", type = "string" },\n', ""),
  t("the readings table loses its hour partition key", TFT, '  partition_keys {\n    name = "hour"\n    type = "string"\n  }\n', ""),
  t("the readings table uses another JSON SerDe", TFT, 'serialization_library = "org.apache.hive.hcatalog.data.JsonSerDe"', 'serialization_library = "org.openx.data.jsonserde.JsonSerDe"'),
  t("the quarantine table location leaves its folder", TFT, 'location      = "${local.telemetry_lake_url}quarantine/"', 'location      = "${local.telemetry_lake_url}"'),
  t("the writer policy may delete files", TFT, 'Action   = ["s3:PutObject", "s3:AbortMultipartUpload"]', 'Action   = ["s3:PutObject", "s3:AbortMultipartUpload", "s3:DeleteObject"]'),
  t("the writer policy may write to the whole lake bucket", TFT, 'Sid      = "WriteTheTelemetryFiles"\n        Effect   = "Allow"\n        Action   = ["s3:PutObject", "s3:AbortMultipartUpload"]\n        Resource = "${local.lake_arn}/${var.telemetry_prefix}*"', 'Sid      = "WriteTheTelemetryFiles"\n        Effect   = "Allow"\n        Action   = ["s3:PutObject", "s3:AbortMultipartUpload"]\n        Resource = "${local.lake_arn}/*"'),
  t("the reader policy may write telemetry files", TFT, 'Action   = ["s3:GetObject"]\n        Resource = "${local.lake_arn}/${var.telemetry_prefix}*"\n      },\n      {\n        Sid       = "ListTheTelemetryFiles"', 'Action   = ["s3:GetObject", "s3:PutObject"]\n        Resource = "${local.lake_arn}/${var.telemetry_prefix}*"\n      },\n      {\n        Sid       = "ListTheTelemetryFiles"'),
  t("the reader policy lists the whole bucket", TFT, 'Condition = { StringLike = { "s3:prefix" = ["${var.telemetry_prefix}*"] } }', 'Condition = { StringLike = { "s3:prefix" = ["*"] } }'),
  t("the reader policy cannot see the quarantine table", TFT, '    "${local.glue_arn}:table/${local.database_name}/telemetry_quarantine",\n', ""),
  t("the reader policy gets a wildcard Glue action", TFT, 'Action   = ["glue:GetDatabase", "glue:GetTable", "glue:GetPartitions"]\n        Resource = local.telemetry_tables_arns', 'Action   = ["glue:Get*"]\n        Resource = local.telemetry_tables_arns'),

  // ---- the broker test alone must notice these
  b("the handler returns before the files are written, so the ack comes first", [{ file: WORK, from: "await pipeline.process(readings, batchIdFor(ctx.messageId));", to: "pipeline.process(readings, batchIdFor(ctx.messageId)).catch(() => undefined);" }]),
  b("the store is changed before the files are written (a failed write loses the retry)", [
    { file: PIPE, from: "    await writeReadings(this.lake, staged.accepted, batchId);\n    await writeQuarantine(this.lake, dayOf(nowMs), staged.quarantined, batchId);\n    const inserted = this.store.apply(staged);", to: "    const inserted = this.store.apply(staged);\n    await writeReadings(this.lake, staged.accepted, batchId);\n    await writeQuarantine(this.lake, dayOf(nowMs), staged.quarantined, batchId);" },
  ]),
  b("messages are processed at the same time, not one after another", [{ file: PIPE, from: "const run = this.tail.then(() => this.processNow(raws, batchId));", to: "const run = this.processNow(raws, batchId);" }]),
  b("a restarted worker does not reload the readings from the lake", [{ file: PIPE, from: "const inserted = p.store.restore(readings);", to: "const inserted = p.store.restore([]);" }]),
  b("a body with the wrong shape is retried instead of dead lettered", [{ file: WORK, from: 'throw new PermanentError("payload.readings must be an array");', to: 'throw new Error("payload.readings must be an array");' }]),
  b("bad readings reject the whole message instead of being quarantined", [{ file: PIPE, from: "const staged = this.store.stage(raws, nowMs);", to: "const staged = this.store.stage(raws, nowMs);\n    if (Object.keys(staged.reasons).length > 0) throw new Error('bad reading in message');" }]),
  b("the redelivered message is written again under a new file name", [{ file: WORK, from: "return createHash(\"sha256\").update(messageId).digest(\"hex\").slice(0, 24);", to: "return createHash(\"sha256\").update(String(Math.random())).digest(\"hex\").slice(0, 24);" }]),
];

function scratch(mutant) {
  const dir = mkdtempSync(join(tmpdir(), "telemetry-mutant-"));
  const keep = (src) => !/[\\/](\.terraform|node_modules)([\\/]|$)|\.tfstate|\.tfplan/.test(src);
  for (const sub of ["backend/src", "backend/tests", "backend/package.json", "backend/tsconfig.json", "deploy/athena"]) {
    cpSync(join(root, sub), join(dir, sub), { recursive: true, filter: keep });
  }
  symlinkSync(join(root, "backend", "node_modules"), join(dir, "backend", "node_modules"), "junction");
  if (mutant) {
    for (const e of mutant.edits) {
      const path = join(dir, e.file);
      const text = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
      if (!text.includes(e.from)) throw new Error(`mutation target not found in ${e.file}: ${e.from}`);
      writeFileSync(path, text.replace(e.from, () => e.to));
    }
  }
  return dir;
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

function runScript(dir, script, env) {
  return new Promise((resolveRun) => {
    const child = spawn(`npx tsx tests/${script}`, { cwd: join(dir, "backend"), env, shell: true });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => child.kill(), 240000);
    child.on("close", (status) => {
      clearTimeout(timer);
      resolveRun({ status, out });
    });
  });
}

async function run(kind, dir) {
  const env = { ...process.env, TF_DATA_DIR: tfData, TF_DIR: join(dir, "deploy", "athena"), AWS_ACCESS_KEY_ID: "test", AWS_SECRET_ACCESS_KEY: "test" };
  if (kind === "terraform") return [await runScript(dir, "test-telemetry-terraform.ts", env)];
  if (kind === "broker") return [await runScript(dir, "test-telemetry-rabbitmq.ts", { ...env, REQUIRE_RABBITMQ: "1" })];
  // stop at the first red script, so a mutant is attributed to the first test that notices it
  const first = await runScript(dir, "test-telemetry-logic.ts", env);
  if (first.status !== 0) return [first];
  return [first, await runScript(dir, "test-telemetry-e2e.ts", env)];
}

// A failing check line is the clean signal. A crash counts only when it is a runtime error from the code under test, so a
// broken harness (a syntax error in the mutated copy, a missing module) can never pass as a catch.
const HARNESS_TROUBLE = /SyntaxError|Transform failed|Cannot find module|ERR_MODULE_NOT_FOUND|ERR_UNKNOWN|ENOENT|EPERM/;
function verdict(r) {
  const out = r.out;
  const failing = out.split("\n").filter((l) => /^FAIL {2}/.test(l)).slice(0, 2).map((l) => l.trim());
  if (r.status !== 0 && failing.length > 0) return { red: true, note: `first red: ${failing.join(" | ")}` };
  // an uncaught exception prints its message, then stack lines ("    at ..."), then the Node version
  const lines = out.split("\n");
  const firstAt = lines.findIndex((l) => /^\s+at /.test(l));
  const crash = firstAt > 0 && /^Node\.js v/m.test(out) ? lines.slice(0, firstAt).reverse().find((l) => l.trim() !== "") : undefined;
  if (r.status !== 0 && r.status !== null && crash && !HARNESS_TROUBLE.test(out)) return { red: true, note: `test crashed: ${crash.trim().slice(0, 140)}` };
  return { red: false, note: `no failing check line, last output: ${out.trim().split("\n").slice(-6).join(" / ")}` };
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

if (process.argv[2] === "check") {
  // Every mutation target must exist in the real files, so a refactor that moves a guard cannot leave a dead mutant.
  let missing = 0;
  for (const m of mutants) {
    for (const e of m.edits) {
      const text = readFileSync(join(root, e.file), "utf8").replace(/\r\n/g, "\n");
      if (!text.includes(e.from)) {
        missing++;
        console.log(`MISSING  ${m.name}: ${e.from.slice(0, 90)}`);
      }
    }
  }
  console.log(`${mutants.length} mutants, ${missing} with a target that is not in the code`);
  process.exit(missing === 0 ? 0 : 1);
}

const want = process.argv[2] ?? "all";
const kinds = want === "all" ? ["unit", "terraform", "broker"] : [want];
let killed = 0;
let total = 0;
let skipped = 0;
let harnessProblems = 0;
for (const kind of kinds) {
  if (kind === "broker" && !process.env.RABBITMQ_URL) {
    skipped = mutants.filter((m) => m.kind === "broker").length;
    console.log(`SKIPPED  broker mutants (${skipped}): RABBITMQ_URL is not set`);
    continue;
  }
  // The unmutated copy must pass first, or a "killed" mutant could just be a broken harness
  {
    const dir = scratch(null);
    const results = await run(kind, dir);
    cleanup(dir);
    const ok = results.every((r) => r.status === 0);
    console.log(`${ok ? "BASELINE PASS" : "BASELINE FAIL"}  ${kind} tests on the unmutated copy`);
    if (!ok) {
      harnessProblems++;
      console.log(String(results.at(-1).out).slice(-1500));
      continue;
    }
  }
  const list = mutants.filter((x) => x.kind === kind);
  const jobs = kind === "unit" ? Number(process.env.MUT_JOBS ?? 6) : 1;
  const results = await pool(list, jobs, async (m) => {
    const dir = scratch(m);
    const rs = await run(kind, dir);
    cleanup(dir);
    return verdict(rs.at(-1));
  });
  list.forEach((m, i) => {
    total++;
    if (results[i].red) killed++;
    console.log(`${results[i].red ? "KILLED  " : "SURVIVED"}  [${kind}] ${m.name}\n          ${results[i].note}`);
  });
}
console.log(`\nmutants killed: ${killed} of ${total}${skipped ? ` (${skipped} broker mutants skipped)` : ""}${harnessProblems ? ` (${harnessProblems} baseline problem(s))` : ""}`);
process.exit(killed === total && harnessProblems === 0 ? 0 : 1);
