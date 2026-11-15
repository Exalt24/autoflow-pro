package plan_test

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Exalt24/autoflow-pro/deploy/aws/tfgraph/internal/plan"
	"github.com/Exalt24/autoflow-pro/deploy/aws/tfgraph/internal/testutil"
)

func TestConfigAddress(t *testing.T) {
	cases := []struct{ in, want string }{
		{"aws_s3_bucket.archive", "aws_s3_bucket.archive"},
		{"aws_iam_access_key.archive_writer[0]", "aws_iam_access_key.archive_writer"},
		{`module.net[1].aws_subnet.private["a"]`, "module.net.aws_subnet.private"},
		{"data.aws_partition.current", "data.aws_partition.current"},
	}
	for _, c := range cases {
		if got := plan.ConfigAddress(c.in); got != c.want {
			t.Errorf("ConfigAddress(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestNormalizeReference(t *testing.T) {
	cases := []struct{ name, prefix, in, want string }{
		{"resource attribute", "", "aws_s3_bucket.archive.id", "aws_s3_bucket.archive"},
		{"resource itself", "", "aws_s3_bucket.archive", "aws_s3_bucket.archive"},
		{"indexed resource", "", "aws_iam_access_key.archive_writer[0].id", "aws_iam_access_key.archive_writer"},
		{"variable", "", "var.region", "var.region"},
		{"variable attribute", "", "var.cfg.name", "var.cfg"},
		{"local", "", "local.bucket_arn", "local.bucket_arn"},
		{"data source", "", "data.aws_partition.current.partition", "data.aws_partition.current"},
		{"module output", "", "module.net.vpc_id", "module.net"},
		{"inside a module", "module.net.", "aws_subnet.a.id", "module.net.aws_subnet.a"},
		{"inside a module variable", "module.net.", "var.cidr", "module.net.var.cidr"},
		{"each iterator", "", "each.value", ""},
		{"count iterator", "", "count.index", ""},
		{"self", "", "self.id", ""},
		{"one token", "", "region", ""},
		{"short data reference", "", "data.aws_partition", ""},
	}
	for _, c := range cases {
		if got := plan.NormalizeReference(c.prefix, c.in); got != c.want {
			t.Errorf("%s: NormalizeReference(%q, %q) = %q, want %q", c.name, c.prefix, c.in, got, c.want)
		}
	}
}

func TestParseRejectsBadInput(t *testing.T) {
	cases := []struct {
		name, body string
		wantRead   string // a fragment of what the message says was read
	}{
		{"empty file", "", "an empty file"},
		{"whitespace only", "  \n", "an empty file"},
		{"not json", "{nope", "syntax error at byte"},
		{"json array", "[1,2]", "not a JSON object"},
		{"wrong field type", `{"resource_changes": {"a": 1}}`, `field "resource_changes"`},
		{"neither plan nor state", `{"format_version":"1.2","terraform_version":"1.16.6"}`, "neither resource_changes"},
		{"future format", `{"format_version":"2.0","resource_changes":[]}`, "format_version 2.0"},
		{"errored plan", `{"format_version":"1.2","errored":true,"resource_changes":[]}`, "errored set to true"},
	}
	for _, c := range cases {
		_, err := plan.Parse("in.json", []byte(c.body))
		var ie *plan.InputError
		if !errors.As(err, &ie) {
			t.Errorf("%s: want an InputError, got %v", c.name, err)
			continue
		}
		msg := err.Error()
		for _, part := range []string{"in.json", "read ", "expected "} {
			if !strings.Contains(msg, part) {
				t.Errorf("%s: message %q lacks %q", c.name, msg, part)
			}
		}
		if !strings.Contains(msg, c.wantRead) {
			t.Errorf("%s: message %q does not say it read %q", c.name, msg, c.wantRead)
		}
	}
}

func TestLoadMissingFile(t *testing.T) {
	_, err := plan.Load(filepath.Join(t.TempDir(), "absent.json"))
	if err == nil {
		t.Fatal("want an error for a missing file")
	}
	if msg := err.Error(); !strings.Contains(msg, "absent.json") || !strings.Contains(msg, "read nothing") || !strings.Contains(msg, "terraform show -json") {
		t.Errorf("message does not name the file, what was read and what was expected: %q", msg)
	}
}

func TestLoadRealFixtures(t *testing.T) {
	cases := []struct {
		file      string
		kind      plan.Kind
		resources int
		config    bool
	}{
		{"real/plan-create-offline.json", plan.KindPlan, 10, true},
		{"real/plan-create-emulator.json", plan.KindPlan, 11, true},
		{"real/plan-noop.json", plan.KindPlan, 10, true},
		{"real/plan-replace-bucket.json", plan.KindPlan, 9, true},
		{"real/state-applied.json", plan.KindState, 10, false},
	}
	for _, c := range cases {
		doc := testutil.Load(t, c.file)
		if doc.Kind != c.kind {
			t.Errorf("%s: kind %s, want %s", c.file, doc.Kind, c.kind)
		}
		if len(doc.Resources) != c.resources {
			t.Errorf("%s: %d resources, want %d", c.file, len(doc.Resources), c.resources)
		}
		if doc.HasConfiguration != c.config {
			t.Errorf("%s: HasConfiguration %v, want %v", c.file, doc.HasConfiguration, c.config)
		}
		if doc.TerraformVersion != "1.16.6" {
			t.Errorf("%s: terraform version %q", c.file, doc.TerraformVersion)
		}
	}
}

func TestPlanActionsAndUnknowns(t *testing.T) {
	doc := testutil.Load(t, "real/plan-create-offline.json")
	byAddr := map[string]*plan.Resource{}
	for _, r := range doc.Resources {
		byAddr[r.Address] = r
	}
	key := byAddr["aws_iam_access_key.archive_writer[0]"]
	if key == nil || key.ConfigAddress != "aws_iam_access_key.archive_writer" {
		t.Fatalf("access key instance missing or wrong config address: %+v", key)
	}
	if len(key.Actions) != 1 || key.Actions[0] != "create" {
		t.Errorf("access key actions %v", key.Actions)
	}
	att := byAddr["aws_iam_user_policy_attachment.archive_writer"]
	if a := att.Attr("policy_arn"); !a.Unknown || a.Found {
		t.Errorf("policy_arn should be unknown after apply, got %+v", a)
	}
	if s, ok := att.Attr("user").String(); !ok || s != "autoflow-archive-user" {
		t.Errorf("user = %q, %v", s, ok)
	}
	vers := byAddr["aws_s3_bucket_versioning.archive"]
	if s, ok := vers.Attr("versioning_configuration", "0", "status").String(); !ok || s != "Enabled" {
		t.Errorf("nested status = %q, %v", s, ok)
	}
	if a := vers.Attr("versioning_configuration", "5", "status"); a.Found || a.Unknown {
		t.Errorf("an index past the end must be not found, got %+v", a)
	}
	if a := vers.Attr("no_such_field"); a.Found {
		t.Errorf("a missing field must be not found, got %+v", a)
	}
}

func TestUnknownParentBlockCoversNestedPaths(t *testing.T) {
	r := &plan.Resource{
		Values:  map[string]any{"rule": []any{map[string]any{"status": "Enabled", "id": "a"}}},
		Unknown: map[string]any{"rule": true},
	}
	for _, path := range [][]string{{"rule"}, {"rule", "0"}, {"rule", "0", "status"}} {
		if a := r.Attr(path...); !a.Unknown || a.Found {
			t.Errorf("%v under an unknown block must be unknown, got %+v", path, a)
		}
	}
	partly := &plan.Resource{
		Values:  map[string]any{"rule": []any{map[string]any{"status": "Enabled", "id": "a"}}},
		Unknown: map[string]any{"rule": []any{map[string]any{"id": true}}},
	}
	if a := partly.Attr("rule", "0", "status"); a.Unknown || !a.Found {
		t.Errorf("a sibling of the unknown value stays known, got %+v", a)
	}
	if a := partly.Attr("rule", "0", "id"); !a.Unknown {
		t.Errorf("the unknown value is unknown, got %+v", a)
	}
}

func TestLive(t *testing.T) {
	cases := []struct {
		actions []string
		want    bool
	}{
		{[]string{"create"}, true},
		{[]string{"no-op"}, true},
		{[]string{"update"}, true},
		{[]string{"delete", "create"}, true},
		{[]string{"create", "delete"}, true},
		{[]string{"delete"}, false},
		{nil, true},
	}
	for _, c := range cases {
		r := &plan.Resource{Actions: c.actions}
		if r.Live() != c.want {
			t.Errorf("Live() for %v = %v, want %v", c.actions, r.Live(), c.want)
		}
	}
}

func TestDeletedResourceHasNoValues(t *testing.T) {
	body := `{"format_version":"1.2","planned_values":{},"resource_changes":[{"address":"aws_s3_bucket.old","mode":"managed","type":"aws_s3_bucket","name":"old","change":{"actions":["delete"],"before":{"bucket":"old"},"after":null}}]}`
	doc, err := plan.Parse("x.json", []byte(body))
	if err != nil {
		t.Fatal(err)
	}
	r := doc.Resources[0]
	if r.Values != nil || r.Before["bucket"] != "old" || r.Live() {
		t.Errorf("a deleted resource keeps before and has no values: %+v", r)
	}
}

func TestModuleConfigurationReferences(t *testing.T) {
	body := `{"format_version":"1.2","planned_values":{},"resource_changes":[],
	"configuration":{"root_module":{"resources":[],"module_calls":{"net":{"module":{"resources":[
	  {"address":"aws_subnet.a","mode":"managed","type":"aws_subnet","name":"a","expressions":{"vpc_id":{"references":["aws_vpc.main.id","aws_vpc.main"]},"tags":[{"Name":{"references":["var.name"]}}]},"depends_on":["aws_vpc.main"]}
	]}}}}}}`
	doc, err := plan.Parse("x.json", []byte(body))
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]bool{
		"module.net.aws_subnet.a>module.net.aws_vpc.main>config>vpc_id":  true,
		"module.net.aws_subnet.a>module.net.var.name>config>tags.0.Name": true,
		"module.net.aws_subnet.a>module.net.aws_vpc.main>depends_on>":    true,
	}
	for _, r := range doc.Refs {
		delete(want, r.From+">"+r.To+">"+r.Kind+">"+r.Via)
	}
	if len(want) != 0 {
		t.Errorf("missing references: %v (got %+v)", want, doc.Refs)
	}
}

func TestParseFromTempFile(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "state.json")
	body := `{"format_version":"1.0","values":{"root_module":{"resources":[{"address":"aws_iam_user.u","mode":"managed","type":"aws_iam_user","name":"u","values":{"name":"u"},"depends_on":["aws_x.y"]}]}}}`
	if err := os.WriteFile(p, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	doc, err := plan.Load(p)
	if err != nil {
		t.Fatal(err)
	}
	if doc.Kind != plan.KindState || len(doc.Resources) != 1 || len(doc.Refs) != 1 || doc.Refs[0].Kind != "state" {
		t.Errorf("state parse: %+v refs %+v", doc, doc.Refs)
	}
}
