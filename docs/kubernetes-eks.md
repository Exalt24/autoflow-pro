# Kubernetes on EKS: Terraform and Helm

Two pieces, plus a local cluster to try the chart on.

- `deploy/eks/` is Terraform for the cluster: a VPC, an EKS cluster, a managed node group, an OIDC provider and an IAM role the worker pods assume (IRSA).
- `deploy/helm/autoflow-pro/` is the Helm chart for the API and the RabbitMQ worker.
- `deploy/kind/` has the values and the Redis and RabbitMQ manifests for running the chart on a local kind cluster.

**Nothing here was applied to an AWS account.** The Terraform was validated and planned offline. The chart was linted, rendered, schema checked and installed on a local kind cluster, not on EKS. The commands and results are below.

## Terraform (`deploy/eks/`)

| File | What it makes |
| --- | --- |
| `vpc.tf` | VPC, two public and two private subnets (a /20 each, tagged for load balancers), an internet gateway, one NAT gateway (or one per zone with `single_nat_gateway=false`), route tables |
| `eks.tf` | Cluster role, EKS cluster (private and public endpoint, `public_access_cidrs` variable, api, audit and authenticator logs, Kubernetes secrets encrypted with a KMS key that rotates), node role with the three standard node policies, a managed node group in the private subnets (2 to 4 nodes, AL2023), an ECR repository with immutable tags and scan on push |
| `irsa.tf` | The cluster's OIDC issuer registered as an IAM identity provider, the worker role that trusts exactly one service account in one namespace (and audience `sts.amazonaws.com`), and a policy that gives it the archive prefix of the `deploy/aws` bucket and nothing else |
| `outputs.tf` | Cluster name and endpoint, OIDC issuer, `worker_role_arn`, ECR URL, the `aws eks update-kubeconfig` command, and the service account subject the role trusts |

Availability zones are a variable (two or more, validated) so a plan needs no AWS lookup. `offline_plan=true` skips the credential, account id and metadata checks so `terraform plan` runs with dummy credentials and no network; left false, every call goes to real AWS.

```bash
cd deploy/eks
terraform init -backend=false      # drop -backend=false once you have a state bucket
terraform validate
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test terraform plan -var offline_plan=true
# for a real account: narrow public_access_cidrs, set archive_bucket_name from deploy/aws, then plan and apply
```

## Helm chart (`deploy/helm/autoflow-pro/`)

Renders 9 objects with the EKS values: a Deployment and a Service for the API, a Deployment for the worker, a ConfigMap, a ServiceAccount, two HorizontalPodAutoscalers (CPU 70 percent) and two PodDisruptionBudgets.

- **Secrets are referenced, never stored.** Pods read `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, `REDIS_URL` and `RABBITMQ_URL` from an existing Secret (`existingSecret`) with `secretKeyRef`. The chart writes no secret value.
- **IRSA.** `serviceAccount.irsaRoleArn` adds the `eks.amazonaws.com/role-arn` annotation. `serviceAccount.name` must match `k8s_service_account` in Terraform, and a test checks that.
- **Probes.** The API has startup, readiness and liveness probes on `/`. `api.readinessPath=/health` makes readiness depend on Supabase and Redis. The worker uses `/readyz` and `/healthz`.
- **Limits and hardening.** Requests and limits on both containers (the schema refuses a chart without them), non-root user, no privilege escalation, read-only root filesystem with a `/tmp` volume, all capabilities dropped, default seccomp profile.
- **Rollouts.** A checksum of the ConfigMap is a pod annotation, so a config change rolls the pods. `image.tag=latest` is refused by `values.schema.json`.

```bash
helm lint deploy/helm/autoflow-pro --strict -f deploy/helm/autoflow-pro/values-eks.yaml
helm template autoflow-pro deploy/helm/autoflow-pro -n autoflow -f deploy/helm/autoflow-pro/values-eks.yaml | kubeconform -strict -summary
```

Install on EKS: see the first lines of `values-eks.yaml`. Install on kind: [deploy/kind/README.md](../deploy/kind/README.md).

## What was run

Full output: [docs/test-runs/2026-11-07-eks-terraform-and-helm.txt](test-runs/2026-11-07-eks-terraform-and-helm.txt) and [docs/test-runs/2026-11-07-kind-cluster.txt](test-runs/2026-11-07-kind-cluster.txt). Terraform 1.16.6 with the AWS provider 6.72.0, Helm 4.3.1, kubeconform 0.8.0, kind 0.33.0 on Docker Desktop.

| Check | Result |
| --- | --- |
| `terraform fmt -check -recursive` | clean |
| `terraform init -backend=false`, `terraform validate` | valid |
| `terraform plan -var offline_plan=true` (dummy credentials) | 29 to add, 0 to change, 0 to destroy |
| `helm lint --strict` (EKS values and default values) | 0 charts failed |
| `helm template` then `kubeconform -strict` against Kubernetes 1.34.0 | 9 of 9 valid |
| `npm run test:deploy` (`scripts/test-deploy-files.ts`) | 89 of 89 checks passed |
| Mutations of the Terraform (node group on public subnets, StringLike in the trust policy, `s3:*`, node max 10, KMS rotation off) | 5 of 5 turned a check red |
| Mutations of the chart (no readiness probe, no limits, `:latest` image, renamed service account, inline secret value, Service selecting the worker, short grace period, HPA on the wrong Deployment) | 8 of 8 turned a check red |
| Helm install on a local kind cluster (Kubernetes v1.37.0), the real backend image, Redis and RabbitMQ pods | `helm --wait` returned deployed, API and worker pods 1/1 Ready |
| Message through RabbitMQ on that cluster | the worker created `bull:workflow-executions:rmq-kind-run-1` in Redis, skipped the duplicate, dead-lettered the bad request, and on SIGTERM logged `consumer stopped` with `drained: true` |

`test:deploy` reads the `terraform plan` JSON and the rendered Helm objects, and asserts rules rather than file text: the node group is in the private subnets, the trust policy pins one namespace and one service account and the `sts.amazonaws.com` audience, the S3 policy has no wildcard action and stays under `executions/`, every probe points at a port the container declares, every container has CPU and memory requests and limits, every secret is a `secretKeyRef`, the Service and PDB selectors match the pods, and the HPAs point at the right Deployments. It also cross-checks Terraform against the chart (service account name, namespace, role name) and the chart against the code (the variables `backend/src/config/environment.ts` and `backend/src/messaging/config.ts` require).

## Not done

- No `terraform apply`, no cluster on AWS, no EKS-specific check of the IRSA annotation. The trust policy is verified from the plan and the Terraform source, not by a pod assuming the role.
- The HPAs were rendered and schema checked but not exercised: the kind run had autoscaling off and no metrics-server.
- TLS and a cloud load balancer are not in the chart. The chart has an optional Ingress (`ingress.enabled`, class `traefik`); it was run behind a Traefik install on a local kind cluster, see [the run](test-runs/2026-11-07-traefik-ingress-kind.txt). The API Service stays `ClusterIP`.
- The kind cluster used placeholder Supabase values, so `/health` answered `degraded` there.
