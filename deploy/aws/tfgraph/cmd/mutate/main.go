// Command mutate breaks one rule at a time in a scratch copy of the module and checks that `go test ./...` goes
// red for each. The real files are never touched. Run it from deploy/aws/tfgraph:
//
//	go run ./cmd/mutate
//
// It prints one CAUGHT or MISSED line per mutant and ends with `mutants caught: N of N`. It exits 1 when the
// unmutated copy does not pass, when a mutant does not compile (that is a bad mutant, not a caught one), when a
// mutation target is not found exactly once, or when any mutant survives.
package main

import (
	"bytes"
	"context"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type mutant struct {
	name string
	file string
	from string
	to   string
}

var mutants = []mutant{
	{"wildcard action only recognises a bare *", "internal/rules/rules.go", `if strings.Contains(a, "*") {`, `if a == "*" {`},
	{"Allow with NotAction is ignored", "internal/rules/rules.go", `if len(st.NotActions) > 0 {`, `if false {`},
	{"a Deny statement is treated like an Allow", "internal/rules/rules.go", "\t\t\tif st.Effect != \"Allow\" {\n\t\t\t\tcontinue\n\t\t\t}\n\t\t\tvar wild []string", "\t\t\tvar wild []string"},
	{"wildcard resource * is no longer flagged", "internal/rules/rules.go", `if res == "*" {`, `if res == "" {`},
	{"an all-bucket ARN is no longer flagged", "internal/rules/rules.go", `ok && strings.Contains(bucket, "*") {`, `ok && strings.Contains(bucket, "*") && false {`},
	{"object keys outside the prefix are accepted", "internal/rules/rules.go", `if !strings.HasPrefix(key, prefix) {`, `if false && !strings.HasPrefix(key, prefix) {`},
	{"a list without an s3:prefix condition is accepted", "internal/rules/rules.go", `if len(values) == 0 {`, `if false {`},
	{"the lifecycle prefix is not used as a claim", "internal/rules/rules.go", `for _, lc := range assocLive(in, b, "aws_s3_bucket_lifecycle_configuration") {`, `for _, lc := range []*plan.Resource{} {`},
	{"the --prefix option is ignored", "internal/rules/rules.go", `if in.Opts.Prefix != "" {`, `if false {`},
	{"no prefix claim is reported clean, not UNKNOWN", "internal/rules/rules.go", `if prefix == "" {`, "if prefix == \"\" {\n\t\t\t\t\tcontinue\n\t\t\t\t}\n\t\t\t\tif prefix == \"\" {"},
	{"the public access block flag list loses restrict_public_buckets", "internal/rules/rules.go", `"ignore_public_acls", "restrict_public_buckets"}`, `"ignore_public_acls"}`},
	{"a public access block flag set to false is accepted", "internal/rules/rules.go", `case !a.Found || a.Value != true:`, `case !a.Found:`},
	{"an unknown public access block flag is reported as a finding", "internal/rules/rules.go", "case a.Unknown:\n\t\t\t\t\tout = append(out, r.unknown(blk.Address, flag))", "case false:\n\t\t\t\t\tout = append(out, r.unknown(blk.Address, flag))"},
	{"a bucket with no public access block is reported clean", "internal/rules/rules.go", `if len(blocks) == 0 {`, `if len(blocks) < 0 {`},
	{"a bucket with no encryption configuration is reported clean", "internal/rules/rules.go", "if len(cfgs) == 0 {\n\t\t\tout = append(out, r.finding(addr, \"%s: read %s for the bucket (%s), expected one with an SSE algorithm", "if len(cfgs) < 0 {\n\t\t\tout = append(out, r.finding(addr, \"%s: read %s for the bucket (%s), expected one with an SSE algorithm"},
	{"an empty SSE algorithm counts as encryption", "internal/rules/rules.go", `} else if s, ok := a.String(); ok && s != "" {`, `} else if _, ok := a.String(); ok {`},
	{"versioning Suspended is accepted", "internal/rules/rules.go", `case s != "Enabled":`, `case s == "":`},
	{"a planned delete is not reported", "internal/rules/rules.go", `res.Mode == "managed" && len(res.Actions) == 1 && res.Actions[0] == "delete"`, `res.Mode == "managed" && len(res.Actions) == 1 && res.Actions[0] == "never"`},
	{"a create then delete replacement is missed", "internal/rules/rules.go", `hasAction(res, "delete") && hasAction(res, "create")`, `res.Actions[0] == "delete" && hasAction(res, "create")`},
	{"an UNKNOWN is reported as a FINDING", "internal/rules/rules.go", "Status: Unknown, Address: addr,\n", "Status: Finding, Address: addr,\n"},
	{"the wildcard resource rule is dropped from the rule table", "internal/rules/rules.go", "\t{Code: \"TFG002\", Name: \"wildcard resource\", Run: wildcardResource},\n", ""},
	{"an unparseable policy document is silent", "internal/rules/rules.go", `if d.Err != "" {`, `if false {`},
	{"an unknown bucket name skips the prefix rule silently", "internal/rules/rules.go", `if len(unknownNames) > 0 && len(buckets) == 0 {`, `if false {`},
	{"an UNKNOWN changes the exit code", "internal/report/report.go", `if r.Findings > 0 {`, `if r.Findings+r.Unknowns > 0 {`},
	{"a resource planned for delete still counts as live", "internal/plan/plan.go", `return !(len(r.Actions) == 1 && r.Actions[0] == "delete")`, `return true`},
	{"a data source reference is cut to two tokens", "internal/plan/plan.go", `return prefix + strings.Join(parts[:3], ".")`, `return prefix + strings.Join(parts[:2], ".")`},
	{"an unknown parent block is not honoured for a nested path", "internal/plan/plan.go", "case bool:\n\t\t\treturn t", "case bool:\n\t\t\treturn false"},
	{"a future format_version is accepted", "internal/plan/plan.go", `raw.FormatVersion != "" && major != "1"`, `raw.FormatVersion != "" && major != "1" && false`},
	{"an errored plan is accepted", "internal/plan/plan.go", `if raw.Errored != nil && *raw.Errored {`, `if false {`},
	{"depends_on edges are not recorded", "internal/plan/plan.go", `doc.Refs = append(doc.Refs, Reference{From: from, To: to, Kind: "depends_on"})`, `_ = to`},
	{"value edges are not built", "internal/graph/graph.go", "addValueEdges(g)\n\tfor _, ref := range doc.Refs {", "for _, ref := range doc.Refs {"},
	{"grant edges are not added", "internal/iam/resolve.go", "addGrantEdges(doc, g)\n\tvar out []UserAccess", "var out []UserAccess"},
	{"a single statement object is not accepted", "internal/iam/policy.go", `list = []json.RawMessage{one}`, `list = nil`},
}

func main() {
	root, err := os.Getwd()
	if err != nil {
		fmt.Fprintln(os.Stderr, "mutate:", err)
		os.Exit(1)
	}
	if _, err := os.Stat(filepath.Join(root, "go.mod")); err != nil {
		fmt.Fprintln(os.Stderr, "mutate: read no go.mod in", root, "but expected to run from deploy/aws/tfgraph")
		os.Exit(1)
	}
	fmt.Printf("# %s  %d mutants, one broken rule each in a scratch copy of the module, go test ./... must go red\n", time.Now().UTC().Format("2006-01-02T15:04:05Z"), len(mutants))
	fmt.Println("# " + goVersion())

	baseline, out := runCopy(root, nil)
	if baseline != "pass" {
		fmt.Println("BASELINE FAIL  go test ./... on the unmutated copy")
		fmt.Println(out)
		os.Exit(1)
	}
	fmt.Println("BASELINE PASS  go test ./... on the unmutated copy")

	type result struct {
		status, first string
	}
	results := make([]result, len(mutants))
	var wg sync.WaitGroup
	sem := make(chan struct{}, 4)
	for i := range mutants {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			status, out := runCopy(root, &mutants[i])
			results[i] = result{status, firstRed(out)}
		}(i)
	}
	wg.Wait()

	caught, bad := 0, 0
	for i, m := range mutants {
		r := results[i]
		switch r.status {
		case "fail":
			caught++
			fmt.Printf("CAUGHT  %s\n          first red: %s\n", m.name, r.first)
		case "pass":
			fmt.Printf("MISSED  %s\n          every test still passed\n", m.name)
		default:
			bad++
			fmt.Printf("INVALID %s\n          %s\n", m.name, r.first)
		}
	}
	fmt.Printf("\nmutants caught: %d of %d\n", caught, len(mutants))
	if caught != len(mutants) || bad > 0 {
		os.Exit(1)
	}
}

func goVersion() string {
	out, err := exec.Command("go", "version").Output()
	if err != nil {
		return "go version unknown"
	}
	return strings.TrimSpace(string(out))
}

// runCopy copies the module to a scratch directory, applies the mutant if there is one, runs the tests and
// returns "pass", "fail" (a test went red), or "invalid" (the copy did not build, or the target was not found once).
func runCopy(root string, m *mutant) (string, string) {
	dir, err := os.MkdirTemp("", "tfgraph-mutant-")
	if err != nil {
		return "invalid", err.Error()
	}
	defer os.RemoveAll(dir)
	err = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(root, path)
		dst := filepath.Join(dir, rel)
		if d.IsDir() {
			return os.MkdirAll(dst, 0o755)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(dst, data, 0o644)
	})
	if err != nil {
		return "invalid", err.Error()
	}
	if m != nil {
		path := filepath.Join(dir, filepath.FromSlash(m.file))
		data, err := os.ReadFile(path)
		if err != nil {
			return "invalid", err.Error()
		}
		text := strings.ReplaceAll(string(data), "\r\n", "\n")
		if n := strings.Count(text, m.from); n != 1 {
			return "invalid", fmt.Sprintf("the mutation target was found %d times in %s, expected exactly once: %q", n, m.file, m.from)
		}
		if err := os.WriteFile(path, []byte(strings.Replace(text, m.from, m.to, 1)), 0o644); err != nil {
			return "invalid", err.Error()
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, "go", "test", "-count=1", "./...")
	cmd.Dir = dir
	var buf bytes.Buffer
	cmd.Stdout, cmd.Stderr = &buf, &buf
	err = cmd.Run()
	out := buf.String()
	switch {
	case err == nil:
		return "pass", out
	case strings.Contains(out, "[build failed]") || strings.Contains(out, "[setup failed]"):
		return "invalid", "the mutant did not compile: " + firstLine(out)
	case strings.Contains(out, "--- FAIL"):
		return "fail", out
	default:
		return "invalid", "go test failed without a red test: " + firstLine(out)
	}
}

func firstLine(s string) string {
	for _, l := range strings.Split(s, "\n") {
		if l = strings.TrimSpace(l); l != "" {
			return l
		}
	}
	return ""
}

// firstRed is the first failing test and the first line of what it said.
func firstRed(out string) string {
	lines := strings.Split(out, "\n")
	for i, l := range lines {
		if strings.HasPrefix(l, "--- FAIL") || strings.HasPrefix(strings.TrimSpace(l), "--- FAIL") {
			name := strings.TrimSpace(l)
			if i+1 < len(lines) {
				if msg := strings.TrimSpace(lines[i+1]); msg != "" {
					name += " | " + msg
				}
			}
			if len(name) > 220 {
				name = name[:220] + "..."
			}
			return name
		}
	}
	return firstLine(out)
}
