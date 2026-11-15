// Package graph builds a directed graph of the resources in a plan or a state. A node is a config address (so
// aws_iam_access_key.archive_writer is one node even when count makes it several instances) and an edge A -> B
// means A reads something from B.
package graph

import (
	"sort"
	"strings"

	"github.com/Exalt24/autoflow-pro/deploy/aws/tfgraph/internal/plan"
)

// Node kinds.
const (
	KindResource = "resource"
	KindData     = "data"
	KindVariable = "variable"
	KindLocal    = "local"
	KindModule   = "module"
)

// Node is one config address.
type Node struct {
	ID        string
	Kind      string
	Type      string
	Instances []*plan.Resource
}

// Edge is a dependency of From on To. Kinds and Via collect every reason the two are linked.
type Edge struct {
	From    string
	To      string
	Kinds   []string // config, depends_on, state, grant
	Via     []string // config edges only: the attribute of From that holds the reference
	Reasons []string // one entry per reason, for printing: "config policy_arn", "grant statement ArchiveObjects", "state"
}

// Graph is the whole model.
type Graph struct {
	Nodes map[string]*Node
	edges map[[2]string]*Edge
}

// Build makes the graph from a normalised document: nodes from the resources (a plan's resource_changes plus the
// prior state, or a state's values) and edges from the configuration expressions, explicit depends_on and the
// dependencies a state records.
func Build(doc *plan.Doc) *Graph {
	g := &Graph{Nodes: map[string]*Node{}, edges: map[[2]string]*Edge{}}
	for _, r := range doc.Resources {
		n := g.Nodes[r.ConfigAddress]
		if n == nil {
			kind := KindResource
			if r.Mode == "data" {
				kind = KindData
			}
			n = &Node{ID: r.ConfigAddress, Kind: kind, Type: r.Type}
			g.Nodes[r.ConfigAddress] = n
		}
		n.Instances = append(n.Instances, r)
	}
	addValueEdges(g)
	for _, ref := range doc.Refs {
		if _, ok := g.Nodes[ref.From]; !ok {
			continue
		}
		if _, ok := g.Nodes[ref.To]; !ok {
			kind, ok := pseudoKind(ref.To)
			if !ok {
				continue // an iterator such as endpoints.value, or an address this input does not hold
			}
			g.Nodes[ref.To] = &Node{ID: ref.To, Kind: kind}
		}
		if ref.From == ref.To {
			continue
		}
		g.AddEdge(ref.From, ref.To, ref.Kind, ref.Via)
	}
	return g
}

func pseudoKind(id string) (string, bool) {
	parts := strings.Split(id, ".")
	for len(parts) >= 2 && parts[0] == "module" {
		parts = parts[2:]
	}
	switch {
	case len(parts) == 0:
		return KindModule, true
	case parts[0] == "var":
		return KindVariable, true
	case parts[0] == "local":
		return KindLocal, true
	}
	return "", false
}

// AddEdge records one reason From depends on To.
func (g *Graph) AddEdge(from, to, kind, via string) {
	key := [2]string{from, to}
	e := g.edges[key]
	if e == nil {
		e = &Edge{From: from, To: to}
		g.edges[key] = e
	}
	e.Kinds = addUnique(e.Kinds, kind)
	if via != "" && kind == "config" {
		e.Via = addUnique(e.Via, via)
	}
	reason := kind
	if via != "" {
		reason += " " + via
	}
	e.Reasons = addUnique(e.Reasons, reason)
}

func addUnique(list []string, s string) []string {
	for _, x := range list {
		if x == s {
			return list
		}
	}
	list = append(list, s)
	sort.Strings(list)
	return list
}

// Edges are the edges sorted by From, then To.
func (g *Graph) Edges() []Edge {
	out := make([]Edge, 0, len(g.edges))
	for _, e := range g.edges {
		out = append(out, *e)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].From != out[j].From {
			return out[i].From < out[j].From
		}
		return out[i].To < out[j].To
	})
	return out
}

// HasEdge reports whether from depends on to, whatever the reason.
func (g *Graph) HasEdge(from, to string) bool { return g.edges[[2]string{from, to}] != nil }

// EdgeVia reports whether from references to through the attribute attr (or an attribute under it).
func (g *Graph) EdgeVia(from, to, attr string) bool {
	e := g.edges[[2]string{from, to}]
	if e == nil {
		return false
	}
	for _, v := range e.Via {
		if v == attr || strings.HasPrefix(v, attr+".") {
			return true
		}
	}
	return false
}

// NodesOfType are the resource nodes of one type, sorted by id.
func (g *Graph) NodesOfType(typ string) []*Node {
	var out []*Node
	for _, n := range g.Nodes {
		if n.Type == typ && n.Kind == KindResource {
			out = append(out, n)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// NodeIDs are all node ids, sorted.
func (g *Graph) NodeIDs() []string {
	out := make([]string, 0, len(g.Nodes))
	for id := range g.Nodes {
		out = append(out, id)
	}
	sort.Strings(out)
	return out
}

// Dependents are the nodes that read from id (edges pointing at it), sorted.
func (g *Graph) Dependents(id string) []string {
	var out []string
	for k := range g.edges {
		if k[1] == id {
			out = append(out, k[0])
		}
	}
	sort.Strings(out)
	return out
}

// Dependencies are the nodes id reads from, sorted.
func (g *Graph) Dependencies(id string) []string {
	var out []string
	for k := range g.edges {
		if k[0] == id {
			out = append(out, k[1])
		}
	}
	sort.Strings(out)
	return out
}

// valueRefs say which planned value names another resource: a `bucket` attribute names an aws_s3_bucket by its
// bucket name or id, a `user` attribute an aws_iam_user by its name, a `policy_arn` attribute an aws_iam_policy by
// its arn, and so on. A known value that matches is an edge even where the input carries no configuration (a
// state, or a plan printed without it).
var valueRefs = []struct {
	attr       string
	targetType string
	identity   []string
}{
	{"bucket", "aws_s3_bucket", []string{"bucket", "id"}},
	{"user", "aws_iam_user", []string{"name"}},
	{"role", "aws_iam_role", []string{"name"}},
	{"group", "aws_iam_group", []string{"name"}},
	{"policy_arn", "aws_iam_policy", []string{"arn"}},
}

func addValueEdges(g *Graph) {
	for _, ref := range valueRefs {
		byValue := map[string][]string{} // identity value -> target node ids
		for _, n := range g.NodesOfType(ref.targetType) {
			for _, inst := range n.Instances {
				if !inst.Live() {
					continue
				}
				for _, attr := range ref.identity {
					if v, ok := inst.Attr(attr).String(); ok && v != "" {
						byValue[v] = append(byValue[v], n.ID)
					}
				}
			}
		}
		for _, id := range g.NodeIDs() {
			n := g.Nodes[id]
			if n.Kind != KindResource || n.Type == ref.targetType {
				continue
			}
			for _, inst := range n.Instances {
				if !inst.Live() {
					continue
				}
				if v, ok := inst.Attr(ref.attr).String(); ok && v != "" {
					for _, target := range byValue[v] {
						g.AddEdge(id, target, "value", ref.attr)
					}
				}
			}
		}
	}
}
