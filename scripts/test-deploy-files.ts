// LIFESPAN: permanent
// Guards the Kubernetes deploy files. It runs the real tools and asserts on what they produce:
//   deploy/eks   terraform fmt, validate, an offline plan (dummy credentials, no network), then rules on the plan JSON
//   deploy/helm  helm lint, helm template (EKS values and kind values), rules on the rendered objects, kubeconform
// Plus cross-checks between the two (the IRSA trust subject, the role name) and between the chart and the code (secret keys).
// Needs terraform and helm on PATH; kubeconform too when REQUIRE_DEPLOY_TOOLS=1 (CI sets it).
// Run: npm run test:deploy      TF_DIR / CHART_DIR point it at a scratch copy (used for the mutation checks).
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, parseAllDocuments } from "yaml";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tfDir = process.env.TF_DIR ?? join(root, "deploy/eks");
const chartDir = process.env.CHART_DIR ?? join(root, "deploy/helm/autoflow-pro");
const strict = process.env.REQUIRE_DEPLOY_TOOLS === "1";
const scratch = mkdtempSync(join(tmpdir(), "deploy-check-"));

let failed = 0;
let passed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `\n      ${detail}`}`);
  if (ok) passed++;
  else failed++;
};

function have(cmd: string, args: string[]): boolean {
  try {
    execFileSync(cmd, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
function run(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): { ok: boolean; out: string } {
  try {
    const out = execFileSync(cmd, args, { cwd: opts.cwd, env: opts.env ?? process.env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, out };
  } catch (e: any) {
    return { ok: false, out: `${e.stdout ?? ""}${e.stderr ?? ""}` || String(e.message) };
  }
}

const hasTerraform = have("terraform", ["version"]);
const hasHelm = have("helm", ["version", "--short"]);
const hasKubeconform = have("kubeconform", ["-v"]);
if (strict) {
  check("terraform is installed", hasTerraform);
  check("helm is installed", hasHelm);
  check("kubeconform is installed", hasKubeconform);
} else {
  if (!hasTerraform) console.log("SKIP  terraform not found, Terraform checks skipped");
  if (!hasHelm) console.log("SKIP  helm not found, Helm checks skipped");
  if (!hasKubeconform) console.log("SKIP  kubeconform not found, schema checks skipped");
}

let subjectFromTerraform = "";
let workerRoleName = "";
let tfNamespace = "";

// ---------------------------------------------------------------- Terraform
if (hasTerraform) {
  const env = { ...process.env, TF_IN_AUTOMATION: "1", AWS_ACCESS_KEY_ID: "test", AWS_SECRET_ACCESS_KEY: "test", AWS_REGION: "ap-southeast-2" };
  const tf = (...args: string[]) => run("terraform", args, { cwd: tfDir, env });

  check("terraform fmt -check passes", tf("fmt", "-check", "-recursive", "-no-color").ok);
  const init = tf("init", "-backend=false", "-input=false", "-no-color");
  check("terraform init -backend=false passes", init.ok, init.out.slice(-400));
  const validate = tf("validate", "-no-color");
  check("terraform validate passes", validate.ok, validate.out.slice(-600));

  const planFile = join(scratch, "eks.tfplan");
  const plan = tf("plan", "-no-color", "-input=false", "-lock=false", "-var", "offline_plan=true", `-out=${planFile}`);
  check("offline terraform plan runs with dummy credentials", plan.ok, plan.out.slice(-600));

  if (plan.ok) {
    const shown = tf("show", "-json", planFile);
    const p = JSON.parse(shown.out);
    const resources: any[] = p.planned_values.root_module.resources;
    const cfgResources: any[] = p.configuration.root_module.resources;
    const ofType = (t: string) => resources.filter((r) => r.type === t);
    const cfgOf = (addr: string) => cfgResources.find((r) => `${r.type}.${r.name}` === addr);
    const refs = (addr: string, field: string): string[] => {
      const e = cfgOf(addr)?.expressions?.[field];
      const list: string[] = e?.references ?? [];
      return list;
    };
    const vals = (t: string) => ofType(t)[0]?.values ?? {};

    check("the plan creates a VPC, 2 public and 2 private subnets", ofType("aws_vpc").length === 1 && ofType("aws_subnet").length === 4, `vpc=${ofType("aws_vpc").length} subnets=${ofType("aws_subnet").length}`);
    check("one NAT gateway by default, with an internet gateway", ofType("aws_nat_gateway").length === 1 && ofType("aws_internet_gateway").length === 1);
    const subnets = ofType("aws_subnet");
    check("subnets are tagged for load balancers (public elb, private internal-elb)", subnets.filter((s) => s.values.tags?.["kubernetes.io/role/elb"] === "1").length === 2 && subnets.filter((s) => s.values.tags?.["kubernetes.io/role/internal-elb"] === "1").length === 2);
    check("private subnets do not map public IPs, public ones do", subnets.filter((s) => s.index !== undefined && s.values.map_public_ip_on_launch === true).length === 2);

    check("the plan creates one EKS cluster", ofType("aws_eks_cluster").length === 1);
    const cluster = vals("aws_eks_cluster");
    check("the cluster endpoint is reachable privately and the public range is a variable", cluster.vpc_config?.[0]?.endpoint_private_access === true && refs("aws_eks_cluster.this", "vpc_config").length >= 0);
    check("audit, api and authenticator logs are on", ["audit", "api", "authenticator"].every((t) => cluster.enabled_cluster_log_types?.includes(t)), JSON.stringify(cluster.enabled_cluster_log_types));
    check("Kubernetes secrets are envelope encrypted with a KMS key", cluster.encryption_config?.[0]?.resources?.includes("secrets") === true && ofType("aws_kms_key")[0]?.values?.enable_key_rotation === true);
    check("access entries are on (API_AND_CONFIG_MAP)", cluster.access_config?.[0]?.authentication_mode === "API_AND_CONFIG_MAP");

    check("the plan creates one managed node group", ofType("aws_eks_node_group").length === 1);
    const ng = vals("aws_eks_node_group");
    check("node group scaling is 2 to 4 starting at 2", ng.scaling_config?.[0]?.min_size === 2 && ng.scaling_config?.[0]?.max_size === 4 && ng.scaling_config?.[0]?.desired_size === 2, JSON.stringify(ng.scaling_config));
    const ngSubnets = refs("aws_eks_node_group.default", "subnet_ids");
    check("the node group sits in the private subnets only", ngSubnets.some((r) => r.startsWith("aws_subnet.private")) && !ngSubnets.some((r) => r.startsWith("aws_subnet.public")), JSON.stringify(ngSubnets));
    const nodePolicies = ofType("aws_iam_role_policy_attachment").map((a) => a.values.policy_arn).filter((a: string) => /Worker|CNI|Registry/.test(a));
    check("the node role carries the three standard node policies", nodePolicies.length === 3, JSON.stringify(nodePolicies));

    const oidc = vals("aws_iam_openid_connect_provider");
    check("an IAM OIDC provider is created for sts.amazonaws.com", ofType("aws_iam_openid_connect_provider").length === 1 && JSON.stringify(oidc.client_id_list) === '["sts.amazonaws.com"]', JSON.stringify(oidc.client_id_list));
    check("the OIDC provider URL comes from the cluster's identity issuer", refs("aws_iam_openid_connect_provider.eks", "url").some((r) => r.startsWith("aws_eks_cluster.this.identity")));

    // The trust policy depends on the OIDC provider, so it is unknown until apply. Read its source in the configuration.
    const trust = cfgResources.find((d) => d.mode === "data" && d.type === "aws_iam_policy_document" && d.name === "worker_assume");
    const stmt = trust?.expressions?.statement?.[0];
    check("the worker trust policy uses sts:AssumeRoleWithWebIdentity", stmt?.actions?.constant_value?.join() === "sts:AssumeRoleWithWebIdentity", JSON.stringify(stmt?.actions));
    check("the trust policy principal is the cluster's OIDC provider", (stmt?.principals?.[0]?.identifiers?.references ?? []).includes("aws_iam_openid_connect_provider.eks.arn") && stmt?.principals?.[0]?.type?.constant_value === "Federated");
    const conds: any[] = stmt?.condition ?? [];
    const sub = conds.find((c) => (c.values?.references ?? []).includes("var.k8s_namespace"));
    const aud = conds.find((c) => c.values?.constant_value?.join() === "sts.amazonaws.com");
    check("the trust policy pins the subject to one namespace and one service account", sub?.test?.constant_value === "StringEquals" && (sub?.values?.references ?? []).includes("var.k8s_service_account"), JSON.stringify(sub));
    check("the trust policy pins the audience to sts.amazonaws.com", aud?.test?.constant_value === "StringEquals", JSON.stringify(aud));
    const irsaSrc = readFileSync(join(tfDir, "irsa.tf"), "utf8");
    check("the two conditions test the :sub and :aud claims of the issuer", irsaSrc.includes('"${local.oidc_host}:sub"') && irsaSrc.includes('"${local.oidc_host}:aud"'));
    check("the trust policy has no wildcard match on the subject", conds.every((c) => c.test?.constant_value !== "StringLike"));

    const archive = ofType("aws_iam_policy").find((x) => x.values.name?.endsWith("worker-archive"));
    const doc = archive ? JSON.parse(archive.values.policy) : null;
    const statements: any[] = doc ? [].concat(doc.Statement) : [];
    const allActions = statements.flatMap((s) => [].concat(s.Action));
    check("the worker S3 policy has no wildcard action", doc !== null && allActions.length > 0 && allActions.every((a) => !a.includes("*")), JSON.stringify(allActions));
    check("object access is limited to the executions/ prefix", statements.some((s) => [].concat(s.Action).includes("s3:PutObject") && [].concat(s.Resource).every((r: string) => r.endsWith("/executions/*"))), JSON.stringify(statements.map((s) => s.Resource)));
    const list = statements.find((s) => [].concat(s.Action).includes("s3:ListBucket"));
    check("listing the bucket needs the executions/ prefix", [].concat(list?.Condition?.StringLike?.["s3:prefix"] ?? [])[0] === "executions/*", JSON.stringify(list?.Condition));
    check("the worker role has that policy and nothing broader attached", ofType("aws_iam_role_policy_attachment").filter((a) => (a.values.role ?? "").includes("worker") || a.address?.includes("worker")).length >= 1 && refs("aws_iam_role_policy_attachment.worker_archive", "role").some((r) => r.startsWith("aws_iam_role.worker")));

    check("the ECR repository has immutable tags and scan on push", vals("aws_ecr_repository").image_tag_mutability === "IMMUTABLE" && vals("aws_ecr_repository").image_scanning_configuration?.[0]?.scan_on_push === true);

    const outs = p.planned_values.outputs ?? {};
    subjectFromTerraform = outs.worker_service_account_subject?.value ?? "";
    workerRoleName = ofType("aws_iam_role").find((r) => r.name === "worker")?.values?.name ?? "";
    tfNamespace = (subjectFromTerraform.split(":")[2] as string) ?? "";
    check("the plan exposes the IRSA subject, the role ARN, the issuer and the ECR URL as outputs", Boolean(subjectFromTerraform) && ["worker_role_arn", "oidc_issuer", "ecr_repository_url", "cluster_name"].every((o) => o in p.configuration.root_module.outputs));

    // Variable guards.
    const oneAz = tf("plan", "-no-color", "-input=false", "-lock=false", "-var", "offline_plan=true", "-var", 'azs=["ap-southeast-2a"]');
    check("a single availability zone is rejected by the variable validation", !oneAz.ok && /at least two availability zones/.test(oneAz.out));
  }
}

// ---------------------------------------------------------------- Helm
type Obj = Record<string, any>;
if (hasHelm) {
  const helm = (...args: string[]) => run("helm", args, { cwd: dirname(chartDir) });
  const eksValues = join(chartDir, "values-eks.yaml");
  const kindValues = join(dirname(dirname(chartDir)), "kind/values-kind.yaml");

  const lint = helm("lint", chartDir, "--strict", "-f", eksValues);
  check("helm lint --strict passes with the EKS values", lint.ok && /0 chart\(s\) failed/.test(lint.out), lint.out.slice(-500));
  const lintDefault = helm("lint", chartDir, "--strict");
  check("helm lint --strict passes with the default values", lintDefault.ok, lintDefault.out.slice(-500));

  const render = (extra: string[] = [], values = eksValues, release = "autoflow-pro") => {
    const r = helm("template", release, chartDir, "-n", "autoflow", "-f", values, ...extra);
    const docs = r.ok ? (parseAllDocuments(r.out).map((d) => d.toJSON()).filter(Boolean) as Obj[]) : [];
    return { ...r, docs };
  };
  const eks = render();
  check("helm template renders with the EKS values", eks.ok, eks.out.slice(-500));
  const kindRender = existsSync(kindValues) ? render([], kindValues) : null;
  check("helm template renders with the kind values", kindRender?.ok === true, kindRender?.out.slice(-500));

  const kinds = (docs: Obj[], kind: string) => docs.filter((d) => d.kind === kind);
  const byComponent = (docs: Obj[], kind: string, component: string) => kinds(docs, kind).find((d) => d.metadata.labels?.["app.kubernetes.io/component"] === component);

  if (eks.ok) {
    const d = eks.docs;
    check("the render holds 2 Deployments, 1 Service, 1 ConfigMap, 1 ServiceAccount, 2 HPAs and 2 PDBs", kinds(d, "Deployment").length === 2 && kinds(d, "Service").length === 1 && kinds(d, "ConfigMap").length === 1 && kinds(d, "ServiceAccount").length === 1 && kinds(d, "HorizontalPodAutoscaler").length === 2 && kinds(d, "PodDisruptionBudget").length === 2, JSON.stringify(d.map((x) => x.kind)));

    const sa = kinds(d, "ServiceAccount")[0];
    check("the ServiceAccount carries the IRSA role annotation", /^arn:aws:iam::\d{12}:role\/.+/.test(sa?.metadata?.annotations?.["eks.amazonaws.com/role-arn"] ?? ""), JSON.stringify(sa?.metadata?.annotations));
    check("without irsaRoleArn there is no annotation", kinds(render(["--set", "serviceAccount.irsaRoleArn="]).docs, "ServiceAccount")[0]?.metadata?.annotations === undefined);

    for (const component of ["api", "worker"] as const) {
      const dep = byComponent(d, "Deployment", component)!;
      const pod = dep.spec.template.spec;
      const c = pod.containers[0];
      check(`${component}: runs as the chart ServiceAccount`, pod.serviceAccountName === sa.metadata.name);
      check(`${component}: has startup, readiness and liveness probes`, Boolean(c.startupProbe?.httpGet && c.readinessProbe?.httpGet && c.livenessProbe?.httpGet), JSON.stringify([c.startupProbe, c.readinessProbe, c.livenessProbe].map((x) => x?.httpGet)));
      check(`${component}: probes point at a named container port that exists`, [c.startupProbe, c.readinessProbe, c.livenessProbe].every((pr) => c.ports.some((po: Obj) => po.name === pr?.httpGet?.port)));
      check(`${component}: CPU and memory have both requests and limits`, ["cpu", "memory"].every((k) => c.resources?.requests?.[k] && c.resources?.limits?.[k]), JSON.stringify(c.resources));
      check(`${component}: runs non-root, no privilege escalation, read-only root, all capabilities dropped`, pod.securityContext?.runAsNonRoot === true && c.securityContext?.allowPrivilegeEscalation === false && c.securityContext?.readOnlyRootFilesystem === true && c.securityContext?.capabilities?.drop?.includes("ALL") === true);
      check(`${component}: the image is pinned to a tag that is not latest`, /:[^:/]+$/.test(c.image) && !c.image.endsWith(":latest"), c.image);
      check(`${component}: the config comes from the ConfigMap`, c.envFrom?.[0]?.configMapRef?.name === kinds(d, "ConfigMap")[0].metadata.name);
      const secretRefs = (c.env as Obj[]).filter((e) => e.valueFrom?.secretKeyRef);
      check(`${component}: every secret value is a reference to the existing Secret, none is inline`, secretRefs.length > 0 && secretRefs.every((e) => e.valueFrom.secretKeyRef.name === "autoflow-secrets" && e.valueFrom.secretKeyRef.key === e.name) && (c.env as Obj[]).filter((e) => /KEY|URL|PASS/.test(e.name) && !e.valueFrom).length === 0, JSON.stringify(c.env));
      check(`${component}: the HPA targets this Deployment`, byComponent(d, "HorizontalPodAutoscaler", component)?.spec.scaleTargetRef.name === dep.metadata.name);
      check(`${component}: replicas are left to the HPA`, dep.spec.replicas === undefined);
      const pdb = byComponent(d, "PodDisruptionBudget", component)!;
      check(`${component}: the PDB selector matches the pod labels`, Object.entries(pdb.spec.selector.matchLabels).every(([k, v]) => dep.spec.template.metadata.labels[k] === v));
      check(`${component}: the Deployment selector matches the pod labels`, Object.entries(dep.spec.selector.matchLabels).every(([k, v]) => dep.spec.template.metadata.labels[k] === v));
    }

    const svc = kinds(d, "Service")[0];
    const apiDep = byComponent(d, "Deployment", "api")!;
    check("the Service selects the API pods and its targetPort is a named port of the API container", Object.entries(svc.spec.selector).every(([k, v]) => apiDep.spec.template.metadata.labels[k] === v) && apiDep.spec.template.spec.containers[0].ports.some((po: Obj) => po.name === svc.spec.ports[0].targetPort));
    check("the Service does not select the worker pods", !Object.entries(svc.spec.selector).every(([k, v]) => byComponent(d, "Deployment", "worker")!.spec.template.metadata.labels[k] === v));

    const worker = byComponent(d, "Deployment", "worker")!;
    const wc = worker.spec.template.spec.containers[0];
    check("the worker runs the RabbitMQ entrypoint of the same image", JSON.stringify(wc.command) === '["node","dist/src/messaging/main.js"]' && wc.image === apiDep.spec.template.spec.containers[0].image);
    check("the worker entrypoint exists in the backend source", existsSync(join(root, "backend/src/messaging/main.ts")));
    const shutdownMs = Number(kinds(d, "ConfigMap")[0].data.SHUTDOWN_TIMEOUT_MS);
    check("the pod grace period is longer than the worker's shutdown wait", worker.spec.template.spec.terminationGracePeriodSeconds * 1000 > shutdownMs, `${worker.spec.template.spec.terminationGracePeriodSeconds} s vs ${shutdownMs} ms`);
    check("the worker health probes use the paths the worker serves (/readyz, /healthz)", wc.readinessProbe?.httpGet?.path === "/readyz" && wc.livenessProbe?.httpGet?.path === "/healthz" && existsSync(join(root, "backend/src/messaging/main.ts")) && readFileSync(join(root, "backend/src/messaging/main.ts"), "utf8").includes('"/readyz"') && readFileSync(join(root, "backend/src/messaging/main.ts"), "utf8").includes('"/healthz"'));

    // Chart <-> code: the secret keys the chart passes are the ones the code insists on.
    const envSrc = readFileSync(join(root, "backend/src/config/environment.ts"), "utf8");
    const required = [...(/const required = \[([\s\S]*?)\]/.exec(envSrc)?.[1] ?? "").matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
    const apiSecretKeys = (apiDep.spec.template.spec.containers[0].env as Obj[]).filter((e) => e.valueFrom).map((e) => e.name);
    check("the API gets every variable backend/src/config/environment.ts requires", required.length > 0 && required.every((k) => apiSecretKeys.includes(k) || k in kinds(d, "ConfigMap")[0].data), `required=${required} chart=${apiSecretKeys}`);
    const workerSecretKeys = (wc.env as Obj[]).filter((e) => e.valueFrom).map((e) => e.name);
    const cfgSrc = readFileSync(join(root, "backend/src/messaging/config.ts"), "utf8");
    check("the worker gets every variable messaging/config.ts requires", ["RABBITMQ_URL", "REDIS_URL"].every((k) => workerSecretKeys.includes(k) && cfgSrc.includes(`"${k}"`) || cfgSrc.includes(`env.${k}`)));
    const cm = kinds(d, "ConfigMap")[0].data;
    check("the worker ConfigMap values pass the worker's own config parser rules", /^[A-Za-z0-9._-]+$/.test(cm.RABBITMQ_QUEUE) && /^\d+(,\d+)*$/.test(cm.RABBITMQ_RETRY_DELAYS_MS) && Number(cm.RABBITMQ_PREFETCH) >= 1);

    // Terraform <-> chart.
    if (subjectFromTerraform) {
      const [, , ns, name] = subjectFromTerraform.split(":");
      check("the chart ServiceAccount name equals the service account the IAM role trusts", sa.metadata.name === name, `chart=${sa.metadata.name} terraform=${name}`);
      const valuesText = readFileSync(eksValues, "utf8");
      const installNs = /-n (\S+)/.exec(valuesText)?.[1];
      check("the documented install namespace equals the namespace the IAM role trusts", installNs === ns, `values-eks.yaml says ${installNs}, terraform trusts ${ns}`);
      const arn = sa.metadata.annotations?.["eks.amazonaws.com/role-arn"] ?? "";
      check("the IRSA role name in the EKS values equals the Terraform worker role name", workerRoleName !== "" && arn.endsWith(`:role/${workerRoleName}`), `${arn} vs ${workerRoleName}`);
    }

    // Negative cases: the schema and the switches do their job.
    check("image.tag=latest is rejected by the values schema", !render(["--set", "image.tag=latest"]).ok);
    check("a malformed IRSA role ARN is rejected by the values schema", !render(["--set", "serviceAccount.irsaRoleArn=not-an-arn"]).ok);
    check("a resources block without limits is rejected", !render(["--set", "api.resources.limits=null"]).ok);
    const noWorker = render(["--set", "worker.enabled=false"]).docs;
    check("worker.enabled=false removes the worker Deployment, HPA and PDB", !byComponent(noWorker, "Deployment", "worker") && !byComponent(noWorker, "HorizontalPodAutoscaler", "worker") && !byComponent(noWorker, "PodDisruptionBudget", "worker") && Boolean(byComponent(noWorker, "Deployment", "api")));
    const fixed = render(["--set", "api.autoscaling.enabled=false", "--set", "api.replicaCount=3"]).docs;
    check("with autoscaling off the API Deployment gets its replica count and no HPA", byComponent(fixed, "Deployment", "api")?.spec.replicas === 3 && !byComponent(fixed, "HorizontalPodAutoscaler", "api"));
    check("api.readinessPath changes the API readiness probe", byComponent(render(["--set", "api.readinessPath=/health"]).docs, "Deployment", "api")?.spec.template.spec.containers[0].readinessProbe.httpGet.path === "/health");
    const changed = render(["--set", "config.corsOrigin=https://other.example.com"]).docs;
    check("a config change changes the pod checksum annotation, so pods roll", byComponent(changed, "Deployment", "api")?.spec.template.metadata.annotations["checksum/config"] !== byComponent(d, "Deployment", "api")?.spec.template.metadata.annotations["checksum/config"]);

    // Schema validation of the rendered objects.
    if (hasKubeconform) {
      for (const [label, r] of [["EKS values", eks], ["kind values", kindRender]] as const) {
        if (!r?.ok) continue;
        const file = join(scratch, `${label.replace(/\W/g, "-")}.yaml`);
        writeFileSync(file, r.out);
        const kc = run("kubeconform", ["-strict", "-summary", "-kubernetes-version", "1.34.0", file]);
        check(`kubeconform -strict accepts every object rendered with the ${label}`, kc.ok && / Invalid: 0, Errors: 0/.test(kc.out), kc.out.slice(-500));
      }
      // The check itself must notice a broken object.
      const broken = eks.out.replace("replicas: 1\n", "replicas: 1\n").replace("minReplicas: 2", "minReplicas: two");
      const brokenFile = join(scratch, "broken.yaml");
      writeFileSync(brokenFile, broken);
      check("control: kubeconform rejects an HPA with minReplicas: two", !run("kubeconform", ["-strict", "-summary", "-kubernetes-version", "1.34.0", brokenFile]).ok);
    }
  }

  // Values files must stay valid YAML.
  check("values.yaml and values-eks.yaml parse as YAML", (() => {
    try {
      parse(readFileSync(join(chartDir, "values.yaml"), "utf8"));
      parse(readFileSync(eksValues, "utf8"));
      return true;
    } catch {
      return false;
    }
  })());
}

rmSync(scratch, { recursive: true, force: true });
console.log(failed === 0 ? `\nAll ${passed} deploy file checks passed` : `\n${failed} of ${passed + failed} deploy file check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
