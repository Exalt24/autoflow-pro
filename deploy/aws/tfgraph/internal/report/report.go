// Package report prints a check result or a graph as text or JSON.
package report

import (
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"github.com/Exalt24/autoflow-pro/deploy/aws/tfgraph/internal/graph"
	"github.com/Exalt24/autoflow-pro/deploy/aws/tfgraph/internal/iam"
	"github.com/Exalt24/autoflow-pro/deploy/aws/tfgraph/internal/plan"
	"github.com/Exalt24/autoflow-pro/deploy/aws/tfgraph/internal/rules"
)

// Report is everything one `check` run found.
type Report struct {
	Source           string           `json:"source"`
	Kind             string           `json:"kind"`
	FormatVersion    string           `json:"format_version"`
	TerraformVersion string           `json:"terraform_version"`
	Resources        int              `json:"resources"`
	Edges            int              `json:"edges"`
	RulesRun         int              `json:"rules_run"`
	Access           []iam.UserAccess `json:"iam_access"`
	Results          []rules.Result   `json:"results"`
	Findings         int              `json:"findings"`
	Unknowns         int              `json:"unknowns"`
}

// New assembles the report.
func New(doc *plan.Doc, g *graph.Graph, access []iam.UserAccess, results []rules.Result) *Report {
	r := &Report{
		Source: doc.Source, Kind: string(doc.Kind), FormatVersion: doc.FormatVersion, TerraformVersion: doc.TerraformVersion,
		Resources: len(doc.Resources), Edges: len(g.Edges()), RulesRun: len(rules.Rules), Access: access, Results: results,
	}
	if r.Access == nil {
		r.Access = []iam.UserAccess{}
	}
	if r.Results == nil {
		r.Results = []rules.Result{}
	}
	for _, res := range results {
		if res.Status == rules.Finding {
			r.Findings++
		} else {
			r.Unknowns++
		}
	}
	return r
}

// ExitCode is 0 when there is no finding and 1 when there is one. An unknown never changes it.
func (r *Report) ExitCode() int {
	if r.Findings > 0 {
		return 1
	}
	return 0
}

// Text writes the report for a person.
func Text(w io.Writer, r *Report) {
	fmt.Fprintf(w, "read %s: %s (format %s, terraform %s), %d resources, %d edges\n", r.Source, r.Kind, r.FormatVersion, r.TerraformVersion, r.Resources, r.Edges)
	fmt.Fprintln(w, "\nIAM access")
	if len(r.Access) == 0 {
		fmt.Fprintln(w, "  no IAM user in this input")
	}
	for _, u := range r.Access {
		fmt.Fprintf(w, "  user %s (%s)\n", u.Address, u.Name)
		if len(u.Policies) == 0 {
			fmt.Fprintln(w, "    no policy reaches this user")
		}
		for _, p := range u.Policies {
			switch {
			case p.ManagedARN != "":
				fmt.Fprintf(w, "    managed policy %s via %s (not an aws_iam_policy in this input, so its statements are not read)\n", p.ManagedARN, p.Via)
			case p.Unresolved != "":
				fmt.Fprintf(w, "    %s via %s: UNRESOLVED, %s\n", orDash(p.Address), p.Via, p.Unresolved)
			default:
				fmt.Fprintf(w, "    policy %s (%s) via %s\n", p.Address, p.Name, p.Via)
				for i, st := range p.Policy.Statements {
					fmt.Fprintf(w, "      %s: %s\n", st.Label(i), st.Describe())
				}
			}
		}
	}
	fmt.Fprintln(w, "\nResults")
	if len(r.Results) == 0 {
		fmt.Fprintln(w, "  none")
	}
	for _, res := range r.Results {
		fmt.Fprintf(w, "  [%s] %s %s\n", res.Code, res.Status, res.Message)
	}
	fmt.Fprintln(w)
	switch {
	case r.Findings == 0 && r.Unknowns == 0:
		fmt.Fprintf(w, "Result: clean, %d rules run on %d resources\n", r.RulesRun, r.Resources)
	case r.Findings == 0:
		fmt.Fprintf(w, "Result: no findings, %d unknown (those checks could not run, so this is not clean), %d rules run on %d resources\n", r.Unknowns, r.RulesRun, r.Resources)
	default:
		fmt.Fprintf(w, "Result: %s, %d unknown, %d rules run on %d resources\n", plural(r.Findings, "finding"), r.Unknowns, r.RulesRun, r.Resources)
	}
}

func plural(n int, word string) string {
	if n == 1 {
		return "1 " + word
	}
	return fmt.Sprintf("%d %ss", n, word)
}

func orDash(s string) string {
	if s == "" {
		return "(no resource)"
	}
	return s
}

// JSON writes the report as indented JSON.
func JSON(w io.Writer, r *Report) error {
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	return enc.Encode(r)
}

// GraphText prints one line per edge, then the nodes that have no edge at all.
func GraphText(w io.Writer, g *graph.Graph, resourcesOnly bool) {
	shown := func(id string) bool {
		n := g.Nodes[id]
		return !resourcesOnly || (n != nil && (n.Kind == graph.KindResource || n.Kind == graph.KindData))
	}
	count := 0
	linked := map[string]bool{}
	for _, e := range g.Edges() {
		if !shown(e.From) || !shown(e.To) {
			continue
		}
		linked[e.From], linked[e.To] = true, true
		fmt.Fprintf(w, "%s -> %s  [%s]\n", e.From, e.To, strings.Join(e.Reasons, "; "))
		count++
	}
	var alone []string
	for _, id := range g.NodeIDs() {
		if shown(id) && !linked[id] {
			alone = append(alone, id)
		}
	}
	nodes := 0
	for _, id := range g.NodeIDs() {
		if shown(id) {
			nodes++
		}
	}
	fmt.Fprintf(w, "%d nodes, %d edges\n", nodes, count)
	for _, id := range alone {
		fmt.Fprintf(w, "no edges: %s\n", id)
	}
}

// GraphJSON prints nodes and edges as JSON.
func GraphJSON(w io.Writer, g *graph.Graph, resourcesOnly bool) error {
	type node struct {
		ID        string `json:"id"`
		Kind      string `json:"kind"`
		Type      string `json:"type,omitempty"`
		Instances int    `json:"instances"`
	}
	type edge struct {
		From    string   `json:"from"`
		To      string   `json:"to"`
		Reasons []string `json:"reasons"`
	}
	out := struct {
		Nodes []node `json:"nodes"`
		Edges []edge `json:"edges"`
	}{Nodes: []node{}, Edges: []edge{}}
	keep := func(id string) bool {
		n := g.Nodes[id]
		return !resourcesOnly || (n != nil && (n.Kind == graph.KindResource || n.Kind == graph.KindData))
	}
	for _, id := range g.NodeIDs() {
		if keep(id) {
			n := g.Nodes[id]
			out.Nodes = append(out.Nodes, node{ID: id, Kind: n.Kind, Type: n.Type, Instances: len(n.Instances)})
		}
	}
	for _, e := range g.Edges() {
		if keep(e.From) && keep(e.To) {
			out.Edges = append(out.Edges, edge{From: e.From, To: e.To, Reasons: e.Reasons})
		}
	}
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	return enc.Encode(out)
}
