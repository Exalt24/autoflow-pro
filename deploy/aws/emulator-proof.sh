#!/usr/bin/env bash
# LIFESPAN: permanent
# Applies deploy/aws to a local AWS emulator (moto), runs the archive tests against the bucket it creates,
# then destroys it. Start moto first:  python -m moto.server -H 127.0.0.1 -p 5000
# Needs terraform, node (backend/node_modules installed) and a Redis on REDIS_URL (docker compose up -d redis).
# Usage: deploy/aws/emulator-proof.sh   (MOTO_URL and REDIS_URL override the defaults)
set -euo pipefail
cd "$(dirname "$0")"

MOTO_URL="${MOTO_URL:-http://localhost:5000}"
export REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379}"
# The emulator accepts any sign-in for the admin calls terraform makes
export AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_DEFAULT_REGION=ap-southeast-2 TF_IN_AUTOMATION=1
VARS=(-var-file=emulator.tfvars -var "emulator_endpoint=${MOTO_URL}")

echo "# $(date -u +%Y-%m-%dT%H:%M:%SZ)  repo commit $(git rev-parse --short HEAD 2>/dev/null)$(git diff --quiet HEAD -- . ../../backend 2>/dev/null || echo ' plus uncommitted changes')"
echo "# emulator: moto server at ${MOTO_URL}, region ap-southeast-2, path-style S3, static test sign-in for the admin calls"
echo "# IAM enforcement: off while terraform runs, switched on through POST /moto-api/reset-auth (INITIAL_NO_AUTH_ACTION_COUNT 0) only while the app signs in as the terraform-created IAM user"
echo "# policy attached to the user, not a bucket policy (moto enforces IAM user policies; bucket policy enforcement is partial)"
echo "# $(terraform version | head -1), aws provider $(sed -n 's/^  version     = "\(.*\)"/\1/p' .terraform.lock.hcl | head -1), moto $(python -c 'import moto;print(moto.__version__)'), node $(node --version)"

curl -fsS "${MOTO_URL}/moto-api/" > /dev/null || { echo "moto is not running at ${MOTO_URL}"; exit 1; }
# Never leave enforcement on, even when a step fails: destroy needs the admin calls to go through
curl -fsS -X POST -H 'Content-Type: text/plain' -d inf "${MOTO_URL}/moto-api/reset-auth" > /dev/null

destroyed=0
cleanup() {
  curl -fsS -X POST -H 'Content-Type: text/plain' -d inf "${MOTO_URL}/moto-api/reset-auth" > /dev/null || true
  if [ "$destroyed" = 0 ]; then terraform destroy -auto-approve -input=false -no-color "${VARS[@]}" > /dev/null 2>&1 || true; fi
}
trap cleanup EXIT

step() { echo; echo "## $*"; }

step "terraform init"
terraform init -input=false -no-color | tail -4

step "terraform fmt -check"
terraform fmt -check -diff -no-color && echo "formatted"

step "terraform validate"
terraform validate -no-color

step "terraform plan"
terraform plan -input=false -no-color "${VARS[@]}" -out=proof.tfplan | grep -E "^Plan:|will be created" || true

step "terraform apply"
terraform apply -input=false -no-color proof.tfplan | grep -E "Creation complete|Apply complete|^[a-z_]+ = " | sed -E 's/^(access_key_id) = .*/\1 = <hidden>/'
rm -f proof.tfplan

step "terraform plan after apply (exit code 0 means no drift)"
terraform plan -input=false -no-color -detailed-exitcode "${VARS[@]}" | grep -E "No changes|Infrastructure matches" || { echo "drift after apply"; exit 1; }

step "archive tests against the created bucket (npm run test:s3-emulator, IAM enforcement on)"
BUCKET="$(terraform output -raw bucket_name)"
(
  cd ../../backend
  AWS_S3_ENDPOINT="${MOTO_URL}" AWS_S3_BUCKET_NAME="${BUCKET}" AWS_REGION=ap-southeast-2 \
    APP_ACCESS_KEY_ID="$(cd ../deploy/aws && terraform output -raw access_key_id)" \
    APP_SECRET_ACCESS_KEY="$(cd ../deploy/aws && terraform output -raw access_key_secret)" \
    REQUIRE_EMULATOR=1 npm run --silent test:s3-emulator
)

step "terraform destroy"
terraform destroy -auto-approve -input=false -no-color "${VARS[@]}" | grep -E "Destruction complete|Destroy complete"
destroyed=1

step "the bucket is gone (HEAD bucket must answer 404)"
code="$(curl -s -o /dev/null -w '%{http_code}' -I "${MOTO_URL}/${BUCKET}")"
echo "HEAD ${MOTO_URL}/${BUCKET} -> ${code}"
[ "$code" = "404" ]
echo; echo "emulator proof passed"
