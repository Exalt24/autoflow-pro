// LIFESPAN: permanent
// Guards the Terraform in deploy/athena: terraform fmt, init, validate, an offline plan (dummy credentials, no AWS
// call, nothing applied), then rules on the plan JSON, and cross-checks between the table and the code that writes
// the files (the column names, the events prefix). Needs terraform on PATH (REQUIRE_TERRAFORM=1 makes a missing
// install a failure). TF_DIR points it at a scratch copy for the mutation checks.
// Run: npm run test:athena-terraform
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EVENTS_PREFIX, ICEBERG_PREFIX, toJsonLines } from "../src/athena/eventLake.js";

const here = dirname(fileURLToPath(import.meta.url));
const dir = process.env.TF_DIR ?? resolve(here, "../../deploy/athena");
const strict = process.env.REQUIRE_TERRAFORM === "1";
const scratch = mkdtempSync(join(tmpdir(), "tf-athena-"));
const env = {
  ...process.env,
  AWS_ACCESS_KEY_ID: "test",
  AWS_SECRET_ACCESS_KEY: "test",
  AWS_REGION: "ap-southeast-2",
  TF_IN_AUTOMATION: "1",
  TF_DATA_DIR: process.env.TF_DATA_DIR ?? join(dir, ".terraform"),
};

let failed = 0;
let passed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `\n      ${detail}`}`);
  if (ok) passed++;
  else failed++;
};

function tf(args: string[]): { ok: boolean; out: string } {
  try {
    return { ok: true, out: execFileSync("terraform", args, { cwd: dir, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (e: any) {
    return { ok: false, out: `${e.stdout ?? ""}${e.stderr ?? ""}` || String(e.message) };
  }
}

const ARGS = ["-no-color", "-input=false", "-lock=false", "-var", "offline_plan=true", "-var", "account_id=123456789012"];

try {
  if (!tf(["version"]).ok) {
    if (strict) check("terraform is installed", false);
    else console.log("SKIP  terraform not found, Terraform checks skipped");
  } else {
    check("terraform fmt -check passes", tf(["fmt", "-check", "-recursive", "-no-color"]).ok);
    const init = tf(["init", "-backend=false", "-input=false", "-no-color"]);
    check("terraform init -backend=false passes", init.ok, init.out.slice(-400));
    const validate = tf(["validate", "-no-color"]);
    check("terraform validate passes", validate.ok, validate.out.slice(-600));

    // variable validations must refuse what the service would refuse
    check("a name_prefix with a dash is refused (Glue names have none)", !tf(["plan", ...ARGS, "-var", "name_prefix=auto-flow", `-state=${join(scratch, "a.tfstate")}`]).ok);
    check("a cutoff below the service minimum is refused", !tf(["plan", ...ARGS, "-var", "bytes_scanned_cutoff=1000", `-state=${join(scratch, "b.tfstate")}`]).ok);
    check("a projection start day that is not a date is refused", !tf(["plan", ...ARGS, "-var", "projection_start_day=last-year", `-state=${join(scratch, "c.tfstate")}`]).ok);

    const planFile = join(scratch, "athena.tfplan");
    const plan = tf(["plan", ...ARGS, `-state=${join(scratch, "none.tfstate")}`, `-out=${planFile}`]);
    check("offline terraform plan runs with dummy credentials", plan.ok, plan.out.slice(-600));
    if (plan.ok) {
      const shown = tf(["show", "-json", planFile]);
      const p = JSON.parse(shown.out);
      const resources: any[] = p.planned_values.root_module.resources;
      const ofType = (t: string) => resources.filter((r) => r.type === t);
      const byName = (t: string, n: string) => resources.find((r) => r.type === t && r.name === n)?.values ?? {};

      check("the plan creates 12 resources: 2 buckets, 2 access blocks, 2 encryption rules, 2 lifecycle rules, a database, a table, a workgroup and a policy", resources.length === 12, `got ${resources.length}`);
      check("the plan creates exactly two buckets, and they are different", ofType("aws_s3_bucket").length === 2 && new Set(ofType("aws_s3_bucket").map((b) => b.values.bucket)).size === 2);
      const lake = byName("aws_s3_bucket", "lake").bucket as string;
      const results = byName("aws_s3_bucket", "results").bucket as string;
      check("bucket names carry the suffix (the account id) so they are unique", lake === "autoflow-lake-123456789012" && results === "autoflow-athena-results-123456789012", `${lake} ${results}`);
      check("both buckets block all public access", ["lake", "results"].every((n) => { const v = byName("aws_s3_bucket_public_access_block", n); return v.block_public_acls && v.block_public_policy && v.ignore_public_acls && v.restrict_public_buckets; }));
      check("both buckets encrypt with AES256", ["lake", "results"].every((n) => byName("aws_s3_bucket_server_side_encryption_configuration", n).rule?.[0]?.apply_server_side_encryption_by_default?.[0]?.sse_algorithm === "AES256"));
      const lakeLife = byName("aws_s3_bucket_lifecycle_configuration", "lake").rule?.[0];
      const resLife = byName("aws_s3_bucket_lifecycle_configuration", "results").rule?.[0];
      check("event files expire after 365 days, under the events prefix only", lakeLife?.status === "Enabled" && lakeLife?.expiration?.[0]?.days === 365 && lakeLife?.filter?.[0]?.prefix === EVENTS_PREFIX, JSON.stringify(lakeLife));
      check("query results expire after 7 days, under the queries prefix only", resLife?.status === "Enabled" && resLife?.expiration?.[0]?.days === 7 && resLife?.filter?.[0]?.prefix === "queries/", JSON.stringify(resLife));

      check("one Glue database named autoflow_events", ofType("aws_glue_catalog_database").length === 1 && byName("aws_glue_catalog_database", "events").name === "autoflow_events");
      const table = byName("aws_glue_catalog_table", "run_events");
      const sd = table.storage_descriptor?.[0] ?? {};
      const tparams = table.parameters ?? {};
      check("the table is external, in that database, over the events prefix of the lake bucket", table.table_type === "EXTERNAL_TABLE" && table.database_name === "autoflow_events" && sd.location === `s3://${lake}/${EVENTS_PREFIX}`, JSON.stringify([table.table_type, sd.location]));
      check("the table reads one JSON document per line with the Hive JSON SerDe", sd.ser_de_info?.[0]?.serialization_library === "org.apache.hive.hcatalog.data.JsonSerDe" && sd.input_format === "org.apache.hadoop.mapred.TextInputFormat" && tparams.classification === "json");
      check("the table has one string partition column dt", table.partition_keys?.length === 1 && table.partition_keys[0].name === "dt" && table.partition_keys[0].type === "string");
      check("partition projection is on for dt: a date column, yyyy-MM-dd, daily, from the start day to NOW", tparams["projection.enabled"] === "true" && tparams["projection.dt.type"] === "date" && tparams["projection.dt.format"] === "yyyy-MM-dd" && tparams["projection.dt.range"] === "2026-01-01,NOW" && tparams["projection.dt.interval"] === "1" && tparams["projection.dt.interval.unit"] === "DAYS", JSON.stringify(tparams));
      check("the projected location is the same path the writer uses: events/dt=<day>/", tparams["storage.location.template"] === `s3://${lake}/${EVENTS_PREFIX}dt=\${dt}/`, tparams["storage.location.template"]);

      // the columns must be the keys the writer produces, in the same type family
      const sample = JSON.parse(toJsonLines([{ executionId: "e", workflowId: "w", userId: "u", status: "completed", durationMs: 1, eventTime: "2026-11-07T00:00:00Z" }]).trim());
      const columns: { name: string; type: string }[] = sd.columns ?? [];
      check("the table columns are exactly the keys toJsonLines writes, in order", columns.map((c) => c.name).join() === Object.keys(sample).join(), `${columns.map((c) => c.name)} vs ${Object.keys(sample)}`);
      check("a number the writer writes is a bigint column and the rest are strings", columns.every((c) => (typeof sample[c.name] === "number" ? c.type === "bigint" : c.type === "string")), JSON.stringify(columns));

      const wg = byName("aws_athena_workgroup", "events");
      const cfg = wg.configuration?.[0] ?? {};
      check("the workgroup is enabled and named autoflow-events", wg.name === "autoflow-events" && wg.state === "ENABLED");
      check("the workgroup's settings override the client's, so a client cannot send results elsewhere", cfg.enforce_workgroup_configuration === true);
      check("query results go to the results bucket under queries/, encrypted SSE_S3", cfg.result_configuration?.[0]?.output_location === `s3://${results}/queries/` && cfg.result_configuration?.[0]?.encryption_configuration?.[0]?.encryption_option === "SSE_S3", JSON.stringify(cfg.result_configuration));
      check("a query may scan at most 10 GiB, and CloudWatch metrics are on", cfg.bytes_scanned_cutoff_per_query === 10737418240 && cfg.publish_cloudwatch_metrics_enabled === true);

      const pol = byName("aws_iam_policy", "query");
      const doc = pol.policy ? JSON.parse(pol.policy) : null;
      const st: any[] = doc ? [].concat(doc.Statement) : [];
      const actions = st.flatMap((s) => [].concat(s.Action));
      check("the query policy has no wildcard action", st.length > 0 && actions.every((a: string) => !a.includes("*")), JSON.stringify(actions));
      const stmt = (sid: string) => st.find((s) => s.Sid === sid);
      check("Athena actions are limited to the one workgroup", JSON.stringify(stmt("RunQueriesInTheWorkgroup")?.Resource) === '"arn:aws:athena:ap-southeast-2:123456789012:workgroup/autoflow-events"' && stmt("RunQueriesInTheWorkgroup")?.Action.length === 4, JSON.stringify(stmt("RunQueriesInTheWorkgroup")));
      check("Glue reads are limited to the catalog, the database and the two tables", JSON.stringify(stmt("ReadTheTable")?.Resource) === '["arn:aws:glue:ap-southeast-2:123456789012:catalog","arn:aws:glue:ap-southeast-2:123456789012:database/autoflow_events","arn:aws:glue:ap-southeast-2:123456789012:table/autoflow_events/run_events","arn:aws:glue:ap-southeast-2:123456789012:table/autoflow_events/run_events_iceberg"]' && stmt("ReadTheTable")?.Action.every((a: string) => a.startsWith("glue:Get")), JSON.stringify(stmt("ReadTheTable")));
      check("the events prefix is read-only: GetObject under events/", JSON.stringify(stmt("ReadTheEvents")?.Action) === '["s3:GetObject"]' && stmt("ReadTheEvents")?.Resource === `arn:aws:s3:::${lake}/${EVENTS_PREFIX}*`, JSON.stringify(stmt("ReadTheEvents")));
      check("listing the lake needs the events/ or the iceberg/ prefix", JSON.stringify(stmt("ListTheEventsAndIceberg")?.Condition) === `{"StringLike":{"s3:prefix":["${EVENTS_PREFIX}*","${ICEBERG_PREFIX}*"]}}`, JSON.stringify(stmt("ListTheEventsAndIceberg")));
      check("creating and updating a Glue table is limited to the one Iceberg table", JSON.stringify(stmt("ManageTheIcebergTable")?.Action) === '["glue:CreateTable","glue:UpdateTable"]' && JSON.stringify(stmt("ManageTheIcebergTable")?.Resource) === '["arn:aws:glue:ap-southeast-2:123456789012:catalog","arn:aws:glue:ap-southeast-2:123456789012:database/autoflow_events","arn:aws:glue:ap-southeast-2:123456789012:table/autoflow_events/run_events_iceberg"]', JSON.stringify(stmt("ManageTheIcebergTable")));
      check("the only lake writes are under iceberg/, and nothing in the policy deletes from the lake bucket", JSON.stringify(stmt("WriteTheIcebergFiles")?.Action) === '["s3:GetObject","s3:PutObject","s3:AbortMultipartUpload"]' && stmt("WriteTheIcebergFiles")?.Resource === `arn:aws:s3:::${lake}/${ICEBERG_PREFIX}*` && st.every((s) => s.Sid === "WriteTheIcebergFiles" || !(JSON.stringify(s.Resource).includes(lake) && [].concat(s.Action).some((a: string) => /Put|Abort/.test(a)))) && st.every((s) => ![].concat(s.Action).some((a: string) => /Delete/.test(a))));
      check("results are written and read under queries/ only", JSON.stringify(stmt("WriteAndReadResults")?.Action) === '["s3:PutObject","s3:GetObject","s3:AbortMultipartUpload"]' && stmt("WriteAndReadResults")?.Resource === `arn:aws:s3:::${results}/queries/*` && JSON.stringify(stmt("ListTheResults")?.Condition) === '{"StringLike":{"s3:prefix":["queries/*"]}}');
      check("GetBucketLocation has no prefix condition (the request carries none) and covers both buckets", JSON.stringify(stmt("FindTheBuckets")?.Action) === '["s3:GetBucketLocation"]' && stmt("FindTheBuckets")?.Condition === undefined && [].concat(stmt("FindTheBuckets")?.Resource).length === 2);
    }
  }
} finally {
  try {
    rmSync(scratch, { recursive: true, force: true });
  } catch {}
}

console.log(failed === 0 ? `\nAll ${passed} Athena Terraform checks passed` : `\n${failed} of ${passed + failed} Athena Terraform check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
