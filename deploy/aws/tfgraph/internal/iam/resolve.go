package iam

import (
	"fmt"
	"regexp"
	"sort"
	"strings"

	"github.com/Exalt24/autoflow-pro/deploy/aws/tfgraph/internal/graph"
	"github.com/Exalt24/autoflow-pro/deploy/aws/tfgraph/internal/plan"
)

// DocumentTypes are the resource types whose `policy` attribute is a policy document.
var DocumentTypes = map[string]bool{
	"aws_iam_policy":       true,
	"aws_iam_user_policy":  true,
	"aws_iam_role_policy":  true,
	"aws_iam_group_policy": true,
	"aws_s3_bucket_policy": true,
}

// Document is one policy document found in the input.
type Document struct {
	Resource *plan.Resource
	Policy   *Policy
	Unknown  bool   // the document is known only after apply
	Err      string // why it could not be parsed, when it could not
}

// Documents lists every policy document of every live resource, in address order.
func Documents(doc *plan.Doc) []Document {
	var out []Document
	for _, r := range doc.Resources {
		if r.Mode != "managed" || !DocumentTypes[r.Type] || !r.Live() {
			continue
		}
		a := r.Attr("policy")
		d := Document{Resource: r}
		switch s, ok := a.String(); {
		case a.Unknown:
			d.Unknown = true
		case !ok:
			d.Err = "the policy attribute is missing or is not a string"
		default:
			p, err := Parse(s)
			if err != nil {
				d.Err = err.Error()
			} else {
				d.Policy = p
			}
		}
		out = append(out, d)
	}
	return out
}

var s3Arn = regexp.MustCompile(`^arn:[^:]*:s3:::([^/]*)(?:/(.*))?$`)

// S3Resource splits an S3 ARN into bucket name and object key. isObject is false for a bucket ARN.
func S3Resource(arn string) (bucket, key string, isObject, ok bool) {
	m := s3Arn.FindStringSubmatch(arn)
	if m == nil {
		return "", "", false, false
	}
	return m[1], m[2], strings.Contains(arn[strings.Index(arn, ":::")+3:], "/"), true
}

// PolicyRef is a policy as it reaches a user.
type PolicyRef struct {
	Address    string  `json:"address,omitempty"`
	Name       string  `json:"name,omitempty"`
	Via        string  `json:"via"`
	ManagedARN string  `json:"managed_arn,omitempty"`
	Policy     *Policy `json:"policy,omitempty"`
	Unresolved string  `json:"unresolved,omitempty"`
}

// UserAccess is one IAM user and every policy that reaches it.
type UserAccess struct {
	Address  string      `json:"address"`
	Name     string      `json:"name"`
	Policies []PolicyRef `json:"policies"`
}

// Resolve finds, for every IAM user, the policies attached through aws_iam_user_policy_attachment and the inline
// aws_iam_user_policy resources. It also adds a "grant" edge to the graph from every policy resource to each S3
// bucket its Allow statements name, so the graph shows who can reach the bucket even where the policy gets the
// bucket name from a local value and not from a reference.
func Resolve(doc *plan.Doc, g *graph.Graph) []UserAccess {
	addGrantEdges(doc, g)
	var out []UserAccess
	for _, un := range g.NodesOfType("aws_iam_user") {
		for _, u := range un.Instances {
			if !u.Live() {
				continue
			}
			name, _ := u.Attr("name").String()
			ua := UserAccess{Address: u.Address, Name: name}
			for _, an := range g.NodesOfType("aws_iam_user_policy_attachment") {
				for _, att := range an.Instances {
					if !att.Live() || !belongsTo(g, att, un.ID, name) {
						continue
					}
					ua.Policies = append(ua.Policies, resolveAttachment(g, an, att))
				}
			}
			for _, pn := range g.NodesOfType("aws_iam_user_policy") {
				for _, p := range pn.Instances {
					if !p.Live() || !belongsTo(g, p, un.ID, name) {
						continue
					}
					ua.Policies = append(ua.Policies, refFromResource(p, "inline policy"))
				}
			}
			sort.SliceStable(ua.Policies, func(i, j int) bool { return ua.Policies[i].Address < ua.Policies[j].Address })
			out = append(out, ua)
		}
	}
	return out
}

func belongsTo(g *graph.Graph, r *plan.Resource, userID, userName string) bool {
	if g.HasEdge(r.ConfigAddress, userID) {
		return true
	}
	v, ok := r.Attr("user").String()
	return ok && userName != "" && v == userName
}

func resolveAttachment(g *graph.Graph, an *graph.Node, att *plan.Resource) PolicyRef {
	via := "attachment " + att.Address
	for _, dep := range g.Dependencies(an.ID) {
		if pn := g.Nodes[dep]; pn != nil && pn.Type == "aws_iam_policy" && g.EdgeVia(an.ID, dep, "policy_arn") {
			for _, p := range pn.Instances {
				if p.Live() {
					ref := refFromResource(p, via)
					return ref
				}
			}
		}
	}
	arn := att.Attr("policy_arn")
	if s, ok := arn.String(); ok {
		for _, pn := range g.NodesOfType("aws_iam_policy") {
			for _, p := range pn.Instances {
				if v, ok := p.Attr("arn").String(); ok && v == s && p.Live() {
					return refFromResource(p, via)
				}
			}
		}
		return PolicyRef{Via: via, ManagedARN: s}
	}
	reason := "the attachment has no policy_arn value"
	if arn.Unknown {
		reason = "policy_arn is known only after apply and no reference to an aws_iam_policy in this input says which policy it is"
	}
	return PolicyRef{Via: via, Unresolved: reason}
}

func refFromResource(p *plan.Resource, via string) PolicyRef {
	ref := PolicyRef{Address: p.Address, Via: via}
	ref.Name, _ = p.Attr("name").String()
	a := p.Attr("policy")
	switch s, ok := a.String(); {
	case a.Unknown:
		ref.Unresolved = "the policy document is known only after apply"
	case !ok:
		ref.Unresolved = "the policy attribute is missing"
	default:
		if pol, err := Parse(s); err != nil {
			ref.Unresolved = "the policy document could not be parsed: " + err.Error()
		} else {
			ref.Policy = pol
		}
	}
	return ref
}

func addGrantEdges(doc *plan.Doc, g *graph.Graph) {
	buckets := map[string]string{} // bucket name -> node id
	for _, n := range g.NodesOfType("aws_s3_bucket") {
		for _, b := range n.Instances {
			if name, ok := b.Attr("bucket").String(); ok && b.Live() {
				buckets[name] = n.ID
			}
		}
	}
	for _, d := range Documents(doc) {
		if d.Policy == nil {
			continue
		}
		for i, st := range d.Policy.Statements {
			if st.Effect != "Allow" {
				continue
			}
			for _, res := range st.Resources {
				if bucket, _, _, ok := S3Resource(res); ok {
					if id, found := buckets[bucket]; found {
						g.AddEdge(d.Resource.ConfigAddress, id, "grant", fmt.Sprintf("statement %s", st.Label(i)))
					}
				}
			}
		}
	}
}
