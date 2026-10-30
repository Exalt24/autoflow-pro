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
