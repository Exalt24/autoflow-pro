// Checks that the GitHub Actions, GitLab CI and Azure Pipelines definitions run the
// same commands in the same folders with the same environment, and that the Azure
// file passes the official Azure Pipelines JSON schema (kept in scripts/schemas).
// Run: npm run test:pipelines
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import Ajv from "ajv";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

type Job = { steps: string[]; env: Record<string, string>; node: string };
type Model = Record<string, Job>;

const nodeMajor = (v: string) => String(v).split(".")[0];

function fromGithub(doc: any): Model {
  const out: Model = {};
  for (const [name, job] of Object.entries<any>(doc.jobs)) {
    const dir = job.defaults?.run?.["working-directory"] ?? ".";
    const steps: string[] = [];
    let node = "";
    for (const s of job.steps) {
      if (s.run) steps.push(`${dir}: ${s.run}`);
      if (String(s.uses ?? "").startsWith("actions/setup-node")) node = nodeMajor(s.with["node-version"]);
    }
    out[name] = { steps, env: job.env ?? {}, node };
  }
  return out;
}

function fromGitlab(doc: any): Model {
  const out: Model = {};
  const node = nodeMajor(String(doc.default.image).split(":")[1]);
  const reserved = new Set(["default", "stages", "variables"]);
  for (const [name, job] of Object.entries<any>(doc)) {
    if (reserved.has(name)) continue;
    let dir = ".";
    const steps: string[] = [];
    for (const line of job.script as string[]) {
      const cd = /^cd (\S+)$/.exec(line);
      if (cd) dir = cd[1];
      else steps.push(`${dir}: ${line}`);
    }
    out[name] = { steps, env: job.variables ?? {}, node };
  }
  return out;
}

function fromAzure(doc: any): Model {
  const out: Model = {};
  for (const job of doc.jobs) {
    const steps: string[] = [];
    let node = "";
    for (const s of job.steps) {
      if (s.script) steps.push(`${s.workingDirectory ?? "."}: ${s.script}`);
      if (String(s.task ?? "").startsWith("NodeTool")) node = nodeMajor(s.inputs.versionSpec);
    }
    out[job.job] = { steps, env: job.variables ?? {}, node };
  }
  return out;
}

export function diff(a: Model, b: Model, label: string): string[] {
  const problems: string[] = [];
  const names = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const n of names) {
    if (!a[n] || !b[n]) {
      problems.push(`${label}: job "${n}" is missing on one side`);
      continue;
    }
    if (JSON.stringify(a[n].steps) !== JSON.stringify(b[n].steps))
      problems.push(`${label}: job "${n}" commands differ: ${JSON.stringify(a[n].steps)} vs ${JSON.stringify(b[n].steps)}`);
    if (JSON.stringify(a[n].env) !== JSON.stringify(b[n].env))
      problems.push(`${label}: job "${n}" environment differs`);
    if (a[n].node !== b[n].node) problems.push(`${label}: job "${n}" Node major differs (${a[n].node} vs ${b[n].node})`);
  }
  return problems;
}

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `\n      ${detail}`}`);
  if (!ok) failed++;
};

const ghAll = fromGithub(parse(read(".github/workflows/ci.yml")));
// Jobs that exist on GitHub Actions only: aws-emulator needs a Redis service and a Terraform install.
const GITHUB_ONLY = ["aws-emulator"];
const gh: Model = Object.fromEntries(Object.entries(ghAll).filter(([name]) => !GITHUB_ONLY.includes(name)));
const gl = fromGitlab(parse(read(".gitlab-ci.yml")));
const azDoc = parse(read("azure-pipelines.yml"));
const az = fromAzure(azDoc);

check("GitHub defines the backend, frontend and pipelines jobs", ["backend", "frontend", "pipelines"].every((j) => gh[j]));
check("GitHub defines the GitHub-only aws-emulator job", GITHUB_ONLY.every((j) => ghAll[j]));
const ghVsGl = diff(gh, gl, "github vs gitlab");
check("GitLab CI runs the same commands as GitHub Actions", ghVsGl.length === 0, ghVsGl.join("\n      "));
const ghVsAz = diff(gh, az, "github vs azure");
check("Azure Pipelines runs the same commands as GitHub Actions", ghVsAz.length === 0, ghVsAz.join("\n      "));

// The comparison itself must notice drift.
const drifted: Model = JSON.parse(JSON.stringify(gl));
drifted.backend.steps[1] = "backend: npm run build -- --noEmit";
check("a changed command in one pipeline is reported", diff(gh, drifted, "probe").length > 0);
const wrongNode: Model = JSON.parse(JSON.stringify(az));
wrongNode.frontend.node = "20";
check("a changed Node version in one pipeline is reported", diff(gh, wrongNode, "probe").length > 0);

const schema = JSON.parse(read("scripts/schemas/azure-pipelines.schema.json"));
const ajv = new Ajv({ strict: false, allErrors: false, unicodeRegExp: false });
const validate = ajv.compile(schema);
const valid = validate(azDoc);
check("azure-pipelines.yml passes the Azure Pipelines JSON schema", valid === true, JSON.stringify(validate.errors?.slice(0, 3)));

const broken = JSON.parse(JSON.stringify(azDoc));
broken.jobs[0].steps[0] = { scrpit: "npm ci" };
check("the schema check rejects a misspelled step key", validate(broken) === false);

console.log(failed === 0 ? "\nAll pipeline checks passed" : `\n${failed} pipeline check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
