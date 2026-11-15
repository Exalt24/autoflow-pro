package graph_test

import (
	"reflect"
	"strings"
	"testing"

	"github.com/Exalt24/autoflow-pro/deploy/aws/tfgraph/internal/graph"
	"github.com/Exalt24/autoflow-pro/deploy/aws/tfgraph/internal/plan"
	"github.com/Exalt24/autoflow-pro/deploy/aws/tfgraph/internal/testutil"
)

// edgeStrings renders edges as "from>to>kinds" for comparison.
func edgeStrings(g *graph.Graph) []string {
	var out []string
	for _, e := range g.Edges() {
		out = append(out, e.From+">"+e.To+">"+strings.Join(e.Kinds, "+"))
	}
	return out
}

func buildFrom(t *testing.T, body string) *graph.Graph {
	t.Helper()
	doc, err := plan.Parse("t.json", []byte(body))
	if err != nil {
		t.Fatal(err)
	}
	return graph.Build(doc)
}

const miniPlan = `{"format_version":"1.2","planned_values":{},
"resource_changes":[
 {"address":"aws_s3_bucket.b","mode":"managed","type":"aws_s3_bucket","name":"b","change":{"actions":["create"],"after":{"bucket":"bk"},"after_unknown":{"id":true}}},
 {"address":"aws_s3_bucket_versioning.v","mode":"managed","type":"aws_s3_bucket_versioning","name":"v","change":{"actions":["create"],"after":{},"after_unknown":{"bucket":true}}},
 {"address":"aws_iam_user.u","mode":"managed","type":"aws_iam_user","name":"u","change":{"actions":["create"],"after":{"name":"uu"},"after_unknown":{}}},
 {"address":"aws_iam_access_key.k[0]","mode":"managed","type":"aws_iam_access_key","name":"k","change":{"actions":["create"],"after":{"user":"uu"},"after_unknown":{}}}
],
"configuration":{"root_module":{"resources":[
 {"address":"aws_s3_bucket.b","mode":"managed","type":"aws_s3_bucket","name":"b","expressions":{"bucket":{"references":["var.name"]}}},
 {"address":"aws_s3_bucket_versioning.v","mode":"managed","type":"aws_s3_bucket_versioning","name":"v","expressions":{"bucket":{"references":["aws_s3_bucket.b.id","aws_s3_bucket.b"]}},"depends_on":["aws_iam_user.u"]},
 {"address":"aws_iam_access_key.k","mode":"managed","type":"aws_iam_access_key","name":"k","expressions":{"user":{"references":["aws_iam_user.u.name","aws_iam_user.u"]}},"count_expression":{"references":["var.make_key"]}}
]}}}`

func TestBuildFromConfiguration(t *testing.T) {
	g := buildFrom(t, miniPlan)
	want := []string{
		"aws_iam_access_key.k>aws_iam_user.u>config+value",
		"aws_iam_access_key.k>var.make_key>config",
		"aws_s3_bucket.b>var.name>config",
		"aws_s3_bucket_versioning.v>aws_iam_user.u>depends_on",
		"aws_s3_bucket_versioning.v>aws_s3_bucket.b>config",
	}
	if got := edgeStrings(g); !reflect.DeepEqual(got, want) {
		t.Errorf("edges\n got %v\nwant %v", got, want)
	}
	if n := g.Nodes["aws_iam_access_key.k"]; n == nil || len(n.Instances) != 1 || n.Instances[0].Address != "aws_iam_access_key.k[0]" {
		t.Errorf("the count instance must sit on the node without its index: %+v", n)
	}
	if g.Nodes["var.name"].Kind != graph.KindVariable {
		t.Errorf("var.name kind %q", g.Nodes["var.name"].Kind)
	}
}

func TestNoSelfEdgesAndUnknownTargetsDropped(t *testing.T) {
	g := buildFrom(t, `{"format_version":"1.2","planned_values":{},"resource_changes":[
 {"address":"aws_x.a","mode":"managed","type":"aws_x","name":"a","change":{"actions":["create"],"after":{},"after_unknown":{}}}],
 "configuration":{"root_module":{"resources":[
 {"address":"aws_x.a","mode":"managed","type":"aws_x","name":"a","expressions":{"self_ref":{"references":["aws_x.a.id"]},"dyn":{"references":["endpoints.value","aws_missing.thing.id","each.key"]}}}]}}}`)
	if got := edgeStrings(g); len(got) != 0 {
		t.Errorf("want no edges, got %v", got)
	}
	if _, ok := g.Nodes["aws_missing.thing"]; ok {
		t.Error("a resource this input does not hold must not become a node")
	}
}

func TestEdgeQueries(t *testing.T) {
	g := buildFrom(t, miniPlan)
	if !g.HasEdge("aws_s3_bucket_versioning.v", "aws_s3_bucket.b") || g.HasEdge("aws_s3_bucket.b", "aws_s3_bucket_versioning.v") {
		t.Error("edges point from the reader to what it reads, not the other way")
	}
	if !g.EdgeVia("aws_s3_bucket_versioning.v", "aws_s3_bucket.b", "bucket") {
		t.Error("EdgeVia must find the bucket attribute")
	}
	if g.EdgeVia("aws_s3_bucket_versioning.v", "aws_s3_bucket.b", "versioning") {
		t.Error("EdgeVia must not find an attribute that is not there")
	}
	if got := g.Dependents("aws_s3_bucket.b"); !reflect.DeepEqual(got, []string{"aws_s3_bucket_versioning.v"}) {
		t.Errorf("dependents %v", got)
	}
	if got := g.Dependencies("aws_iam_access_key.k"); !reflect.DeepEqual(got, []string{"aws_iam_user.u", "var.make_key"}) {
		t.Errorf("dependencies %v", got)
	}
}

func TestEdgeViaMatchesNestedPaths(t *testing.T) {
	g := graph.Build(&plan.Doc{})
	g.AddEdge("a", "b", "config", "rule.0.filter")
	if !g.EdgeVia("a", "b", "rule") || g.EdgeVia("a", "b", "rul") {
		t.Error("EdgeVia matches the attribute or a path under it, not a longer name that starts the same")
	}
}

func TestAddEdgeMergesReasons(t *testing.T) {
	g := graph.Build(&plan.Doc{})
	g.AddEdge("a", "b", "config", "bucket")
	g.AddEdge("a", "b", "config", "bucket")
	g.AddEdge("a", "b", "grant", "statement X")
	edges := g.Edges()
	if len(edges) != 1 {
		t.Fatalf("want one merged edge, got %v", edges)
	}
	if !reflect.DeepEqual(edges[0].Reasons, []string{"config bucket", "grant statement X"}) || !reflect.DeepEqual(edges[0].Kinds, []string{"config", "grant"}) {
		t.Errorf("merged edge %+v", edges[0])
	}
}

func TestRealPlanEdges(t *testing.T) {
	g := graph.Build(testutil.Load(t, "real/plan-create-offline.json"))
	for _, e := range []string{
		"aws_iam_user_policy_attachment.archive_writer>aws_iam_policy.archive_access>config",
		"aws_iam_user_policy_attachment.archive_writer>aws_iam_user.archive_writer>config+value",
		"aws_s3_bucket_public_access_block.archive>aws_s3_bucket.archive>config",
		"aws_s3_bucket_versioning.archive>aws_s3_bucket.archive>config",
		"aws_s3_bucket_lifecycle_configuration.archive>aws_s3_bucket_versioning.archive>depends_on",
	} {
		found := false
		for _, got := range edgeStrings(g) {
			found = found || got == e
		}
		if !found {
			t.Errorf("missing edge %s in %v", e, edgeStrings(g))
		}
	}
	if len(g.NodesOfType("aws_s3_bucket")) != 1 {
		t.Error("one bucket node expected")
	}
}

func TestStateEdgesComeFromRecordedDependencies(t *testing.T) {
	g := graph.Build(testutil.Load(t, "real/state-applied.json"))
	for _, e := range []string{
		"aws_s3_bucket_versioning.archive>aws_s3_bucket.archive>state+value",
		"aws_iam_user_policy_attachment.archive_writer>aws_iam_policy.archive_access>state+value",
	} {
		found := false
		for _, got := range edgeStrings(g) {
			found = found || got == e
		}
		if !found {
			t.Errorf("missing edge %s in %v", e, edgeStrings(g))
		}
	}
}

func TestValueEdgesOnAStateWithNoDependencies(t *testing.T) {
	g := buildFrom(t, `{"format_version":"1.0","values":{"root_module":{"resources":[
 {"address":"aws_s3_bucket.b","mode":"managed","type":"aws_s3_bucket","name":"b","values":{"bucket":"bk","id":"bk"}},
 {"address":"aws_s3_bucket_versioning.v","mode":"managed","type":"aws_s3_bucket_versioning","name":"v","values":{"bucket":"bk","id":"bk"}},
 {"address":"aws_s3_bucket_versioning.other","mode":"managed","type":"aws_s3_bucket_versioning","name":"other","values":{"bucket":"elsewhere"}}
]}}}`)
	want := []string{"aws_s3_bucket_versioning.v>aws_s3_bucket.b>value"}
	if got := edgeStrings(g); !reflect.DeepEqual(got, want) {
		t.Errorf("edges %v, want %v", got, want)
	}
}

func TestPseudoNodesInModules(t *testing.T) {
	g := buildFrom(t, `{"format_version":"1.2","planned_values":{},"resource_changes":[
 {"address":"module.net.aws_subnet.a","mode":"managed","type":"aws_subnet","name":"a","change":{"actions":["create"],"after":{},"after_unknown":{}}}],
 "configuration":{"root_module":{"resources":[],"module_calls":{"net":{"module":{"resources":[
 {"address":"aws_subnet.a","mode":"managed","type":"aws_subnet","name":"a","expressions":{"cidr":{"references":["var.cidr"]},"x":{"references":["local.y"]},"m":{"references":["module.inner.out"]}}}]}}}}}}`)
	want := []string{
		"module.net.aws_subnet.a>module.net.local.y>config",
		"module.net.aws_subnet.a>module.net.module.inner>config",
		"module.net.aws_subnet.a>module.net.var.cidr>config",
	}
	if got := edgeStrings(g); !reflect.DeepEqual(got, want) {
		t.Errorf("edges %v, want %v", got, want)
	}
	if k := g.Nodes["module.net.module.inner"].Kind; k != graph.KindModule {
		t.Errorf("module node kind %q", k)
	}
	if k := g.Nodes["module.net.local.y"].Kind; k != graph.KindLocal {
		t.Errorf("local node kind %q", k)
	}
}
