// LIFESPAN: permanent
// Mutation check for the AWS S3 archive target. Each mutant breaks one rule in a scratch copy of the repo
// and the matching test must go red; the real files are never touched.
//   unit       provider switch (backend/src/config/archiveTarget.ts)   -> npm run test:archive-provider
//   terraform  encryption, versioning, public access block, lifecycle,
//              IAM policy scope, names (deploy/aws)                    -> npm run test:aws-terraform (plan JSON)
//   emulator   policy and lifecycle changes applied to moto            -> deploy/aws/emulator-proof.sh (needs moto
//              on MOTO_URL, default http://localhost:5000, and Redis on REDIS_URL; about 2 minutes each)
// Run: node scripts/mutation-check-aws.mjs [unit|terraform|emulator|all]
import { cpSync, mkdtempSync, readFileSync, rmSync, rmdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tfData = join(root, "deploy", "aws", ".terraform");
const ARCH = "backend/src/config/archiveTarget.ts";

const mutants = [
  { kind: "unit", name: "default provider flips from r2 to s3", file: ARCH, from: 'if (value === "" || value === "r2") return "r2";', to: 'if (value === "") return "s3";\n  if (value === "r2") return "r2";' },
  { kind: "unit", name: "ARCHIVE_PROVIDER=s3 selects r2", file: ARCH, from: 'if (value === "s3") return "s3";', to: 'if (value === "s3") return "r2";' },
  { kind: "unit", name: "a bad ARCHIVE_PROVIDER is accepted", file: ARCH, from: "throw new Error(`ARCHIVE_PROVIDER must be", to: 'return "r2"; throw new Error(`ARCHIVE_PROVIDER must be' },
  { kind: "unit", name: "the s3 endpoint override is dropped", file: ARCH, from: "...(endpoint ? { endpoint, forcePathStyle: true } : {}),", to: "...{}," },
  { kind: "unit", name: "the s3 region is ignored", file: ARCH, from: 'region: vars.AWS_REGION || vars.AWS_DEFAULT_REGION || "us-east-1",', to: 'region: "us-east-1",' },
  { kind: "unit", name: "s3 reports enabled without a bucket", file: ARCH, from: "enabled: !!vars.AWS_S3_BUCKET_NAME,", to: "enabled: true," },
  { kind: "unit", name: "the archive prefix changes", file: ARCH, from: 'ARCHIVE_PREFIX = "executions/"', to: 'ARCHIVE_PREFIX = "archives/"' },

  { kind: "terraform", name: "encryption algorithm changed from AES256", file: "deploy/aws/main.tf", from: 'sse_algorithm = "AES256"', to: 'sse_algorithm = "aws:kms"' },
  { kind: "terraform", name: "versioning set to Suspended", file: "deploy/aws/main.tf", from: 'status = "Enabled"\n  }\n}\n\nresource "aws_s3_bucket_server_side', to: 'status = "Suspended"\n  }\n}\n\nresource "aws_s3_bucket_server_side' },
  { kind: "terraform", name: "block_public_policy turned off", file: "deploy/aws/main.tf", from: "block_public_policy     = true", to: "block_public_policy     = false" },
  { kind: "terraform", name: "lifecycle rule disabled", file: "deploy/aws/main.tf", from: 'id     = "expire-run-archives"\n    status = "Enabled"', to: 'id     = "expire-run-archives"\n    status = "Disabled"' },
  { kind: "terraform", name: "lifecycle expiry default changed to 365 days", file: "deploy/aws/variables.tf", from: "default     = 90", to: "default     = 365" },
  { kind: "terraform", name: "lifecycle filter widened to the whole bucket", file: "deploy/aws/main.tf", from: "      prefix = var.archive_prefix", to: '      prefix = ""' },
  { kind: "terraform", name: "IAM object access widened to the whole bucket", file: "deploy/aws/main.tf", from: '"${local.bucket_arn}/${var.archive_prefix}*"', to: '"${local.bucket_arn}/*"' },
  { kind: "terraform", name: "list prefix condition removed", file: "deploy/aws/main.tf", from: 'Condition = {\n          StringLike = { "s3:prefix" = ["${var.archive_prefix}*"] }\n        }\n', to: "" },
  { kind: "terraform", name: "wildcard action added to the policy", file: "deploy/aws/main.tf", from: '"s3:DeleteObjectVersion"]', to: '"s3:*"]' },
  { kind: "terraform", name: "resource names stop using the autoflow- prefix", file: "deploy/aws/variables.tf", from: 'default     = "autoflow-archive"', to: 'default     = "archive"' },

  { kind: "emulator", name: "applied IAM policy widened to the whole bucket", file: "deploy/aws/main.tf", from: '"${local.bucket_arn}/${var.archive_prefix}*"', to: '"${local.bucket_arn}/*"' },
  { kind: "emulator", name: "applied IAM policy without DeleteObjectVersion", file: "deploy/aws/main.tf", from: ', "s3:DeleteObjectVersion"]', to: "]" },
  { kind: "emulator", name: "applied lifecycle filter widened to the whole bucket", file: "deploy/aws/main.tf", from: "      prefix = var.archive_prefix", to: '      prefix = ""' },
];

function scratch(mutant) {
  const dir = mkdtempSync(join(tmpdir(), "aws-mutant-"));
  const keep = (src) => !/[\\/](\.terraform|node_modules)([\\/]|$)|\.tfstate|\.tfplan/.test(src);
  for (const sub of ["backend/src", "backend/tests", "backend/package.json", "backend/tsconfig.json", "deploy/aws"]) {
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

function run(kind, dir) {
  const env = { ...process.env, TF_DATA_DIR: tfData, TF_DIR: join(dir, "deploy", "aws"), AWS_ACCESS_KEY_ID: "test", AWS_SECRET_ACCESS_KEY: "test" };
  if (kind === "unit") return spawnSync("npx tsx tests/test-archive-provider.ts", { cwd: join(dir, "backend"), env, shell: true, encoding: "utf8", maxBuffer: 1 << 26 });
  if (kind === "terraform") return spawnSync("npx tsx tests/test-aws-terraform.ts", { cwd: join(dir, "backend"), env, shell: true, encoding: "utf8", maxBuffer: 1 << 26 });
  return spawnSync("bash", ["deploy/aws/emulator-proof.sh"], { cwd: dir, env, encoding: "utf8", maxBuffer: 1 << 26, timeout: 540000 });
}

const want = process.argv[2] ?? "all";
const kinds = want === "all" ? ["unit", "terraform", "emulator"] : [want];
let caught = 0;
let total = 0;
let harnessProblems = 0;
for (const kind of kinds) {
  // The unmutated copy must pass first, or a "caught" mutant could just be a broken harness
  if (kind !== "emulator") {
    const dir = scratch(null);
    const base = run(kind, dir);
    cleanup(dir);
    console.log(`${base.status === 0 ? "BASELINE PASS" : "BASELINE FAIL"}  ${kind} tests on the unmutated copy`);
    if (base.status !== 0) {
      harnessProblems++;
      console.log(String(base.stdout).slice(-1500));
      continue;
    }
  }
  for (const m of mutants.filter((x) => x.kind === kind)) {
    total++;
    const dir = scratch(m);
    const r = run(kind, dir);
    const out = `${r.stdout}\n${r.stderr}`;
    // Only a failing check line counts, so a broken harness (a leftover bucket, a missing tool) cannot pass as a catch
    const failing = out.split("\n").filter((l) => /^FAIL  /.test(l)).slice(0, 2).map((l) => l.trim());
    const red = r.status !== 0 && failing.length > 0;
    if (red) caught++;
    console.log(`${red ? "CAUGHT" : "SURVIVED"}  [${kind}] ${m.name}${failing.length ? `\n          first red: ${failing.join(" | ")}` : `\n          no failing check line, last output: ${out.trim().split("\n").slice(-6).join(" / ")}`}`);
    cleanup(dir);
  }
}
console.log(`\nmutants caught: ${caught} of ${total}${harnessProblems ? ` (${harnessProblems} baseline problem(s))` : ""}`);
process.exit(caught === total && harnessProblems === 0 ? 0 : 1);
