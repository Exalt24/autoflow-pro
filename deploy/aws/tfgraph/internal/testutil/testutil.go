// Package testutil holds helpers the tests share: reading the fixtures in testdata and editing a plan in memory.
package testutil

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/Exalt24/autoflow-pro/deploy/aws/tfgraph/internal/plan"
)

// Path is the absolute path of a file under testdata.
func Path(rel string) string {
	_, here, _, _ := runtime.Caller(0)
	return filepath.Join(filepath.Dir(here), "..", "..", "testdata", filepath.FromSlash(rel))
}

// Load parses a fixture.
func Load(t *testing.T, rel string) *plan.Doc {
	t.Helper()
	doc, err := plan.Load(Path(rel))
	if err != nil {
		t.Fatalf("load %s: %v", rel, err)
	}
	return doc
}

// ReadMap reads a fixture as a generic JSON object.
func ReadMap(t *testing.T, rel string) map[string]any {
	t.Helper()
	data, err := os.ReadFile(Path(rel))
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatal(err)
	}
	return m
}

// Parse turns an edited plan back into a document.
func Parse(t *testing.T, m map[string]any) *plan.Doc {
	t.Helper()
	data, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	doc, err := plan.Parse("edited.json", data)
	if err != nil {
		t.Fatalf("parse edited plan: %v", err)
	}
	return doc
}

// Change is the resource_changes entry of the first resource of one type.
func Change(t *testing.T, m map[string]any, typ string) map[string]any {
	t.Helper()
	for _, c := range m["resource_changes"].([]any) {
		cm := c.(map[string]any)
		if cm["type"] == typ {
			return cm
		}
	}
	t.Fatalf("no %s in the plan", typ)
	return nil
}

// After is the planned values of that entry.
func After(t *testing.T, m map[string]any, typ string) map[string]any {
	t.Helper()
	return Change(t, m, typ)["change"].(map[string]any)["after"].(map[string]any)
}

// Policy decodes the policy document of the aws_iam_policy in the plan.
func Policy(t *testing.T, m map[string]any) map[string]any {
	t.Helper()
	var doc map[string]any
	if err := json.Unmarshal([]byte(After(t, m, "aws_iam_policy")["policy"].(string)), &doc); err != nil {
		t.Fatal(err)
	}
	return doc
}

// SetPolicy writes a policy document back into the plan.
func SetPolicy(t *testing.T, m map[string]any, doc map[string]any) {
	t.Helper()
	data, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	After(t, m, "aws_iam_policy")["policy"] = string(data)
}

// Statement is the i-th statement of a decoded policy.
func Statement(doc map[string]any, i int) map[string]any {
	return doc["Statement"].([]any)[i].(map[string]any)
}

// Drop removes every resource of one type from the plan and its configuration.
func Drop(m map[string]any, typ string) {
	keep := func(list []any) []any {
		var out []any
		for _, e := range list {
			if e.(map[string]any)["type"] != typ {
				out = append(out, e)
			}
		}
		return out
	}
	m["resource_changes"] = keep(m["resource_changes"].([]any))
	cfg := m["configuration"].(map[string]any)["root_module"].(map[string]any)
	cfg["resources"] = keep(cfg["resources"].([]any))
}
