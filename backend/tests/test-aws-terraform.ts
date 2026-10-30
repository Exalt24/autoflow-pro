// LIFESPAN: permanent
// Checks the Terraform in deploy/aws: `terraform validate`, then a real `terraform plan` whose JSON is
// asserted rule by rule (public access block, versioning, encryption, lifecycle expiry, the IAM policy scoped
// to the archive prefix). It plans only, so it needs no emulator. Set TF_DIR to point it at a scratch copy.
// Run: npm run test:aws-terraform
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dir = process.env.TF_DIR ?? resolve(here, "../../deploy/aws");
const scratch = mkdtempSync(join(tmpdir(), "tf-aws-"));
const env = {
  ...process.env,
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID ?? "test",
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY ?? "test",
  TF_IN_AUTOMATION: "1",
  TF_DATA_DIR: process.env.TF_DATA_DIR ?? join(dir, ".terraform"),
};
const tf = (...args: string[]) => execFileSync("terraform", args, { cwd: dir, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

let failed = 0;
let passed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `\n      ${detail}`}`);
  if (ok) passed++;
  else failed++;
};

try {
  let valid = true;
  try {
    tf("validate", "-no-color");
  } catch (e: any) {
    valid = false;
    console.log(String(e.stdout ?? e.message));
  }
  check("terraform validate passes", valid);
  if (!valid) throw new Error("validate failed");

  const planFile = join(scratch, "plan.tfplan");
  tf("plan", "-no-color", "-input=false", "-lock=false", `-state=${join(scratch, "none.tfstate")}`, "-var-file=emulator.tfvars", "-var", "bucket_suffix=123456789012", `-out=${planFile}`);
  const plan = JSON.parse(tf("show", "-json", planFile));
  const resources: any[] = plan.planned_values.root_module.resources;
  const one = (type: string) => resources.filter((r) => r.type === type);
  const val = (type: string) => one(type)[0]?.values ?? {};

  check("plan creates the bucket", one("aws_s3_bucket").length === 1);
  check("the bucket name starts with autoflow-archive-", /^autoflow-archive-/.test(val("aws_s3_bucket").bucket), val("aws_s3_bucket").bucket);
  check("the IAM user and policy names start with autoflow-", /^autoflow-/.test(val("aws_iam_user").name) && /^autoflow-/.test(val("aws_iam_policy").name), `${val("aws_iam_user").name} ${val("aws_iam_policy").name}`);
  const vars = plan.configuration.root_module.variables;
  check(
    "real-account defaults: no emulator endpoint, no access key, no force destroy, region ap-southeast-2",
    vars.emulator_endpoint.default === "" && vars.create_access_key.default === false && vars.force_destroy.default === false && vars.region.default === "ap-southeast-2",
    JSON.stringify([vars.emulator_endpoint, vars.create_access_key, vars.force_destroy, vars.region]),
  );
  check("plan creates the IAM user and policy attachment", one("aws_iam_user").length === 1 && one("aws_iam_user_policy_attachment").length === 1);

  const pab = val("aws_s3_bucket_public_access_block");
  check(
    "all four public access blocks are true",
    pab.block_public_acls === true && pab.block_public_policy === true && pab.ignore_public_acls === true && pab.restrict_public_buckets === true,
    JSON.stringify(pab),
  );

  check("versioning is Enabled", val("aws_s3_bucket_versioning").versioning_configuration?.[0]?.status === "Enabled");

  const sse = val("aws_s3_bucket_server_side_encryption_configuration").rule?.[0];
  check("server-side encryption is AES256", sse?.apply_server_side_encryption_by_default?.[0]?.sse_algorithm === "AES256", JSON.stringify(sse));

  const rule = val("aws_s3_bucket_lifecycle_configuration").rule?.[0];
  check("the lifecycle rule is Enabled", rule?.status === "Enabled");
  check("the lifecycle rule expires archives after 90 days", rule?.expiration?.[0]?.days === 90, JSON.stringify(rule?.expiration));
  check("the lifecycle rule is limited to the executions/ prefix", rule?.filter?.[0]?.prefix === "executions/", JSON.stringify(rule?.filter));
  check("old object versions expire after 30 days", rule?.noncurrent_version_expiration?.[0]?.noncurrent_days === 30);

  const policy = JSON.parse(val("aws_iam_policy").policy);
  const stmts: any[] = policy.Statement;
  const bucket = val("aws_s3_bucket").bucket;
  const asArray = (x: any) => (Array.isArray(x) ? x : [x]);
  const objects = stmts.find((s) => s.Sid === "ArchiveObjects");
  const listing = stmts.find((s) => s.Sid === "ListArchivePrefix");
  check("the policy has exactly two statements, both Allow", stmts.length === 2 && stmts.every((s) => s.Effect === "Allow"));
  check(
    "object access is limited to the archive prefix of the bucket",
    asArray(objects?.Resource).length === 1 && objects.Resource === `arn:aws:s3:::${bucket}/executions/*`,
    JSON.stringify(objects?.Resource),
  );
  check(
    "object actions are only put, get and delete, with their version forms",
    JSON.stringify([...asArray(objects?.Action)].sort()) === JSON.stringify(["s3:DeleteObject", "s3:DeleteObjectVersion", "s3:GetObject", "s3:GetObjectVersion", "s3:PutObject"]),
    JSON.stringify(objects?.Action),
  );
  check(
    "listing is limited to the archive prefix by a condition",
    listing?.Resource === `arn:aws:s3:::${bucket}` && JSON.stringify(listing?.Condition) === JSON.stringify({ StringLike: { "s3:prefix": ["executions/*"] } }),
    JSON.stringify(listing),
  );
  const flat = JSON.stringify(policy);
  check("no wildcard action and no wildcard resource", !/"s3:\*"|"\*"/.test(flat), flat);

  const policyChange = plan.resource_changes.find((c: any) => c.type === "aws_iam_policy");
  check("the policy is fully known at plan time", policyChange?.change?.after_unknown?.policy !== true);
} catch (e: any) {
  if (!String(e.message).includes("validate failed")) {
    console.log(String(e.stdout ?? e.message));
    failed++;
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log(failed === 0 ? `\nAll ${passed} terraform checks passed` : `\n${failed} of ${passed + failed} terraform checks failed`);
process.exit(failed === 0 ? 0 : 1);
