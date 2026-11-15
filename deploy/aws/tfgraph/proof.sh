#!/usr/bin/env bash
# LIFESPAN: permanent
# One run of everything tfgraph claims: vet, format, tests with counts, the mutation pass, then the tool on a fresh
# REAL `terraform plan` of deploy/aws and on the widened copy of a plan, with the output printed as it came.
# Needs go and terraform (the aws provider is downloaded by `terraform init`). It signs in with static test
# credentials and plans offline (a bucket suffix is given, so there is no account lookup): nothing here reaches AWS.
# Usage: deploy/aws/tfgraph/proof.sh   (run from anywhere)
set -euo pipefail
cd "$(dirname "$0")"
HERE="$(pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_DEFAULT_REGION=ap-southeast-2 TF_IN_AUTOMATION=1

step() { echo; echo "## $*"; }

echo "# $(date -u +%Y-%m-%dT%H:%M:%SZ)  repo commit $(git rev-parse --short HEAD 2>/dev/null)$(git diff --quiet HEAD -- .. 2>/dev/null || echo ' plus uncommitted changes')"
echo "# $(go version), $(terraform version | head -1)"

step "go vet ./..."
go vet ./...
echo "clean"

step "gofmt -l ."
listed="$(gofmt -l .)"
if [ -n "$listed" ]; then echo "$listed"; echo "gofmt lists the files above"; exit 1; fi
echo "no files listed"

step "go test -count=1 -v ./..."
go test -count=1 -v ./... > "$WORK/test.out" 2>&1 || { cat "$WORK/test.out"; exit 1; }
grep -E "^(ok|FAIL|\?)" "$WORK/test.out" | sed -E 's/\t[0-9.]+s$//; s/\t\(cached\)$//'
top="$(grep -c '^--- PASS' "$WORK/test.out" || true)"
failed="$(grep -c -e '--- FAIL' "$WORK/test.out" || true)"
echo "tests passed: ${top} test functions, ${failed} failed"
[ "$failed" = 0 ]

step "mutation pass: go run ./cmd/mutate"
go run ./cmd/mutate

step "terraform plan of deploy/aws (real plan, emulator tfvars, offline)"
(
  cd ..
  terraform init -input=false -backend=false -no-color | tail -3
  terraform plan -input=false -no-color -lock=false -state="$WORK/none.tfstate" -var-file=emulator.tfvars -var bucket_suffix=123456789012 -out="$WORK/plan.tfplan" | grep -E "^Plan:"
  terraform show -json "$WORK/plan.tfplan" > "$WORK/plan.json"
)
go build -o "$WORK/tfgraph" ./cmd/tfgraph

step "tfgraph check plan.json (the repo's real plan)"
code=0
(cd "$WORK" && ./tfgraph check plan.json) || code=$?
echo "exit code $code (0 means clean)"
[ "$code" = 0 ]

step "tfgraph graph plan.json --resources-only"
(cd "$WORK" && ./tfgraph graph plan.json --resources-only)

step "tfgraph check on a copy of the plan with the policy widened (testdata/variants/widened-policy.json)"
code=0
"$WORK/tfgraph" check testdata/variants/widened-policy.json || code=$?
echo "exit code $code (1 means findings)"
[ "$code" = 1 ]

step "tfgraph check on a plan that could not be read"
code=0
(cd "$WORK" && ./tfgraph check not-there.json) || code=$?
echo "exit code $code (2 means the input could not be read)"
[ "$code" = 2 ]

echo; echo "tfgraph proof passed"
