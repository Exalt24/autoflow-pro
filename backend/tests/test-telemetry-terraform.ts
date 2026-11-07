// LIFESPAN: permanent
// Guards deploy/athena/telemetry.tf: terraform fmt, init, validate, an offline plan (dummy credentials, no AWS call,
// nothing applied), then rules on the plan JSON, and cross-checks between the Glue tables and the code that writes the
// files (column names, types and order, partition keys, the projected locations). Needs terraform on PATH
// (REQUIRE_TERRAFORM=1 makes a missing install a failure). TF_DIR points it at a scratch copy for the mutation checks.
// Run: npm run test:telemetry-terraform
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PARTITION_TEMPLATES, QUARANTINE_COLUMNS, READING_COLUMNS, TELEMETRY_PREFIX } from "../src/telemetry/lake.js";
import { ROLLUP_COLUMNS } from "../src/telemetry/rollup.js";

const here = dirname(fileURLToPath(import.meta.url));
const dir = process.env.TF_DIR ?? resolve(here, "../../deploy/athena");
const strict = process.env.REQUIRE_TERRAFORM === "1";
const scratch = mkdtempSync(join(tmpdir(), "tf-telemetry-"));
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
const planJson = (extra: string[], name: string) => {
  const file = join(scratch, `${name}.tfplan`);
  const plan = tf(["plan", ...ARGS, ...extra, `-state=${join(scratch, `${name}.tfstate`)}`, `-out=${file}`]);
  if (!plan.ok) return { ok: false, out: plan.out, resources: [] as any[] };
  const shown = tf(["show", "-json", file]);
  return { ok: true, out: "", resources: JSON.parse(shown.out).planned_values.root_module.resources as any[] };
};

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

    check("a telemetry_prefix with no trailing slash is refused", !tf(["plan", ...ARGS, "-var", "telemetry_prefix=telemetry", `-state=${join(scratch, "a.tfstate")}`]).ok);
    check("a telemetry_prefix with capitals or a leading slash is refused", !tf(["plan", ...ARGS, "-var", "telemetry_prefix=Telemetry/", `-state=${join(scratch, "b.tfstate")}`]).ok && !tf(["plan", ...ARGS, "-var", "telemetry_prefix=/telemetry/", `-state=${join(scratch, "c.tfstate")}`]).ok);

    const base = planJson([], "base");
    check("offline terraform plan runs with dummy credentials", base.ok, base.out.slice(-600));
    if (base.ok) {
      const resources = base.resources;
      const ofType = (t: string) => resources.filter((r) => r.type === t);
      const byName = (t: string, n: string) => resources.find((r) => r.type === t && r.name === n)?.values ?? {};
      const lake = byName("aws_s3_bucket", "lake").bucket as string;

      check("the plan now creates 18 resources: the 12 Athena ones plus 4 telemetry tables and 2 telemetry policies", resources.length === 18 && resources.filter((r) => String(r.name).startsWith("telemetry_")).length === 6, `got ${resources.length}`);
      check("the four telemetry tables are in the existing events database", ["telemetry_readings", "telemetry_rollup_5m", "telemetry_rollup_1h", "telemetry_quarantine"].every((n) => byName("aws_glue_catalog_table", n).database_name === "autoflow_events" && byName("aws_glue_catalog_table", n).table_type === "EXTERNAL_TABLE"));

      const specs = [
        { name: "telemetry_readings", template: PARTITION_TEMPLATES.readings, columns: READING_COLUMNS, keys: ["asset", "dt", "hour"], folder: "readings/" },
        { name: "telemetry_rollup_5m", template: PARTITION_TEMPLATES.rollup_5m, columns: ROLLUP_COLUMNS, keys: ["asset", "dt"], folder: "rollups_5m/" },
        { name: "telemetry_rollup_1h", template: PARTITION_TEMPLATES.rollup_1h, columns: ROLLUP_COLUMNS, keys: ["asset", "dt"], folder: "rollups_1h/" },
        { name: "telemetry_quarantine", template: PARTITION_TEMPLATES.quarantine, columns: QUARANTINE_COLUMNS, keys: ["dt"], folder: "quarantine/" },
      ];
      for (const spec of specs) {
        const t = byName("aws_glue_catalog_table", spec.name);
        const sd = t.storage_descriptor?.[0] ?? {};
        const params = t.parameters ?? {};
        const cols: { name: string; type: string }[] = sd.columns ?? [];
        check(`${spec.name}: columns are exactly the ones the code writes, same names, types and order`, JSON.stringify(cols.map((c) => [c.name, c.type])) === JSON.stringify(spec.columns.map((c) => [c.name, c.type])), JSON.stringify(cols.map((c) => c.name)));
        check(`${spec.name}: partition keys are ${spec.keys.join(", ")} as strings, and none of them is also a data column`, JSON.stringify((t.partition_keys ?? []).map((k: any) => [k.name, k.type])) === JSON.stringify(spec.keys.map((k) => [k, "string"])) && spec.keys.every((k) => !cols.some((c) => c.name === k)));
        const want = `s3://${lake}/${spec.template.replace(/\{(\w+)\}/g, "${$1}")}`;
        check(`${spec.name}: the projected location is the path the writer uses (${spec.template})`, params["storage.location.template"] === want, `${params["storage.location.template"]} vs ${want}`);
        check(`${spec.name}: the table location is the folder, the SerDe reads one JSON document per line`, sd.location === `s3://${lake}/${TELEMETRY_PREFIX}${spec.folder}` && sd.ser_de_info?.[0]?.serialization_library === "org.apache.hive.hcatalog.data.JsonSerDe" && sd.input_format === "org.apache.hadoop.mapred.TextInputFormat" && params.classification === "json");
        check(`${spec.name}: every partition key in the template is a partition key of the table, in the same order`, JSON.stringify([...spec.template.matchAll(/\{(\w+)\}/g)].map((m) => m[1])) === JSON.stringify(spec.keys));
        check(`${spec.name}: dt is a projected date, yyyy-MM-dd, daily, from the start day to NOW`, params["projection.enabled"] === "true" && params["projection.dt.type"] === "date" && params["projection.dt.format"] === "yyyy-MM-dd" && params["projection.dt.range"] === "2026-01-01,NOW" && params["projection.dt.interval"] === "1" && params["projection.dt.interval.unit"] === "DAYS", JSON.stringify(params));
        check(`${spec.name}: ${spec.keys.includes("asset") ? "asset is an injected projection (a query must name the asset)" : "there is no asset projection"}`, spec.keys.includes("asset") ? params["projection.asset.type"] === "injected" : params["projection.asset.type"] === undefined);
      }
      const hourParams = byName("aws_glue_catalog_table", "telemetry_readings").parameters ?? {};
      check("telemetry_readings: hour is a projected integer from 0 to 23 padded to 2 digits, so it matches hour=00 to hour=23", hourParams["projection.hour.type"] === "integer" && hourParams["projection.hour.range"] === "0,23" && hourParams["projection.hour.digits"] === "2");
      check("the existing run_events table is unchanged by the telemetry tables (still projected over events/, no asset or hour keys)", byName("aws_glue_catalog_table", "run_events").partition_keys?.length === 1 && byName("aws_glue_catalog_table", "run_events").parameters?.["storage.location.template"] === `s3://${lake}/events/dt=\${dt}/`);

      const rules: any[] = byName("aws_s3_bucket_lifecycle_configuration", "lake").rule ?? [];
      const tele = rules.find((r) => r.id === "expire-telemetry");
      check("the lake expires telemetry files after 400 days, under telemetry/ only", rules.length === 2 && tele?.status === "Enabled" && tele?.expiration?.[0]?.days === 400 && tele?.filter?.[0]?.prefix === TELEMETRY_PREFIX, JSON.stringify(tele));
      check("the events rule is still the first rule and still limited to events/", rules[0]?.id === "expire-run-events" && rules[0]?.filter?.[0]?.prefix === "events/" && rules[0]?.expiration?.[0]?.days === 365);

      const statements = (n: string): any[] => {
        const p = byName("aws_iam_policy", n).policy;
        return p ? [].concat(JSON.parse(p).Statement) : [];
      };
      const tableArns = ["catalog", "database/autoflow_events", "table/autoflow_events/telemetry_readings", "table/autoflow_events/telemetry_rollup_5m", "table/autoflow_events/telemetry_rollup_1h", "table/autoflow_events/telemetry_quarantine"].map((x) => `arn:aws:glue:ap-southeast-2:123456789012:${x}`);
      const rd = statements("telemetry_read");
      const wr = statements("telemetry_write");
      const actions = (st: any[]) => st.flatMap((s) => [].concat(s.Action));
      const find = (st: any[], sid: string) => st.find((s) => s.Sid === sid);
      check("telemetry_read has no wildcard action and no write or delete action", rd.length === 3 && actions(rd).every((a: string) => !a.includes("*") && !/Put|Delete|Abort|Create|Update/.test(a)), JSON.stringify(actions(rd)));
      check("telemetry_read sees the four telemetry tables, the database and the catalog, and nothing else in Glue", JSON.stringify(find(rd, "ReadTheTelemetryTables")?.Resource) === JSON.stringify(tableArns) && JSON.stringify(find(rd, "ReadTheTelemetryTables")?.Action) === '["glue:GetDatabase","glue:GetTable","glue:GetPartitions"]');
      check("telemetry_read reads objects under telemetry/ only and lists only with that prefix", find(rd, "ReadTheTelemetryFiles")?.Resource === `arn:aws:s3:::${lake}/telemetry/*` && JSON.stringify(find(rd, "ReadTheTelemetryFiles")?.Action) === '["s3:GetObject"]' && JSON.stringify(find(rd, "ListTheTelemetryFiles")?.Condition) === '{"StringLike":{"s3:prefix":["telemetry/*"]}}');
      check("telemetry_write may put (and abort a multipart upload) only under telemetry/, and has no delete anywhere", JSON.stringify(find(wr, "WriteTheTelemetryFiles")?.Action) === '["s3:PutObject","s3:AbortMultipartUpload"]' && find(wr, "WriteTheTelemetryFiles")?.Resource === `arn:aws:s3:::${lake}/telemetry/*` && actions(wr).every((a: string) => !/Delete/.test(a) && !a.includes("*")));
      check("telemetry_write reads back only under telemetry/ (the worker rebuilds from the lake) and lists only with that prefix", find(wr, "ReadBackTheTelemetryFiles")?.Resource === `arn:aws:s3:::${lake}/telemetry/*` && JSON.stringify(find(wr, "ListTheTelemetryFiles")?.Condition) === '{"StringLike":{"s3:prefix":["telemetry/*"]}}' && wr.length === 3);
      check("neither policy reaches the events, iceberg or query results files, or the results bucket", [...rd, ...wr].every((s) => !JSON.stringify(s).includes("/events/") && !JSON.stringify(s).includes("iceberg") && !JSON.stringify(s).includes("athena-results")));
      check("the existing query policy is untouched: it still has no telemetry in it", !JSON.stringify(byName("aws_iam_policy", "query").policy).includes("telemetry"));

      // the prefix is one variable that moves the tables, the policies and the lifecycle rule together
      const moved = planJson(["-var", "telemetry_prefix=fleet/"], "moved");
      if (moved.ok) {
        const mv = (t: string, n: string) => moved.resources.find((r) => r.type === t && r.name === n)?.values ?? {};
        check("changing telemetry_prefix moves the table locations, the policies and the lifecycle rule together", mv("aws_glue_catalog_table", "telemetry_readings").parameters?.["storage.location.template"]?.includes("/fleet/readings/") && mv("aws_glue_catalog_table", "telemetry_quarantine").storage_descriptor?.[0]?.location?.endsWith("/fleet/quarantine/") && String(mv("aws_iam_policy", "telemetry_write").policy).includes("/fleet/*") && !String(mv("aws_iam_policy", "telemetry_write").policy).includes("telemetry/") && (mv("aws_s3_bucket_lifecycle_configuration", "lake").rule ?? []).some((r: any) => r.filter?.[0]?.prefix === "fleet/"));
      } else check("a plan with another telemetry_prefix runs", false, moved.out.slice(-400));
    }
  }
} finally {
  try {
    rmSync(scratch, { recursive: true, force: true });
  } catch {}
}

console.log(failed === 0 ? `\nAll ${passed} telemetry Terraform checks passed` : `\n${failed} of ${passed + failed} telemetry Terraform check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
