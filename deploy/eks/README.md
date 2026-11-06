Terraform for an EKS cluster that runs the AutoFlow Pro Helm chart: VPC, EKS control plane, a managed node group, an OIDC provider, and an IRSA role for the worker pods. Full description and the checks that were run: `docs/kubernetes-eks.md`.

```bash
terraform init -backend=false
terraform validate
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test terraform plan -var offline_plan=true   # no AWS call
```

Before a real apply: set `public_access_cidrs` to your own range, set `archive_bucket_name` to the bucket from `deploy/aws`, and add a state backend. Then use `terraform output -raw worker_role_arn` for `serviceAccount.irsaRoleArn` and `terraform output -raw ecr_repository_url` for `image.repository` in the chart.
