package iam_test

import (
	"reflect"
	"strings"
	"testing"

	"github.com/Exalt24/autoflow-pro/deploy/aws/tfgraph/internal/graph"
	"github.com/Exalt24/autoflow-pro/deploy/aws/tfgraph/internal/iam"
	"github.com/Exalt24/autoflow-pro/deploy/aws/tfgraph/internal/testutil"
)

func TestParsePolicy(t *testing.T) {
	cases := []struct {
		name string
		doc  string
		want iam.Policy
	}{
		{
			name: "one statement object with string fields",
			doc:  `{"Version":"2012-10-17","Statement":{"Sid":"One","Effect":"Allow","Action":"s3:GetObject","Resource":"arn:aws:s3:::b/*"}}`,
			want: iam.Policy{Version: "2012-10-17", Statements: []iam.Statement{{Sid: "One", Effect: "Allow", Actions: []string{"s3:GetObject"}, Resources: []string{"arn:aws:s3:::b/*"}}}},
		},
		{
			name: "list fields and a condition with a list value",
			doc:  `{"Statement":[{"Effect":"Allow","Action":["s3:ListBucket"],"Resource":["arn:aws:s3:::b"],"Condition":{"StringLike":{"s3:prefix":["a/*","b/*"]}}}]}`,
			want: iam.Policy{Statements: []iam.Statement{{Effect: "Allow", Actions: []string{"s3:ListBucket"}, Resources: []string{"arn:aws:s3:::b"},
				Conditions: []iam.Condition{{Operator: "StringLike", Key: "s3:prefix", Values: []string{"a/*", "b/*"}}}}}},
		},
		{
			name: "condition with a bool value and two operators sorted",
			doc:  `{"Statement":[{"Effect":"Deny","Action":"*","Resource":"*","Condition":{"Bool":{"aws:SecureTransport":false},"ArnLike":{"aws:SourceArn":"arn:aws:x:*"}}}]}`,
			want: iam.Policy{Statements: []iam.Statement{{Effect: "Deny", Actions: []string{"*"}, Resources: []string{"*"},
				Conditions: []iam.Condition{{Operator: "ArnLike", Key: "aws:SourceArn", Values: []string{"arn:aws:x:*"}}, {Operator: "Bool", Key: "aws:SecureTransport", Values: []string{"false"}}}}}},
		},
		{
			name: "NotAction and NotResource",
			doc:  `{"Statement":[{"Effect":"Allow","NotAction":["iam:*"],"NotResource":"arn:aws:s3:::keep"}]}`,
			want: iam.Policy{Statements: []iam.Statement{{Effect: "Allow", NotActions: []string{"iam:*"}, NotResources: []string{"arn:aws:s3:::keep"}}}},
		},
	}
	for _, c := range cases {
		got, err := iam.Parse(c.doc)
		if err != nil {
			t.Errorf("%s: %v", c.name, err)
			continue
		}
		if !reflect.DeepEqual(*got, c.want) {
			t.Errorf("%s:\n got %+v\nwant %+v", c.name, *got, c.want)
		}
	}
}

func TestParsePolicyErrors(t *testing.T) {
	cases := []struct{ name, doc, want string }{
		{"not json", "{nope", "not a JSON object"},
		{"no statement", `{"Version":"2012-10-17"}`, "no Statement"},
		{"statement is a number", `{"Statement":5}`, "statement 1 is not a JSON object"},
		{"bad effect", `{"Statement":[{"Effect":"Maybe","Action":"s3:*","Resource":"*"}]}`, `Effect "Maybe"`},
		{"missing effect", `{"Statement":[{"Action":"s3:*","Resource":"*"}]}`, `Effect ""`},
		{"action is a number", `{"Statement":[{"Effect":"Allow","Action":5,"Resource":"*"}]}`, "Action"},
		{"statement is a string", `{"Statement":["x"]}`, "statement 1"},
	}
	for _, c := range cases {
		_, err := iam.Parse(c.doc)
		if err == nil {
			t.Errorf("%s: want an error", c.name)
		} else if !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s: error %q lacks %q", c.name, err, c.want)
		}
	}
}

func TestStatementLabelAndDescribe(t *testing.T) {
	named := iam.Statement{Sid: "Read", Effect: "Allow", Actions: []string{"s3:GetObject", "s3:PutObject"}, Resources: []string{"arn:aws:s3:::b/x/*"}}
	if named.Label(3) != "Read" {
		t.Errorf("label %q", named.Label(3))
	}
	if got := named.Describe(); got != "Allow s3:GetObject s3:PutObject on arn:aws:s3:::b/x/*, no condition" {
		t.Errorf("describe %q", got)
	}
	bare := iam.Statement{Effect: "Allow", NotActions: []string{"iam:*"}, NotResources: []string{"arn:aws:s3:::keep"},
		Conditions: []iam.Condition{{Operator: "StringLike", Key: "s3:prefix", Values: []string{"a/*", "b/*"}}}}
	if bare.Label(1) != "#2" {
		t.Errorf("label %q", bare.Label(1))
	}
	want := "Allow every action except iam:* on every resource except arn:aws:s3:::keep, when StringLike s3:prefix is a/* or b/*"
	if got := bare.Describe(); got != want {
		t.Errorf("describe %q, want %q", got, want)
	}
}

func TestS3Resource(t *testing.T) {
	cases := []struct {
		arn         string
		bucket, key string
		object, ok  bool
	}{
		{"arn:aws:s3:::my-bucket", "my-bucket", "", false, true},
		{"arn:aws:s3:::my-bucket/executions/*", "my-bucket", "executions/*", true, true},
		{"arn:aws:s3:::my-bucket/*", "my-bucket", "*", true, true},
		{"arn:aws-cn:s3:::my-bucket/a", "my-bucket", "a", true, true},
		{"arn:aws:s3:::*", "*", "", false, true},
		{"arn:aws:s3:::my-bucket/", "my-bucket", "", true, true},
		{"arn:aws:iam::123456789012:user/x", "", "", false, false},
		{"*", "", "", false, false},
	}
	for _, c := range cases {
		bucket, key, object, ok := iam.S3Resource(c.arn)
		if bucket != c.bucket || key != c.key || object != c.object || ok != c.ok {
			t.Errorf("S3Resource(%q) = %q %q %v %v, want %q %q %v %v", c.arn, bucket, key, object, ok, c.bucket, c.key, c.object, c.ok)
		}
	}
}

func TestDocuments(t *testing.T) {
	doc := testutil.Load(t, "real/plan-create-offline.json")
	docs := iam.Documents(doc)
	if len(docs) != 1 || docs[0].Resource.Address != "aws_iam_policy.archive_access" || docs[0].Policy == nil {
		t.Fatalf("documents %+v", docs)
	}
	if n := len(docs[0].Policy.Statements); n != 2 {
		t.Errorf("%d statements, want 2", n)
	}

	m := testutil.ReadMap(t, "real/plan-create-offline.json")
	delete(testutil.After(t, m, "aws_iam_policy"), "policy")
	testutil.Change(t, m, "aws_iam_policy")["change"].(map[string]any)["after_unknown"].(map[string]any)["policy"] = true
	if d := iam.Documents(testutil.Parse(t, m)); len(d) != 1 || !d[0].Unknown || d[0].Policy != nil {
		t.Errorf("an unknown document must be flagged unknown: %+v", d)
	}

	m = testutil.ReadMap(t, "real/plan-create-offline.json")
	testutil.After(t, m, "aws_iam_policy")["policy"] = "{bad"
	if d := iam.Documents(testutil.Parse(t, m)); len(d) != 1 || d[0].Err == "" || d[0].Unknown {
		t.Errorf("a bad document must carry an error: %+v", d)
	}

	m = testutil.ReadMap(t, "real/plan-create-offline.json")
	c := testutil.Change(t, m, "aws_iam_policy")["change"].(map[string]any)
	c["actions"] = []any{"delete"}
	c["before"], c["after"] = c["after"], nil
	if d := iam.Documents(testutil.Parse(t, m)); len(d) != 0 {
		t.Errorf("a policy the plan deletes is not a document that will exist: %+v", d)
	}
}

func TestResolveRealPlan(t *testing.T) {
	doc := testutil.Load(t, "real/plan-create-offline.json")
	g := graph.Build(doc)
	access := iam.Resolve(doc, g)
	if len(access) != 1 {
		t.Fatalf("users %+v", access)
	}
	u := access[0]
	if u.Address != "aws_iam_user.archive_writer" || u.Name != "autoflow-archive-user" || len(u.Policies) != 1 {
		t.Fatalf("user %+v", u)
	}
	p := u.Policies[0]
	if p.Address != "aws_iam_policy.archive_access" || p.Name != "autoflow-archive-policy" || p.Via != "attachment aws_iam_user_policy_attachment.archive_writer" || p.Policy == nil {
		t.Fatalf("policy %+v", p)
	}
	st := p.Policy.Statements
	if len(st) != 2 || st[0].Sid != "ArchiveObjects" || len(st[0].Actions) != 5 || st[1].Conditions[0].Key != "s3:prefix" {
		t.Errorf("statements %+v", st)
	}
	if !g.HasEdge("aws_iam_policy.archive_access", "aws_s3_bucket.archive") {
		t.Error("Resolve must add a grant edge from the policy to the bucket it names")
	}
	for _, e := range g.Edges() {
		if e.From == "aws_iam_policy.archive_access" && e.To == "aws_s3_bucket.archive" && !reflect.DeepEqual(e.Reasons, []string{"grant statement ArchiveObjects", "grant statement ListArchivePrefix"}) {
			t.Errorf("grant reasons %v", e.Reasons)
		}
	}
}

func TestResolveFromState(t *testing.T) {
	doc := testutil.Load(t, "real/state-applied.json")
	access := iam.Resolve(doc, graph.Build(doc))
	if len(access) != 1 || len(access[0].Policies) != 1 || access[0].Policies[0].Policy == nil {
		t.Fatalf("a state must resolve the same user to the same policy: %+v", access)
	}
}

func TestResolveManagedAndUnresolvedPolicies(t *testing.T) {
	m := testutil.ReadMap(t, "real/plan-create-offline.json")
	// Point the attachment at an AWS managed policy by literal ARN and drop the reference to the policy resource
	att := testutil.Change(t, m, "aws_iam_user_policy_attachment")["change"].(map[string]any)
	att["after"].(map[string]any)["policy_arn"] = "arn:aws:iam::aws:policy/ReadOnlyAccess"
	delete(att["after_unknown"].(map[string]any), "policy_arn")
	cfg := m["configuration"].(map[string]any)["root_module"].(map[string]any)["resources"].([]any)
	for _, r := range cfg {
		if rm := r.(map[string]any); rm["type"] == "aws_iam_user_policy_attachment" {
			delete(rm["expressions"].(map[string]any), "policy_arn")
		}
	}
	doc := testutil.Parse(t, m)
	access := iam.Resolve(doc, graph.Build(doc))
	if len(access) != 1 || len(access[0].Policies) != 1 || access[0].Policies[0].ManagedARN != "arn:aws:iam::aws:policy/ReadOnlyAccess" || access[0].Policies[0].Policy != nil {
		t.Errorf("a literal AWS managed policy ARN is listed by ARN without statements: %+v", access)
	}

	// policy_arn unknown and no reference that says which policy it is
	m = testutil.ReadMap(t, "real/plan-create-offline.json")
	cfg = m["configuration"].(map[string]any)["root_module"].(map[string]any)["resources"].([]any)
	for _, r := range cfg {
		if rm := r.(map[string]any); rm["type"] == "aws_iam_user_policy_attachment" {
			delete(rm["expressions"].(map[string]any), "policy_arn")
		}
	}
	doc = testutil.Parse(t, m)
	access = iam.Resolve(doc, graph.Build(doc))
	if len(access[0].Policies) != 1 || !strings.Contains(access[0].Policies[0].Unresolved, "known only after apply") {
		t.Errorf("an unknown policy_arn with no reference must be reported unresolved with the reason: %+v", access[0].Policies)
	}
}
