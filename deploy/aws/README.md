Terraform for the AWS S3 archive target of the backend (`ARCHIVE_PROVIDER=s3`).

It creates one S3 bucket (all four public access blocks on, versioning on, AES256 encryption, a lifecycle rule that expires objects under `executions/` after 90 days), one IAM policy limited to that prefix, and one IAM user the policy is attached to. Every name starts with `name_prefix` (default `autoflow-archive`): the bucket is `autoflow-archive-<account id>`, the user `autoflow-archive-user`, the policy `autoflow-archive-policy`.

## Against a real AWS account

No endpoint override and no skip flags are set unless `emulator_endpoint` is non-empty, so this is the whole real run. Sign in with the usual AWS sources first (a profile, or the standard AWS environment variables).

```bash
cd deploy/aws
terraform init
terraform plan -var region=ap-southeast-2
terraform apply -var region=ap-southeast-2
```

`create_access_key` and `force_destroy` both default to false. Run the backend with an IAM role, or set `-var create_access_key=true` and read the key from `terraform output`. Then point the backend at the bucket:

```bash
ARCHIVE_PROVIDER=s3
AWS_REGION=ap-southeast-2
AWS_S3_BUCKET_NAME=<bucket_name output>
```

## Against a local AWS emulator (moto)

`emulator.tfvars` sets the endpoint to `http://localhost:5000` and turns on `create_access_key` and `force_destroy`, which exist for the emulator run only.

```bash
pip install "moto[server]==5.2.5"
python -m moto.server -p 5000        # in a second terminal
bash deploy/aws/emulator-proof.sh    # init, fmt, validate, plan, apply, drift check, tests, destroy, 404 check
```

The script needs Redis on `REDIS_URL` (default `redis://127.0.0.1:6379`, for example `docker compose up -d redis`). Its output for the committed run is in `docs/test-runs/`.

## tfgraph: read a plan or a state as a graph and check it

`tfgraph/` is a small Go command line (standard library only, Go 1.27) that reads what `terraform show -json` prints for a plan file or for a state, builds a directed graph of the resources, works out which IAM policy reaches which IAM user, and checks the policy and the bucket settings. It explains each failure in one plain sentence that says what it read, what it expected and the resource address.

```bash
cd deploy/aws
terraform plan -var-file=emulator.tfvars -var bucket_suffix=123456789012 -out=plan.tfplan
terraform show -json plan.tfplan > plan.json
cd tfgraph
go run ./cmd/tfgraph check ../plan.json                # text report, exit 0 clean, 1 findings, 2 could not read the input
go run ./cmd/tfgraph check ../plan.json --format json
go run ./cmd/tfgraph graph ../plan.json --resources-only
```

`terraform show -json` of a state works the same way. `--prefix executions/` says which prefix the policy is meant to be limited to; without it the prefix is read from the policy's own `s3:prefix` condition, then from the bucket's lifecycle rule.

### What it reads

- Nodes are the resources of `resource_changes` (with the planned action of each) plus the data sources in `prior_state`. A state gives its resources and their stored values.
- Edges come from the `references` in each resource's `configuration` expressions (the attribute that holds the reference is kept), from `depends_on`, from the dependencies a state records, and from planned values that name another resource (a `bucket`, `user` or `policy_arn` value that equals a known name or ARN). Resolving IAM adds a grant edge from a policy to every bucket its Allow statements name, which is how the policy and the bucket are linked here, because the policy takes the bucket name from a local value and not from a reference.
- Each policy document is parsed into statements with effect, actions, resources and conditions, and `check` prints them under the IAM user they reach, through the policy attachment.

### Rules

Each rule has a stable code. A result is a FINDING, or UNKNOWN when a value the rule needs is known only after apply. An UNKNOWN is printed with its reason, is never counted as clean, and does not change the exit code.

| Code | What it flags |
| --- | --- |
| TFG001 | an Allow statement with a wildcard action (`*` or `s3:*`), or an Allow with NotAction |
| TFG002 | an Allow statement with Resource `*`, an S3 ARN with a wildcard bucket, or an Allow with NotResource |
| TFG003 | an object resource outside the prefix the policy claims, or a bucket listing with no `s3:prefix` condition inside it |
| TFG004 | a bucket with no public access block, or one of the four flags not true |
| TFG005 | a bucket with no server side encryption configuration or no algorithm in it |
| TFG006 | a bucket with no versioning resource, or a status that is not Enabled |
| TFG007 | a resource planned for delete |
| TFG008 | a resource planned for replace (delete then create, or create then delete) |
| TFG009 | a policy document that is not valid JSON or has no usable Statement |

A resource the plan deletes is treated as gone, so a plan that deletes the public access block reports TFG007 for the block and TFG004 for the bucket.

### What it was built and tested against

- Real `terraform plan` and `terraform show -json` output of this stack (Terraform 1.16.6, AWS provider 6.71.0, the emulator tfvars), saved in `tfgraph/testdata/real/`: a create plan planned offline, a create plan against the moto emulator, the state after applying to moto, a plan with no changes, an in place update plan (a new archive prefix) and a plan that replaces the bucket. `testdata/make-fixtures.sh` regenerates them with moto running.
- Hand broken copies of the create plan in `tfgraph/testdata/variants/` (a wildcard action, a wildcard resource, a widened resource, a missing public access block, a flag turned off, no encryption, versioning suspended, delete and replace planned, values known after apply, a policy that is not JSON), written by `testdata/make_variants.py`.
- Table tests for the plan reader, the graph, the IAM parser and every rule, and golden text and JSON reports for the commands. `go run ./cmd/mutate` makes 33 deliberate breaks of the rules, one at a time in a scratch copy, and prints `mutants caught: N of N`. `proof.sh` runs vet, gofmt, the tests, the mutation pass and the tool on a fresh plan of this stack. The committed run is in `docs/test-runs/2026-11-15-tfgraph-plan-graph-and-checks.txt`, and the `tfgraph` workflow runs the same checks on every change under `deploy/aws/`.

It has only been run on these plans, the emulator and the hand broken copies. It has not been run against a production account or a customer's cloud.

### Limits

- It checks IAM policy documents, the S3 settings above and the plan actions. Other resource types become graph nodes and edges but no rule reads them.
- Terraform writes local values into the plan JSON only as the references they use, so an edge that goes through `local.x` stops at the local: the graph shows `aws_s3_bucket.archive -> local.bucket_name` and not what the local reads.
- A bucket setting is attached to its bucket by a configuration reference, a recorded state dependency or a matching bucket name. A setting wired some other way is reported as missing.
- The inline settings of the `aws_s3_bucket` resource itself (the older `versioning` and `server_side_encryption_configuration` blocks) are not read, only the separate resources this stack uses.
