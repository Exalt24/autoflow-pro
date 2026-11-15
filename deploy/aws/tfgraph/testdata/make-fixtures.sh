#!/usr/bin/env bash
# LIFESPAN: permanent
# Regenerates the REAL plan and state JSON in testdata/real/ by running terraform against deploy/aws, then the
# hand broken variants in testdata/variants/ from the real create plan (make_variants.py).
# Needs terraform, python, and moto running on MOTO_URL (python -m moto.server -H 127.0.0.1 -p 5000) for the state
# and the plans that read it. Nothing here touches a real AWS account: static test sign-in and the emulator tfvars.
set -euo pipefail
cd "$(dirname "$0")"
OUT="$(pwd)"
AWS_DIR="$(cd ../.. && pwd)"
MOTO_URL="${MOTO_URL:-http://localhost:5000}"
export AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_DEFAULT_REGION=ap-southeast-2 TF_IN_AUTOMATION=1
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
curl -fsS "${MOTO_URL}/moto-api/" > /dev/null || { echo "moto is not running at ${MOTO_URL}"; exit 1; }
mkdir -p real variants
cd "$AWS_DIR"
terraform init -input=false -no-color > /dev/null
VARS=(-input=false -no-color -lock=false -var-file=emulator.tfvars -var "emulator_endpoint=${MOTO_URL}")
STATE="$WORK/s.tfstate"

plan_json() { # name, state file, extra terraform args...
  local name="$1" state="$2"; shift 2
  terraform plan "${VARS[@]}" -state="$state" -out="$WORK/p.tfplan" "$@" > /dev/null
  terraform show -json "$WORK/p.tfplan" > "$OUT/real/$name.json"
  echo "wrote real/$name.json"
}

# 1. create plan with the emulator tfvars exactly as backend/tests/test-aws-terraform.ts plans it (offline: the
#    bucket suffix is given, so no account lookup is needed)
plan_json plan-create-offline "$WORK/none.tfstate" -var bucket_suffix=123456789012
# 2. create plan that reads the account id from moto
plan_json plan-create-emulator "$WORK/none.tfstate"
# 3. apply without an access key (a state holds the key secret in clear text), then read the state
terraform apply "${VARS[@]}" -state="$STATE" -auto-approve -var create_access_key=false > /dev/null
terraform show -json "$STATE" > "$OUT/real/state-applied.json"
echo "wrote real/state-applied.json"
# 4. plans against that state: nothing to do, an in place update, and a replacement of the bucket and what hangs off it
plan_json plan-noop "$STATE" -var create_access_key=false
plan_json plan-update-prefix "$STATE" -var create_access_key=false -var archive_prefix=reports/
plan_json plan-replace-bucket "$STATE" -var create_access_key=false -var bucket_suffix=999999999999
terraform destroy "${VARS[@]}" -state="$STATE" -auto-approve -var create_access_key=false > /dev/null
echo "destroyed the emulator resources"
cd "$OUT"
python make_variants.py
