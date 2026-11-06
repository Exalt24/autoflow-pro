// LIFESPAN: permanent
// Mutation check for the Athena client and the Athena Terraform. Each mutant breaks one decision in a scratch copy of
// the repo and the matching tests must go red; the real files are never touched.
//   unit       backend/src/athena (policy.ts, client.ts, eventLake.ts) -> npm run test:athena-logic and npm run test:athena
//   terraform  deploy/athena                                           -> npm run test:athena-terraform (plan JSON)
// Run: node scripts/mutation-check-athena.mjs [unit|terraform|all]
import { cpSync, mkdtempSync, readFileSync, rmSync, rmdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tfData = join(root, "deploy", "athena", ".terraform");
const POL = "backend/src/athena/policy.ts";
const CLI = "backend/src/athena/client.ts";
const LAKE = "backend/src/athena/eventLake.ts";
const MAIN = "deploy/athena/main.tf";

const mutants = [
  { kind: "unit", name: "QUEUED is no longer a pending state", file: POL, from: '    case "QUEUED":\n    case "RUNNING":', to: '    case "RUNNING":' },
  { kind: "unit", name: "an unlisted state counts as pending", file: POL, from: '    default:\n      return "unknown";', to: '    default:\n      return "pending";' },
  { kind: "unit", name: "a failure with no Retryable flag is resubmitted", file: POL, from: "retryable === true && runsUsed < maxRuns", to: "retryable !== false && runsUsed < maxRuns" },
  { kind: "unit", name: "one resubmit too many (runsUsed <= maxRuns)", file: POL, from: "runsUsed < maxRuns", to: "runsUsed <= maxRuns" },
  { kind: "unit", name: "backoff has no cap", file: POL, from: "const exp = Math.min(p.maxDelayMs, p.initialDelayMs * Math.pow(p.factor, Math.max(0, step)));", to: "const exp = p.initialDelayMs * Math.pow(p.factor, Math.max(0, step));" },
  { kind: "unit", name: "jitter pushes the wait above the exponential value", file: POL, from: "exp * (1 - p.jitter * r)", to: "exp * (1 + p.jitter * r)" },
  { kind: "unit", name: "backoff never grows", file: POL, from: "Math.pow(p.factor, Math.max(0, step))", to: "Math.pow(p.factor, 0)" },
  { kind: "unit", name: "ThrottlingException is not transient", file: POL, from: '  "ThrottlingException",\n', to: "" },
  { kind: "unit", name: "a 500 is not transient (> 500)", file: POL, from: "status >= 500", to: "status > 500" },
  { kind: "unit", name: "a dropped connection is not transient", file: POL, from: "if (e.code && TRANSIENT_NETWORK.has(e.code)) return true;", to: "" },
  { kind: "unit", name: "a repeated NextToken is not noticed", file: POL, from: "if (nextToken === previousToken) return { action: \"stuck\" };", to: "" },
  { kind: "unit", name: "the row cap is checked one row late", file: POL, from: "if (rowsSoFar >= maxRows) return { action: \"done\" };", to: "if (rowsSoFar > maxRows) return { action: \"done\" };" },
  { kind: "unit", name: "the header is skipped for every statement type", file: POL, from: 'if (!firstPage || statementType !== "DML" || !firstRow) return false;', to: "if (!firstPage || !firstRow) return false;" },
  { kind: "unit", name: "the header is skipped on every page", file: POL, from: 'if (!firstPage || statementType !== "DML" || !firstRow) return false;', to: 'if (statementType !== "DML" || !firstRow) return false;' },
  { kind: "unit", name: "the header is skipped without comparing it to the labels", file: POL, from: "return firstRow.length === labels.length && firstRow.every((v, i) => v === labels[i]);", to: "return true;" },
  { kind: "unit", name: "page size 1001 is accepted", file: POL, from: "n > MAX_PAGE_SIZE", to: "n > MAX_PAGE_SIZE + 1" },
  { kind: "unit", name: "a null cell becomes an empty string", file: CLI, from: "d?.VarCharValue ?? null", to: 'd?.VarCharValue ?? ""' },
  { kind: "unit", name: "every Start attempt gets a new token", file: CLI, from: "ClientRequestToken: token,", to: "ClientRequestToken: randomUUID()," },
  { kind: "unit", name: "a timeout does not stop the query", file: CLI, from: "        await this.stopQuietly(id);\n", to: "" },
  { kind: "unit", name: "the page size is not sent", file: CLI, from: "MaxResults: s.pageSize, ", to: "" },
  { kind: "unit", name: "the next page does not send the token", file: CLI, from: "...(token ? { NextToken: token } : {})", to: "" },
  { kind: "unit", name: "the workgroup is not sent", file: CLI, from: "WorkGroup: s.workGroup,", to: "" },
  { kind: "unit", name: "the SDK's own retries are left on", file: CLI, from: "new AthenaClient({ maxAttempts: 1, ...config })", to: "new AthenaClient({ ...config })" },
  { kind: "unit", name: "a cancelled query is reported as a failure", file: CLI, from: "throw new AthenaQueryCancelledError(", to: "throw new AthenaQueryFailedError(" },
  { kind: "unit", name: "the wait is not clamped to the time left", file: CLI, from: "Math.min(backoffDelayMs(poll, s.poll, this.deps.random), remaining)", to: "backoffDelayMs(poll, s.poll, this.deps.random)" },
  { kind: "unit", name: "an unknown state is waited on", file: CLI, from: 'if (kind === "unknown") {', to: 'if (kind === "unknown" && false) {' },
  { kind: "unit", name: "a day that does not exist is accepted", file: LAKE, from: " || dayOf(parsed) !== value", to: "" },
  { kind: "unit", name: "a batch spanning midnight lands all in the first day", file: LAKE, from: "const day = dayOf(new Date(e.eventTime));", to: "const day = dayOf(new Date(events[0].eventTime));" },
  { kind: "unit", name: "the duration column is written in camelCase", file: LAKE, from: "duration_ms: e.durationMs,", to: "durationMs: e.durationMs," },
  { kind: "unit", name: "an uppercase identifier is accepted", file: LAKE, from: "const IDENT = /^[a-z][a-z0-9_]{0,63}$/;", to: "const IDENT = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;" },
  { kind: "unit", name: "the events prefix changes", file: LAKE, from: 'EVENTS_PREFIX = "events/"', to: 'EVENTS_PREFIX = "lake/"' },
  { kind: "unit", name: "a reversed day range is accepted", file: LAKE, from: 'if (from > to) throw new RangeError("fromDay is after toDay");', to: "" },

  { kind: "unit", name: "the Iceberg DDL gets the EXTERNAL keyword", file: LAKE, from: "`CREATE TABLE ${ident(database)}", to: "`CREATE EXTERNAL TABLE ${ident(database)}" },
  { kind: "unit", name: "the Iceberg DDL loses its table_type property", file: LAKE, from: `"TBLPROPERTIES ('table_type' = 'ICEBERG')"`, to: `"TBLPROPERTIES ('classification' = 'json')"` },
  { kind: "unit", name: "the Iceberg table is not partitioned by day", file: LAKE, from: 'PARTITIONED BY (day(event_time))', to: 'PARTITIONED BY (event_time)' },
  { kind: "unit", name: "the Iceberg table location leaves the iceberg/ prefix", file: LAKE, from: "${ICEBERG_PREFIX}${ident(table)}/", to: "${EVENTS_PREFIX}${ident(table)}/" },
  { kind: "unit", name: "the day copy drops its dt filter", file: LAKE, from: "`WHERE dt = '${d}'`", to: '"WHERE 1 = 1"' },
  { kind: "unit", name: "the day copy stops casting the timestamp", file: LAKE, from: "CAST(from_iso8601_timestamp(event_time) AS timestamp)", to: "event_time" },
  { kind: "unit", name: "the day copy accepts a day that does not exist", file: LAKE, from: "const d = assertDay(day);", to: "const d = day;" },
  { kind: "terraform", name: "the policy may delete files in the lake", file: MAIN, from: 'Action   = ["s3:GetObject", "s3:PutObject", "s3:AbortMultipartUpload"]\n        Resource = "${local.lake_arn}/${local.iceberg_prefix}*"', to: 'Action   = ["s3:GetObject", "s3:PutObject", "s3:AbortMultipartUpload", "s3:DeleteObject"]\n        Resource = "${local.lake_arn}/${local.iceberg_prefix}*"' },
  { kind: "terraform", name: "Iceberg writes widened to the whole lake bucket", file: MAIN, from: 'Resource = "${local.lake_arn}/${local.iceberg_prefix}*"', to: 'Resource = "${local.lake_arn}/*"' },
  { kind: "terraform", name: "the Iceberg table can no longer be updated", file: MAIN, from: '"glue:CreateTable", "glue:UpdateTable"', to: '"glue:CreateTable"' },
  { kind: "terraform", name: "listing the lake loses the iceberg/ prefix", file: MAIN, from: '["${var.events_prefix}*", "${local.iceberg_prefix}*"]', to: '["${var.events_prefix}*"]' },
  { kind: "terraform", name: "lake encryption changed from AES256", file: MAIN, from: 'resource "aws_s3_bucket_server_side_encryption_configuration" "lake" {\n  bucket = aws_s3_bucket.lake.id\n\n  rule {\n    apply_server_side_encryption_by_default {\n      sse_algorithm = "AES256"', to: 'resource "aws_s3_bucket_server_side_encryption_configuration" "lake" {\n  bucket = aws_s3_bucket.lake.id\n\n  rule {\n    apply_server_side_encryption_by_default {\n      sse_algorithm = "aws:kms"' },
  { kind: "terraform", name: "results bucket allows public policies", file: MAIN, from: 'resource "aws_s3_bucket_public_access_block" "results" {\n  bucket = aws_s3_bucket.results.id\n\n  block_public_acls       = true\n  block_public_policy     = true', to: 'resource "aws_s3_bucket_public_access_block" "results" {\n  bucket = aws_s3_bucket.results.id\n\n  block_public_acls       = true\n  block_public_policy     = false' },
  { kind: "terraform", name: "query results never expire (lifecycle disabled)", file: MAIN, from: 'id     = "expire-query-results"\n    status = "Enabled"', to: 'id     = "expire-query-results"\n    status = "Disabled"' },
  { kind: "terraform", name: "event lifecycle widened to the whole bucket", file: MAIN, from: "      prefix = var.events_prefix\n    }\n\n    expiration {\n      days = var.events_expiry_days", to: '      prefix = ""\n    }\n\n    expiration {\n      days = var.events_expiry_days' },
  { kind: "terraform", name: "partition projection turned off", file: MAIN, from: '"projection.enabled"          = "true"', to: '"projection.enabled"          = "false"' },
  { kind: "terraform", name: "projection range stops at a fixed day", file: MAIN, from: '"${var.projection_start_day},NOW"', to: '"${var.projection_start_day},2026-12-31"' },
  { kind: "terraform", name: "projected location uses date= instead of dt=", file: MAIN, from: "${var.events_prefix}dt=$${dt}/", to: "${var.events_prefix}date=$${dt}/" },
  { kind: "terraform", name: "table uses another JSON SerDe", file: MAIN, from: "org.apache.hive.hcatalog.data.JsonSerDe", to: "org.openx.data.jsonserde.JsonSerDe" },
  { kind: "terraform", name: "duration_ms column becomes a string", file: MAIN, from: 'name = "duration_ms"\n      type = "bigint"', to: 'name = "duration_ms"\n      type = "string"' },
  { kind: "terraform", name: "the status column is dropped", file: MAIN, from: '    columns {\n      name = "status"\n      type = "string"\n    }\n', to: "" },
  { kind: "terraform", name: "the workgroup stops overriding client settings", file: MAIN, from: "enforce_workgroup_configuration    = true", to: "enforce_workgroup_configuration    = false" },
  { kind: "terraform", name: "the scan cutoff is removed", file: MAIN, from: "    bytes_scanned_cutoff_per_query     = var.bytes_scanned_cutoff\n", to: "" },
  { kind: "terraform", name: "results are no longer encrypted", file: MAIN, from: 'encryption_option = "SSE_S3"', to: 'encryption_option = "CSE_KMS"' },
  { kind: "terraform", name: "results go to the lake bucket", file: MAIN, from: 'output_location = "s3://${aws_s3_bucket.results.bucket}/${local.results_prefix}"', to: 'output_location = "s3://${aws_s3_bucket.lake.bucket}/${local.results_prefix}"' },
  { kind: "terraform", name: "the policy may write to the events prefix", file: MAIN, from: 'Action   = ["s3:GetObject"]', to: 'Action   = ["s3:GetObject", "s3:PutObject"]' },
  { kind: "terraform", name: "the policy reads the whole lake bucket", file: MAIN, from: 'Resource = "${local.lake_arn}/${var.events_prefix}*"', to: 'Resource = "${local.lake_arn}/*"' },
  { kind: "terraform", name: "Athena actions allowed on every workgroup", file: MAIN, from: "Resource = local.athena_arn", to: 'Resource = "*"' },
  { kind: "terraform", name: "a wildcard Glue action is added", file: MAIN, from: '"glue:GetPartitions"]', to: '"glue:Get*"]' },
  { kind: "terraform", name: "GetBucketLocation gets the prefix condition back", file: MAIN, from: 'Action   = ["s3:GetBucketLocation"]\n        Resource = [local.lake_arn, local.results_arn]', to: 'Action   = ["s3:GetBucketLocation"]\n        Resource = [local.lake_arn, local.results_arn]\n        Condition = { StringLike = { "s3:prefix" = ["queries/*"] } }' },
  { kind: "terraform", name: "the name_prefix check accepts a dash", file: "deploy/athena/variables.tf", from: '"^[a-z][a-z0-9]{0,30}$"', to: '"^[a-z][a-z0-9-]{0,30}$"' },
];

function scratch(mutant) {
  const dir = mkdtempSync(join(tmpdir(), "athena-mutant-"));
  const keep = (src) => !/[\\/](\.terraform|node_modules)([\\/]|$)|\.tfstate|\.tfplan/.test(src);
  for (const sub of ["backend/src", "backend/tests", "backend/package.json", "backend/tsconfig.json", "deploy/athena"]) {
    cpSync(join(root, sub), join(dir, sub), { recursive: true, filter: keep });
  }
  symlinkSync(join(root, "backend", "node_modules"), join(dir, "backend", "node_modules"), "junction");
  if (mutant) {
    const path = join(dir, mutant.file);
    const text = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
    if (!text.includes(mutant.from)) throw new Error(`mutation target not found in ${mutant.file}: ${mutant.from}`);
    writeFileSync(path, text.replace(mutant.from, mutant.to));
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
  return spawnSync(`npx tsx tests/${script}`, { cwd: join(dir, "backend"), env, shell: true, encoding: "utf8", maxBuffer: 1 << 26, timeout: 240000 });
}

function run(kind, dir) {
  const env = { ...process.env, TF_DATA_DIR: tfData, TF_DIR: join(dir, "deploy", "athena"), AWS_ACCESS_KEY_ID: "test", AWS_SECRET_ACCESS_KEY: "test" };
  if (kind === "terraform") return [runScript(dir, "test-athena-terraform.ts", env)];
  // stop at the first red script, so a mutant is attributed to the first test that notices it
  const first = runScript(dir, "test-athena-logic.ts", env);
  if (first.status !== 0) return [first];
  return [first, runScript(dir, "test-athena.ts", env)];
}

const want = process.argv[2] ?? "all";
const kinds = want === "all" ? ["unit", "terraform"] : [want];
let caught = 0;
let total = 0;
let harnessProblems = 0;
for (const kind of kinds) {
  // The unmutated copy must pass first, or a "caught" mutant could just be a broken harness
  {
    const dir = scratch(null);
    const results = run(kind, dir);
    cleanup(dir);
    const ok = results.every((r) => r.status === 0);
    console.log(`${ok ? "BASELINE PASS" : "BASELINE FAIL"}  ${kind} tests on the unmutated copy`);
    if (!ok) {
      harnessProblems++;
      console.log(String(results.at(-1).stdout).slice(-1500));
      continue;
    }
  }
  for (const m of mutants.filter((x) => x.kind === kind)) {
    total++;
    const dir = scratch(m);
    const results = run(kind, dir);
    const r = results.at(-1);
    const out = `${r.stdout}\n${r.stderr}`;
    // Only a failing check line counts, so a broken harness (a missing tool, a crash) cannot pass as a catch
    const failing = out.split("\n").filter((l) => /^FAIL  /.test(l)).slice(0, 2).map((l) => l.trim());
    const red = r.status !== 0 && failing.length > 0;
    if (red) caught++;
    console.log(`${red ? "CAUGHT" : "SURVIVED"}  [${kind}] ${m.name}${failing.length ? `\n          first red: ${failing.join(" | ")}` : `\n          no failing check line, last output: ${out.trim().split("\n").slice(-6).join(" / ")}`}`);
    cleanup(dir);
  }
}
console.log(`\nmutants caught: ${caught} of ${total}${harnessProblems ? ` (${harnessProblems} baseline problem(s))` : ""}`);
process.exit(caught === total && harnessProblems === 0 ? 0 : 1);
