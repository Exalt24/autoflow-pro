package rules_test

import (
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/Exalt24/autoflow-pro/deploy/aws/tfgraph/internal/graph"
	"github.com/Exalt24/autoflow-pro/deploy/aws/tfgraph/internal/iam"
	"github.com/Exalt24/autoflow-pro/deploy/aws/tfgraph/internal/plan"
	"github.com/Exalt24/autoflow-pro/deploy/aws/tfgraph/internal/rules"
	"github.com/Exalt24/autoflow-pro/deploy/aws/tfgraph/internal/testutil"
)

const (
	policyAddr = "aws_iam_policy.archive_access"
	bucketAddr = "aws_s3_bucket.archive"
	pabAddr    = "aws_s3_bucket_public_access_block.archive"
	sseAddr    = "aws_s3_bucket_server_side_encryption_configuration.archive"
	verAddr    = "aws_s3_bucket_versioning.archive"
	bucketARN  = "arn:aws:s3:::autoflow-archive-123456789012"
)

func run(doc *plan.Doc, opts rules.Options) []rules.Result {
	g := graph.Build(doc)
	iam.Resolve(doc, g)
	return rules.Run(&rules.Input{Doc: doc, Graph: g, Documents: iam.Documents(doc), Opts: opts})
}

// lines renders results as "CODE STATUS address", one per result.
func lines(results []rules.Result) []string {
	out := []string{}
	for _, r := range results {
		out = append(out, fmt.Sprintf("%s %s %s", r.Code, r.Status, r.Address))
	}
	return out
}

func unknownTree(t *testing.T, m map[string]any, typ string) map[string]any {
	t.Helper()
	return testutil.Change(t, m, typ)["change"].(map[string]any)["after_unknown"].(map[string]any)
}

func setActions(t *testing.T, m map[string]any, typ string, actions ...any) {
	t.Helper()
	c := testutil.Change(t, m, typ)["change"].(map[string]any)
	c["actions"] = actions
	if len(actions) == 1 && actions[0] == "delete" {
		c["before"], c["after"] = c["after"], nil
	}
}

func TestRealPlansAreClean(t *testing.T) {
	for _, f := range []string{"real/plan-create-offline.json", "real/plan-create-emulator.json", "real/plan-noop.json", "real/plan-update-prefix.json", "real/state-applied.json"} {
		if got := lines(run(testutil.Load(t, f), rules.Options{})); len(got) != 0 {
			t.Errorf("%s should be clean, got %v", f, got)
		}
	}
}

func TestEditedPlans(t *testing.T) {
	cases := []struct {
		name string
		edit func(t *testing.T, m map[string]any)
		want []string
	}{
		{"wildcard s3:* action", func(t *testing.T, m map[string]any) {
			d := testutil.Policy(t, m)
			testutil.Statement(d, 0)["Action"] = []any{"s3:*"}
			testutil.SetPolicy(t, m, d)
		}, []string{"TFG001 FINDING " + policyAddr}},
		{"bare * action as a string", func(t *testing.T, m map[string]any) {
			d := testutil.Policy(t, m)
			testutil.Statement(d, 1)["Action"] = "*"
			testutil.SetPolicy(t, m, d)
		}, []string{"TFG001 FINDING " + policyAddr}},
		{"Deny with a wildcard is not a finding", func(t *testing.T, m map[string]any) {
			d := testutil.Policy(t, m)
			s := testutil.Statement(d, 0)
			s["Effect"] = "Deny"
			s["Action"] = []any{"s3:*"}
			s["Resource"] = "*"
			testutil.SetPolicy(t, m, d)
		}, nil},
		{"Allow with NotAction", func(t *testing.T, m map[string]any) {
			d := testutil.Policy(t, m)
			s := testutil.Statement(d, 0)
			delete(s, "Action")
			s["NotAction"] = []any{"iam:*"}
			testutil.SetPolicy(t, m, d)
		}, []string{"TFG001 FINDING " + policyAddr}},
		{"wildcard resource", func(t *testing.T, m map[string]any) {
			d := testutil.Policy(t, m)
			testutil.Statement(d, 0)["Resource"] = "*"
			testutil.SetPolicy(t, m, d)
		}, []string{"TFG002 FINDING " + policyAddr}},
		{"every bucket", func(t *testing.T, m map[string]any) {
			d := testutil.Policy(t, m)
			testutil.Statement(d, 0)["Resource"] = "arn:aws:s3:::*"
			testutil.SetPolicy(t, m, d)
		}, []string{"TFG002 FINDING " + policyAddr}},
		{"Allow with NotResource", func(t *testing.T, m map[string]any) {
			d := testutil.Policy(t, m)
			s := testutil.Statement(d, 0)
			delete(s, "Resource")
			s["NotResource"] = "arn:aws:s3:::keep"
			testutil.SetPolicy(t, m, d)
		}, []string{"TFG002 FINDING " + policyAddr}},
		{"objects across the whole bucket", func(t *testing.T, m map[string]any) {
			d := testutil.Policy(t, m)
			testutil.Statement(d, 0)["Resource"] = bucketARN + "/*"
			testutil.SetPolicy(t, m, d)
		}, []string{"TFG003 FINDING " + policyAddr}},
		{"a key that only starts like the prefix", func(t *testing.T, m map[string]any) {
			d := testutil.Policy(t, m)
			testutil.Statement(d, 0)["Resource"] = bucketARN + "/executions-old/*"
			testutil.SetPolicy(t, m, d)
		}, []string{"TFG003 FINDING " + policyAddr}},
		{"list condition widened to everything", func(t *testing.T, m map[string]any) {
			d := testutil.Policy(t, m)
			testutil.Statement(d, 1)["Condition"] = map[string]any{"StringLike": map[string]any{"s3:prefix": []any{"*"}}}
			testutil.SetPolicy(t, m, d)
		}, []string{"TFG003 FINDING " + policyAddr}},
		{"list condition on a different prefix", func(t *testing.T, m map[string]any) {
			d := testutil.Policy(t, m)
			testutil.Statement(d, 1)["Condition"] = map[string]any{"StringLike": map[string]any{"s3:prefix": []any{"executions/*", "other/*"}}}
			testutil.SetPolicy(t, m, d)
		}, []string{"TFG003 FINDING " + policyAddr}},
		{"list with no condition, claim read from the lifecycle rule", func(t *testing.T, m map[string]any) {
			d := testutil.Policy(t, m)
			delete(testutil.Statement(d, 1), "Condition")
			testutil.SetPolicy(t, m, d)
		}, []string{"TFG003 FINDING " + policyAddr}},
		{"no prefix claimed anywhere is UNKNOWN, never clean", func(t *testing.T, m map[string]any) {
			d := testutil.Policy(t, m)
			delete(testutil.Statement(d, 1), "Condition")
			testutil.Statement(d, 0)["Resource"] = bucketARN + "/*"
			testutil.SetPolicy(t, m, d)
			testutil.Drop(m, "aws_s3_bucket_lifecycle_configuration")
		}, []string{"TFG003 UNKNOWN " + policyAddr, "TFG003 UNKNOWN " + policyAddr}},
		{"a policy for a bucket this plan does not hold is not judged", func(t *testing.T, m map[string]any) {
			d := testutil.Policy(t, m)
			testutil.Statement(d, 0)["Resource"] = "arn:aws:s3:::someone-elses-bucket/*"
			testutil.SetPolicy(t, m, d)
		}, nil},
		{"policy document known after apply", func(t *testing.T, m map[string]any) {
			delete(testutil.After(t, m, "aws_iam_policy"), "policy")
			unknownTree(t, m, "aws_iam_policy")["policy"] = true
		}, []string{"TFG001 UNKNOWN " + policyAddr, "TFG002 UNKNOWN " + policyAddr, "TFG003 UNKNOWN " + policyAddr}},
		{"bucket name known after apply with a known policy", func(t *testing.T, m map[string]any) {
			delete(testutil.After(t, m, "aws_s3_bucket"), "bucket")
			unknownTree(t, m, "aws_s3_bucket")["bucket"] = true
		}, []string{"TFG003 UNKNOWN " + policyAddr}},
		{"policy that is not JSON", func(t *testing.T, m map[string]any) {
			testutil.After(t, m, "aws_iam_policy")["policy"] = "{nope"
		}, []string{"TFG009 FINDING " + policyAddr}},
		{"policy with a bad Effect", func(t *testing.T, m map[string]any) {
			testutil.After(t, m, "aws_iam_policy")["policy"] = `{"Statement":[{"Effect":"Perhaps","Action":"s3:GetObject","Resource":"*"}]}`
		}, []string{"TFG009 FINDING " + policyAddr}},
		{"no public access block", func(t *testing.T, m map[string]any) { testutil.Drop(m, "aws_s3_bucket_public_access_block") },
			[]string{"TFG004 FINDING " + bucketAddr}},
		{"block_public_acls false", func(t *testing.T, m map[string]any) {
			testutil.After(t, m, "aws_s3_bucket_public_access_block")["block_public_acls"] = false
		}, []string{"TFG004 FINDING " + pabAddr}},
		{"block_public_policy false", func(t *testing.T, m map[string]any) {
			testutil.After(t, m, "aws_s3_bucket_public_access_block")["block_public_policy"] = false
		}, []string{"TFG004 FINDING " + pabAddr}},
		{"ignore_public_acls false", func(t *testing.T, m map[string]any) {
			testutil.After(t, m, "aws_s3_bucket_public_access_block")["ignore_public_acls"] = false
		}, []string{"TFG004 FINDING " + pabAddr}},
		{"restrict_public_buckets false", func(t *testing.T, m map[string]any) {
			testutil.After(t, m, "aws_s3_bucket_public_access_block")["restrict_public_buckets"] = false
		}, []string{"TFG004 FINDING " + pabAddr}},
		{"flag left unset", func(t *testing.T, m map[string]any) {
			delete(testutil.After(t, m, "aws_s3_bucket_public_access_block"), "restrict_public_buckets")
		}, []string{"TFG004 FINDING " + pabAddr}},
		{"two flags off give two findings", func(t *testing.T, m map[string]any) {
			a := testutil.After(t, m, "aws_s3_bucket_public_access_block")
			a["block_public_acls"], a["ignore_public_acls"] = false, false
		}, []string{"TFG004 FINDING " + pabAddr, "TFG004 FINDING " + pabAddr}},
		{"flag known after apply", func(t *testing.T, m map[string]any) {
			unknownTree(t, m, "aws_s3_bucket_public_access_block")["ignore_public_acls"] = true
		}, []string{"TFG004 UNKNOWN " + pabAddr}},
		{"no encryption configuration", func(t *testing.T, m map[string]any) {
			testutil.Drop(m, "aws_s3_bucket_server_side_encryption_configuration")
		}, []string{"TFG005 FINDING " + bucketAddr}},
		{"encryption rule with an empty algorithm", func(t *testing.T, m map[string]any) {
			r := testutil.After(t, m, "aws_s3_bucket_server_side_encryption_configuration")["rule"].([]any)[0].(map[string]any)
			r["apply_server_side_encryption_by_default"].([]any)[0].(map[string]any)["sse_algorithm"] = ""
		}, []string{"TFG005 FINDING " + sseAddr}},
		{"encryption with aws:kms is encryption", func(t *testing.T, m map[string]any) {
			r := testutil.After(t, m, "aws_s3_bucket_server_side_encryption_configuration")["rule"].([]any)[0].(map[string]any)
			r["apply_server_side_encryption_by_default"].([]any)[0].(map[string]any)["sse_algorithm"] = "aws:kms"
		}, nil},
		{"encryption algorithm known after apply", func(t *testing.T, m map[string]any) {
			a := testutil.After(t, m, "aws_s3_bucket_server_side_encryption_configuration")
			a["rule"].([]any)[0].(map[string]any)["apply_server_side_encryption_by_default"].([]any)[0].(map[string]any)["sse_algorithm"] = nil
			unknownTree(t, m, "aws_s3_bucket_server_side_encryption_configuration")["rule"] = []any{map[string]any{"apply_server_side_encryption_by_default": []any{map[string]any{"sse_algorithm": true}}}}
		}, []string{"TFG005 UNKNOWN " + sseAddr}},
		{"encryption rule list known after apply", func(t *testing.T, m map[string]any) {
			unknownTree(t, m, "aws_s3_bucket_server_side_encryption_configuration")["rule"] = true
		}, []string{"TFG005 UNKNOWN " + sseAddr}},
		{"no versioning configuration", func(t *testing.T, m map[string]any) { testutil.Drop(m, "aws_s3_bucket_versioning") },
			[]string{"TFG006 FINDING " + bucketAddr}},
		{"versioning Suspended", func(t *testing.T, m map[string]any) {
			testutil.After(t, m, "aws_s3_bucket_versioning")["versioning_configuration"].([]any)[0].(map[string]any)["status"] = "Suspended"
		}, []string{"TFG006 FINDING " + verAddr}},
		{"versioning Disabled", func(t *testing.T, m map[string]any) {
			testutil.After(t, m, "aws_s3_bucket_versioning")["versioning_configuration"].([]any)[0].(map[string]any)["status"] = "Disabled"
		}, []string{"TFG006 FINDING " + verAddr}},
		{"versioning status known after apply", func(t *testing.T, m map[string]any) {
			testutil.After(t, m, "aws_s3_bucket_versioning")["versioning_configuration"].([]any)[0].(map[string]any)["status"] = nil
			unknownTree(t, m, "aws_s3_bucket_versioning")["versioning_configuration"] = []any{map[string]any{"status": true}}
		}, []string{"TFG006 UNKNOWN " + verAddr}},
		{"public access block planned for delete", func(t *testing.T, m map[string]any) {
			setActions(t, m, "aws_s3_bucket_public_access_block", "delete")
		}, []string{"TFG004 FINDING " + bucketAddr, "TFG007 FINDING " + pabAddr}},
		{"bucket replaced delete then create", func(t *testing.T, m map[string]any) {
			setActions(t, m, "aws_s3_bucket", "delete", "create")
		}, []string{"TFG008 FINDING " + bucketAddr}},
		{"bucket replaced create then delete", func(t *testing.T, m map[string]any) {
			setActions(t, m, "aws_s3_bucket", "create", "delete")
		}, []string{"TFG008 FINDING " + bucketAddr}},
		{"in place update is fine", func(t *testing.T, m map[string]any) {
			setActions(t, m, "aws_s3_bucket", "update")
		}, nil},
		{"no-op is fine", func(t *testing.T, m map[string]any) {
			setActions(t, m, "aws_s3_bucket", "no-op")
		}, nil},
		{"a deleted IAM user is not a finding of the S3 rules", func(t *testing.T, m map[string]any) {
			setActions(t, m, "aws_iam_user", "delete")
		}, []string{"TFG007 FINDING aws_iam_user.archive_writer"}},
	}
	for _, c := range cases {
		m := testutil.ReadMap(t, "real/plan-create-offline.json")
		c.edit(t, m)
		got := lines(run(testutil.Parse(t, m), rules.Options{}))
		if c.want == nil {
			c.want = []string{}
		}
		if !reflect.DeepEqual(got, c.want) {
			t.Errorf("%s:\n got %v\nwant %v", c.name, got, c.want)
		}
	}
}

func TestPrefixOptionOverridesTheClaim(t *testing.T) {
	doc := testutil.Load(t, "real/plan-create-offline.json")
	got := lines(run(doc, rules.Options{Prefix: "reports/"}))
	want := []string{"TFG003 FINDING " + policyAddr, "TFG003 FINDING " + policyAddr}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("--prefix reports/ against an executions/ policy: got %v want %v", got, want)
	}
	if got := lines(run(doc, rules.Options{Prefix: "executions/"})); len(got) != 0 {
		t.Errorf("--prefix executions/ matches the policy, got %v", got)
	}
}

func TestStateInput(t *testing.T) {
	m := testutil.ReadMap(t, "real/state-applied.json")
	for _, r := range m["values"].(map[string]any)["root_module"].(map[string]any)["resources"].([]any) {
		rm := r.(map[string]any)
		if rm["type"] == "aws_s3_bucket_public_access_block" {
			rm["values"].(map[string]any)["restrict_public_buckets"] = false
		}
		if rm["type"] == "aws_s3_bucket_versioning" {
			rm["values"].(map[string]any)["versioning_configuration"].([]any)[0].(map[string]any)["status"] = "Suspended"
		}
	}
	got := lines(run(testutil.Parse(t, m), rules.Options{}))
	want := []string{"TFG004 FINDING " + pabAddr, "TFG006 FINDING " + verAddr}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("state with two broken settings: got %v want %v", got, want)
	}
}

func TestVariantFixtures(t *testing.T) {
	cases := []struct {
		file string
		want []string
	}{
		{"variants/wildcard-action.json", []string{"TFG001 FINDING " + policyAddr}},
		{"variants/wildcard-resource.json", []string{"TFG002 FINDING " + policyAddr}},
		{"variants/wide-resource.json", []string{"TFG003 FINDING " + policyAddr, "TFG003 FINDING " + policyAddr}},
		{"variants/missing-public-access-block.json", []string{"TFG004 FINDING " + bucketAddr}},
		{"variants/public-access-block-off.json", []string{"TFG004 FINDING " + pabAddr}},
		{"variants/no-encryption-versioning-suspended.json", []string{"TFG005 FINDING " + bucketAddr, "TFG006 FINDING " + verAddr}},
		{"variants/delete-and-replace-planned.json", []string{"TFG004 FINDING " + bucketAddr, "TFG007 FINDING " + pabAddr, "TFG008 FINDING " + bucketAddr}},
		{"variants/unknown-values.json", []string{"TFG001 UNKNOWN " + policyAddr, "TFG002 UNKNOWN " + policyAddr, "TFG003 UNKNOWN " + policyAddr, "TFG004 UNKNOWN " + pabAddr, "TFG006 UNKNOWN " + verAddr}},
		{"variants/policy-not-json.json", []string{"TFG009 FINDING " + policyAddr}},
		{"variants/widened-policy.json", []string{"TFG001 FINDING " + policyAddr, "TFG003 FINDING " + policyAddr, "TFG003 FINDING " + policyAddr}},
		{"real/plan-replace-bucket.json", []string{
			"TFG008 FINDING " + bucketAddr,
			"TFG008 FINDING aws_s3_bucket_lifecycle_configuration.archive",
			"TFG008 FINDING " + pabAddr,
			"TFG008 FINDING " + sseAddr,
			"TFG008 FINDING " + verAddr,
		}},
	}
	for _, c := range cases {
		if got := lines(run(testutil.Load(t, c.file), rules.Options{})); !reflect.DeepEqual(got, c.want) {
			t.Errorf("%s:\n got %v\nwant %v", c.file, got, c.want)
		}
	}
}

// Every message must say what was read, what was expected and the resource address, and be one sentence.
func TestMessageShape(t *testing.T) {
	files := []string{
		"variants/wildcard-action.json", "variants/wildcard-resource.json", "variants/wide-resource.json", "variants/missing-public-access-block.json",
		"variants/public-access-block-off.json", "variants/no-encryption-versioning-suspended.json", "variants/delete-and-replace-planned.json",
		"variants/unknown-values.json", "variants/policy-not-json.json", "variants/widened-policy.json", "real/plan-replace-bucket.json",
	}
	seen := 0
	for _, f := range files {
		for _, r := range run(testutil.Load(t, f), rules.Options{}) {
			seen++
			m := r.Message
			if !strings.HasPrefix(m, r.Address+": read ") {
				t.Errorf("%s %s: message does not start with the address and what was read: %q", f, r.Code, m)
			}
			if !strings.Contains(m, "expected ") {
				t.Errorf("%s %s: message does not say what was expected: %q", f, r.Code, m)
			}
			if !strings.HasSuffix(m, ".") || strings.Count(m, ". ") > 0 || strings.Contains(m, "\n") {
				t.Errorf("%s %s: message is not one sentence: %q", f, r.Code, m)
			}
			if r.Status == rules.Unknown && !strings.Contains(m, "known after apply") {
				t.Errorf("%s %s: an UNKNOWN must give its reason: %q", f, r.Code, m)
			}
		}
	}
	if seen < 20 {
		t.Errorf("only %d results checked, the fixtures changed", seen)
	}
}

func TestRuleTable(t *testing.T) {
	var codes []string
	seen := map[string]bool{}
	for _, r := range rules.Rules {
		if seen[r.Code] || r.Name == "" || r.Run == nil {
			t.Errorf("rule %+v is duplicated or incomplete", r)
		}
		seen[r.Code] = true
		codes = append(codes, r.Code)
	}
	want := []string{"TFG001", "TFG002", "TFG003", "TFG004", "TFG005", "TFG006", "TFG007", "TFG008", "TFG009"}
	if !reflect.DeepEqual(codes, want) {
		t.Errorf("codes %v, want %v: codes are stable, so a removed or renumbered rule is a breaking change", codes, want)
	}
}

func TestResultsAreSortedAndStable(t *testing.T) {
	doc := testutil.Load(t, "variants/delete-and-replace-planned.json")
	a, b := lines(run(doc, rules.Options{})), lines(run(doc, rules.Options{}))
	if !reflect.DeepEqual(a, b) {
		t.Errorf("two runs differ: %v %v", a, b)
	}
	for i := 1; i < len(a); i++ {
		if a[i-1] > a[i] {
			t.Errorf("results are not sorted by code then address: %v", a)
		}
	}
}
