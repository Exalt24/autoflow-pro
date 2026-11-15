package cli_test

import (
	"bytes"
	"encoding/json"
	"flag"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Exalt24/autoflow-pro/deploy/aws/tfgraph/internal/cli"
	"github.com/Exalt24/autoflow-pro/deploy/aws/tfgraph/internal/testutil"
)

var update = flag.Bool("update", false, "rewrite the golden files in testdata/golden")

func run(args ...string) (code int, stdout, stderr string) {
	var out, errb bytes.Buffer
	code = cli.Run(args, &out, &errb)
	return code, out.String(), errb.String()
}

func TestExitCodes(t *testing.T) {
	t.Chdir(testutil.Path(""))
	empty := filepath.Join(t.TempDir(), "empty.json")
	if err := os.WriteFile(empty, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	notJSON := filepath.Join(t.TempDir(), "bad.json")
	if err := os.WriteFile(notJSON, []byte("{oops"), 0o600); err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name string
		args []string
		code int
	}{
		{"clean plan", []string{"check", "real/plan-create-offline.json"}, 0},
		{"clean state", []string{"check", "real/state-applied.json"}, 0},
		{"findings", []string{"check", "variants/widened-policy.json"}, 1},
		{"delete planned", []string{"check", "variants/delete-and-replace-planned.json"}, 1},
		{"only unknowns exits 0", []string{"check", "variants/unknown-values.json"}, 0},
		{"graph exits 0", []string{"graph", "real/plan-create-offline.json"}, 0},
		{"missing file", []string{"check", "no-such-file.json"}, 2},
		{"empty file", []string{"check", empty}, 2},
		{"not json", []string{"check", notJSON}, 2},
		{"no arguments", nil, 2},
		{"unknown command", []string{"apply", "x.json"}, 2},
		{"no file", []string{"check"}, 2},
		{"two files", []string{"check", "a.json", "b.json"}, 2},
		{"bad format", []string{"check", "real/plan-noop.json", "--format", "yaml"}, 2},
		{"format with no value", []string{"check", "real/plan-noop.json", "--format"}, 2},
		{"unknown option", []string{"check", "real/plan-noop.json", "--fast"}, 2},
		{"help", []string{"--help"}, 0},
		{"prefix that the policy breaks", []string{"check", "real/plan-noop.json", "--prefix", "reports/"}, 1},
	}
	for _, c := range cases {
		if code, _, _ := run(c.args...); code != c.code {
			t.Errorf("%s: exit %d, want %d", c.name, code, c.code)
		}
	}
}

// A failure to read the input says what was read, what was expected and which file, in one line on stderr.
func TestInputFailureMessages(t *testing.T) {
	dir := t.TempDir()
	notPlan := filepath.Join(dir, "other.json")
	if err := os.WriteFile(notPlan, []byte(`{"hello":"world"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{filepath.Join(dir, "absent.json"), notPlan} {
		code, stdout, stderr := run("check", path)
		if code != 2 || stdout != "" {
			t.Errorf("%s: exit %d, stdout %q", path, code, stdout)
		}
		msg := strings.TrimSpace(stderr)
		if strings.Count(msg, "\n") != 0 || !strings.HasPrefix(msg, "tfgraph: could not use "+path+": read ") || !strings.Contains(msg, " but expected ") {
			t.Errorf("message is not one plain sentence naming the file, what was read and what was expected: %q", msg)
		}
	}
}

func TestFlagsMayFollowOrPrecedeTheFile(t *testing.T) {
	t.Chdir(testutil.Path(""))
	_, a, _ := run("check", "variants/widened-policy.json", "--format", "json")
	_, b, _ := run("check", "--format=json", "variants/widened-policy.json")
	if a != b || !strings.HasPrefix(a, "{") {
		t.Errorf("flag position changed the output:\n%s\n%s", a, b)
	}
}

func TestJSONReport(t *testing.T) {
	t.Chdir(testutil.Path(""))
	code, out, _ := run("check", "variants/unknown-values.json", "--format", "json")
	if code != 0 {
		t.Errorf("exit %d", code)
	}
	var rep struct {
		Source    string `json:"source"`
		Kind      string `json:"kind"`
		Resources int    `json:"resources"`
		RulesRun  int    `json:"rules_run"`
		Findings  int    `json:"findings"`
		Unknowns  int    `json:"unknowns"`
		Access    []struct {
			Address  string `json:"address"`
			Policies []any  `json:"policies"`
		} `json:"iam_access"`
		Results []struct {
			Code, Status, Address, Message string
		} `json:"results"`
	}
	if err := json.Unmarshal([]byte(out), &rep); err != nil {
		t.Fatalf("not JSON: %v\n%s", err, out)
	}
	if rep.Kind != "plan" || rep.Findings != 0 || rep.Unknowns != 5 || rep.RulesRun != 9 || len(rep.Results) != 5 || len(rep.Access) != 1 {
		t.Errorf("report %+v", rep)
	}
	for _, r := range rep.Results {
		if r.Status != "UNKNOWN" || r.Code == "" || r.Address == "" || r.Message == "" {
			t.Errorf("result %+v", r)
		}
	}
	_, clean, _ := run("check", "real/plan-noop.json", "--format", "json")
	if !strings.Contains(clean, `"results": []`) {
		t.Errorf("a clean report must carry an empty results list, not null:\n%s", clean)
	}
}

func TestGraphJSON(t *testing.T) {
	t.Chdir(testutil.Path(""))
	_, out, _ := run("graph", "real/plan-create-offline.json", "--format", "json", "--resources-only")
	var g struct {
		Nodes []struct{ ID, Kind string }
		Edges []struct {
			From, To string
			Reasons  []string
		}
	}
	if err := json.Unmarshal([]byte(out), &g); err != nil {
		t.Fatal(err)
	}
	if len(g.Nodes) != 10 || len(g.Edges) != 9 {
		t.Errorf("%d nodes %d edges", len(g.Nodes), len(g.Edges))
	}
	for _, n := range g.Nodes {
		if n.Kind != "resource" && n.Kind != "data" {
			t.Errorf("--resources-only left a %s node: %s", n.Kind, n.ID)
		}
	}
}

func TestGolden(t *testing.T) {
	t.Chdir(testutil.Path(""))
	cases := []struct {
		name string
		args []string
		code int
	}{
		{"check-clean-plan", []string{"check", "real/plan-create-offline.json"}, 0},
		{"check-clean-emulator-plan", []string{"check", "real/plan-create-emulator.json"}, 0},
		{"check-clean-state", []string{"check", "real/state-applied.json"}, 0},
		{"check-replace-bucket", []string{"check", "real/plan-replace-bucket.json"}, 1},
		{"check-widened-policy", []string{"check", "variants/widened-policy.json"}, 1},
		{"check-unknown-values", []string{"check", "variants/unknown-values.json"}, 0},
		{"check-delete-and-replace", []string{"check", "variants/delete-and-replace-planned.json"}, 1},
		{"check-widened-policy-json", []string{"check", "variants/widened-policy.json", "--format", "json"}, 1},
		{"graph-plan", []string{"graph", "real/plan-create-offline.json"}, 0},
		{"graph-plan-resources-only", []string{"graph", "real/plan-create-offline.json", "--resources-only"}, 0},
		{"graph-state", []string{"graph", "real/state-applied.json", "--resources-only"}, 0},
	}
	for _, c := range cases {
		code, out, stderr := run(c.args...)
		if code != c.code || stderr != "" {
			t.Errorf("%s: exit %d (want %d), stderr %q", c.name, code, c.code, stderr)
		}
		path := filepath.Join("golden", c.name+".txt")
		if *update {
			if err := os.MkdirAll("golden", 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, []byte(out), 0o644); err != nil {
				t.Fatal(err)
			}
			continue
		}
		want, err := os.ReadFile(path)
		if err != nil {
			t.Errorf("%s: %v (run go test ./internal/cli -update to write it)", c.name, err)
			continue
		}
		if got, exp := out, strings.ReplaceAll(string(want), "\r\n", "\n"); got != exp {
			t.Errorf("%s differs from %s:\n--- got\n%s\n--- want\n%s", c.name, path, got, exp)
		}
	}
}
