// Package rules holds the checks tfgraph runs over a plan or state. Every rule has a stable code, and every
// result says what was read, what was expected and the resource address, in one sentence.
package rules

import (
	"fmt"
	"sort"
	"strings"

	"github.com/Exalt24/autoflow-pro/deploy/aws/tfgraph/internal/graph"
	"github.com/Exalt24/autoflow-pro/deploy/aws/tfgraph/internal/iam"
	"github.com/Exalt24/autoflow-pro/deploy/aws/tfgraph/internal/plan"
)

// Status of one result. UNKNOWN means a value the rule needs is known only after apply: it is neither clean nor a
// failure, and it does not change the exit code.
type Status string

const (
	Finding Status = "FINDING"
	Unknown Status = "UNKNOWN"
)

// Result is one finding or one unknown.
type Result struct {
	Code    string `json:"code"`
	Name    string `json:"name"`
	Status  Status `json:"status"`
	Address string `json:"address"`
	Message string `json:"message"`
}

// Options are the settings of one run.
type Options struct {
	// Prefix is the object prefix the policy is meant to be limited to. Empty means read it from the policy's own
	// s3:prefix condition, then from the bucket's lifecycle rule.
	Prefix string
}

// Input is everything a rule can look at.
type Input struct {
	Doc       *plan.Doc
	Graph     *graph.Graph
	Documents []iam.Document
	Opts      Options
}

// Rule is one check.
type Rule struct {
	Code string
	Name string
	Run  func(in *Input, r Rule) []Result
}

// Rules are every rule, in code order.
var Rules = []Rule{
	{Code: "TFG001", Name: "wildcard action", Run: wildcardAction},
	{Code: "TFG002", Name: "wildcard resource", Run: wildcardResource},
	{Code: "TFG003", Name: "resource wider than the claimed prefix", Run: widerThanPrefix},
	{Code: "TFG004", Name: "public access block missing or off", Run: publicAccessBlock},
	{Code: "TFG005", Name: "encryption off", Run: encryption},
	{Code: "TFG006", Name: "versioning off", Run: versioning},
	{Code: "TFG007", Name: "resource planned for delete", Run: plannedDelete},
	{Code: "TFG008", Name: "resource planned for replace", Run: plannedReplace},
	{Code: "TFG009", Name: "policy document unreadable", Run: policyUnreadable},
}

// Run runs every rule and returns the results sorted by code, then address, then message.
func Run(in *Input) []Result {
	var out []Result
	for _, r := range Rules {
		out = append(out, r.Run(in, r)...)
	}
	sort.SliceStable(out, func(i, j int) bool {
		a, b := out[i], out[j]
		if a.Code != b.Code {
			return a.Code < b.Code
		}
		if a.Address != b.Address {
			return a.Address < b.Address
		}
		return a.Message < b.Message
	})
	return out
}

func (r Rule) finding(addr, format string, args ...any) Result {
	return Result{Code: r.Code, Name: r.Name, Status: Finding, Address: addr, Message: fmt.Sprintf(format, args...)}
}

// unknown is the result for a value a rule needs that is known only after apply.
func (r Rule) unknown(addr, what string) Result {
	return Result{
		Code: r.Code, Name: r.Name, Status: Unknown, Address: addr,
		Message: fmt.Sprintf("%s: read %s as known after apply, expected a value at plan time to run the check for %s, so this check could not run and says nothing either way.", addr, what, r.Name),
	}
}

func quoteList(items []string) string {
	q := make([]string, len(items))
	for i, s := range items {
		q[i] = fmt.Sprintf("%q", s)
	}
	return strings.Join(q, ", ")
}

// ---- IAM rules ----

func wildcardAction(in *Input, r Rule) []Result {
	var out []Result
	for _, d := range in.Documents {
		addr := d.Resource.Address
		if d.Unknown {
			out = append(out, r.unknown(addr, "the policy document"))
			continue
		}
		if d.Policy == nil {
			continue
		}
		for i, st := range d.Policy.Statements {
			if st.Effect != "Allow" {
				continue
			}
			var wild []string
			for _, a := range st.Actions {
				if strings.Contains(a, "*") {
					wild = append(wild, a)
				}
			}
			if len(wild) > 0 {
				out = append(out, r.finding(addr, "%s: read statement %s with Allow action %s, expected named actions with no wildcard, so the statement grants every matching action.", addr, st.Label(i), quoteList(wild)))
			}
			if len(st.NotActions) > 0 {
				out = append(out, r.finding(addr, "%s: read statement %s with Allow and NotAction %s, expected an Allow with named actions, so the statement grants every action except those.", addr, st.Label(i), quoteList(st.NotActions)))
			}
		}
	}
	return out
}

func wildcardResource(in *Input, r Rule) []Result {
	var out []Result
	for _, d := range in.Documents {
		addr := d.Resource.Address
		if d.Unknown {
			out = append(out, r.unknown(addr, "the policy document"))
			continue
		}
		if d.Policy == nil {
			continue
		}
		for i, st := range d.Policy.Statements {
			if st.Effect != "Allow" {
				continue
			}
			for _, res := range st.Resources {
				if res == "*" {
					out = append(out, r.finding(addr, "%s: read statement %s with Allow Resource \"*\", expected the ARNs of the resources it is for, so the statement applies to every resource in the account.", addr, st.Label(i)))
				} else if bucket, _, _, ok := iam.S3Resource(res); ok && strings.Contains(bucket, "*") {
					out = append(out, r.finding(addr, "%s: read statement %s with Allow Resource %q, expected the ARN of one named bucket, so the statement applies to every bucket that matches the wildcard.", addr, st.Label(i), res))
				}
			}
			if len(st.NotResources) > 0 {
				out = append(out, r.finding(addr, "%s: read statement %s with Allow and NotResource %s, expected an Allow with named resources, so the statement applies to every resource except those.", addr, st.Label(i), quoteList(st.NotResources)))
			}
		}
	}
	return out
}

type bucketRef struct {
	node *graph.Node
	res  *plan.Resource
	name string
}

func liveBuckets(in *Input) (known map[string]bucketRef, unknownNames []*plan.Resource) {
	known = map[string]bucketRef{}
	for _, n := range in.Graph.NodesOfType("aws_s3_bucket") {
		for _, b := range n.Instances {
			if !b.Live() {
				continue
			}
			a := b.Attr("bucket")
			if name, ok := a.String(); ok {
				known[name] = bucketRef{node: n, res: b, name: name}
			} else if a.Unknown {
				unknownNames = append(unknownNames, b)
			}
		}
	}
	return known, unknownNames
}

// claimedPrefix finds the prefix a bucket's policy is meant to be limited to, and says where it read it.
func claimedPrefix(in *Input, d iam.Document, b bucketRef) (prefix, source string) {
	if in.Opts.Prefix != "" {
		return in.Opts.Prefix, "the --prefix option"
	}
	for i, st := range d.Policy.Statements {
		if st.Effect != "Allow" || !hasBucketARN(st, b.name) {
			continue
		}
		for _, c := range st.Conditions {
			if strings.EqualFold(c.Key, "s3:prefix") && len(c.Values) > 0 && !strings.Contains(c.Operator, "Not") {
				if claimed := strings.TrimRight(c.Values[0], "*"); claimed != "" {
					return claimed, "the s3:prefix condition of statement " + st.Label(i)
				}
			}
		}
	}
	for _, lc := range assocLive(in, b, "aws_s3_bucket_lifecycle_configuration") {
		rules, _ := lc.Values["rule"].([]any)
		for i := range rules {
			if p, ok := lc.Attr("rule", fmt.Sprint(i), "filter", "0", "prefix").String(); ok && p != "" {
				return p, "the lifecycle rule " + lc.Address
			}
		}
	}
	return "", ""
}

func hasBucketARN(st iam.Statement, bucket string) bool {
	for _, res := range st.Resources {
		if b, _, isObj, ok := iam.S3Resource(res); ok && !isObj && b == bucket {
			return true
		}
	}
	return false
}

func isListAction(a string) bool {
	return strings.HasPrefix(strings.ToLower(a), "s3:listbucket")
}

func widerThanPrefix(in *Input, r Rule) []Result {
	buckets, unknownNames := liveBuckets(in)
	var out []Result
	for _, d := range in.Documents {
		if d.Unknown {
			out = append(out, r.unknown(d.Resource.Address, "the policy document"))
			continue
		}
		if d.Policy == nil {
			continue
		}
		addr := d.Resource.Address
		needs := false
		for _, st := range d.Policy.Statements {
			if st.Effect != "Allow" {
				continue
			}
			for _, res := range st.Resources {
				if _, _, _, ok := iam.S3Resource(res); ok {
					needs = true
				}
			}
		}
		if !needs {
			continue
		}
		if len(unknownNames) > 0 && len(buckets) == 0 {
			out = append(out, r.unknown(addr, "the bucket name of "+unknownNames[0].Address))
			continue
		}
		for i, st := range d.Policy.Statements {
			if st.Effect != "Allow" {
				continue
			}
			for _, res := range st.Resources {
				bucket, key, isObj, ok := iam.S3Resource(res)
				if !ok || strings.Contains(bucket, "*") {
					continue
				}
				b, found := buckets[bucket]
				if !found {
					continue
				}
				prefix, source := claimedPrefix(in, d, b)
				if prefix == "" {
					out = append(out, Result{Code: r.Code, Name: r.Name, Status: Unknown, Address: addr, Message: fmt.Sprintf("%s: read statement %s on %q but found no prefix claimed by an s3:prefix condition, a lifecycle rule or the --prefix option, expected one to compare against, so this check could not run and says nothing either way.", addr, st.Label(i), res)})
					continue
				}
				if isObj {
					if !strings.HasPrefix(key, prefix) {
						out = append(out, r.finding(addr, "%s: read Resource %q in statement %s, expected a resource inside %q (the prefix from %s), so the statement reaches objects outside that prefix.", addr, res, st.Label(i), prefix, source))
					}
					continue
				}
				listing := false
				for _, a := range st.Actions {
					if isListAction(a) {
						listing = true
					}
				}
				if !listing {
					continue
				}
				var values []string
				for _, c := range st.Conditions {
					if strings.EqualFold(c.Key, "s3:prefix") && !strings.Contains(c.Operator, "Not") {
						values = append(values, c.Values...)
					}
				}
				if len(values) == 0 {
					out = append(out, r.finding(addr, "%s: read list statement %s on %q with no s3:prefix condition, expected a condition limiting the listing to %q (the prefix from %s), so the user can list every key in the bucket.", addr, st.Label(i), res, prefix, source))
					continue
				}
				for _, v := range values {
					if !strings.HasPrefix(v, prefix) {
						out = append(out, r.finding(addr, "%s: read s3:prefix condition %q in statement %s, expected a value inside %q (the prefix from %s), so the user can list keys outside that prefix.", addr, v, st.Label(i), prefix, source))
					}
				}
			}
		}
	}
	return out
}

func policyUnreadable(in *Input, r Rule) []Result {
	var out []Result
	for _, d := range in.Documents {
		if d.Err != "" {
			a := d.Resource.Address
			out = append(out, r.finding(a, "%s: read a policy document that could not be parsed (%s), expected a JSON policy with Version and Statement, so no IAM rule could be checked for it.", a, d.Err))
		}
	}
	return out
}

// ---- bucket rules ----

// assocLive returns the live resources of one type that belong to the bucket: linked by a reference in the
// configuration (or a dependency in the state), or naming the bucket in their `bucket` attribute.
func assocLive(in *Input, b bucketRef, typ string) []*plan.Resource {
	var out []*plan.Resource
	for _, n := range in.Graph.NodesOfType(typ) {
		linked := in.Graph.HasEdge(n.ID, b.node.ID)
		for _, inst := range n.Instances {
			if !inst.Live() {
				continue
			}
			named, haveName := inst.Attr("bucket").String()
			switch {
			case haveName && b.name != "":
				if named == b.name {
					out = append(out, inst)
				}
			case linked:
				out = append(out, inst)
			}
		}
	}
	return out
}

func eachBucket(in *Input, fn func(b bucketRef)) {
	for _, n := range in.Graph.NodesOfType("aws_s3_bucket") {
		for _, b := range n.Instances {
			if !b.Live() {
				continue
			}
			name, _ := b.Attr("bucket").String()
			fn(bucketRef{node: n, res: b, name: name})
		}
	}
}

func deletedAssoc(in *Input, b bucketRef, typ string) []string {
	var out []string
	for _, n := range in.Graph.NodesOfType(typ) {
		if !in.Graph.HasEdge(n.ID, b.node.ID) {
			continue
		}
		for _, inst := range n.Instances {
			if !inst.Live() {
				out = append(out, inst.Address)
			}
		}
	}
	return out
}

func missingNote(in *Input, b bucketRef, typ string) string {
	if d := deletedAssoc(in, b, typ); len(d) > 0 {
		return fmt.Sprintf("only %s, which this plan deletes", strings.Join(d, ", "))
	}
	return "none"
}

var publicBlockFlags = []string{"block_public_acls", "block_public_policy", "ignore_public_acls", "restrict_public_buckets"}

func publicAccessBlock(in *Input, r Rule) []Result {
	var out []Result
	const typ = "aws_s3_bucket_public_access_block"
	eachBucket(in, func(b bucketRef) {
		addr := b.res.Address
		blocks := assocLive(in, b, typ)
		if len(blocks) == 0 {
			out = append(out, r.finding(addr, "%s: read %s for the bucket (%s), expected one that sets %s to true, so the bucket can be made public.", addr, typ, missingNote(in, b, typ), strings.Join(publicBlockFlags, ", ")))
			return
		}
		for _, blk := range blocks {
			for _, flag := range publicBlockFlags {
				a := blk.Attr(flag)
				switch {
				case a.Unknown:
					out = append(out, r.unknown(blk.Address, flag))
				case !a.Found || a.Value != true:
					got := "no value (the provider default is false)"
					if a.Found {
						got = fmt.Sprintf("%v", a.Value)
					}
					out = append(out, r.finding(blk.Address, "%s: read %s as %s, expected true, so this public access protection is off for bucket %s.", blk.Address, flag, got, addr))
				}
			}
		}
	})
	return out
}

func encryption(in *Input, r Rule) []Result {
	var out []Result
	const typ = "aws_s3_bucket_server_side_encryption_configuration"
	eachBucket(in, func(b bucketRef) {
		addr := b.res.Address
		cfgs := assocLive(in, b, typ)
		if len(cfgs) == 0 {
			out = append(out, r.finding(addr, "%s: read %s for the bucket (%s), expected one with an SSE algorithm, so new objects are not encrypted by a bucket setting.", addr, typ, missingNote(in, b, typ)))
			return
		}
		for _, c := range cfgs {
			if c.Attr("rule").Unknown {
				out = append(out, r.unknown(c.Address, "rule"))
				continue
			}
			rules, _ := c.Values["rule"].([]any)
			have, unknownAlgo := false, false
			for i := range rules {
				a := c.Attr("rule", fmt.Sprint(i), "apply_server_side_encryption_by_default", "0", "sse_algorithm")
				if a.Unknown {
					unknownAlgo = true
				} else if s, ok := a.String(); ok && s != "" {
					have = true
				}
			}
			switch {
			case have:
			case unknownAlgo:
				out = append(out, r.unknown(c.Address, "sse_algorithm"))
			default:
				out = append(out, r.finding(c.Address, "%s: read no sse_algorithm in %d rule(s), expected AES256 or aws:kms, so new objects are not encrypted by a bucket setting.", c.Address, len(rules)))
			}
		}
	})
	return out
}

func versioning(in *Input, r Rule) []Result {
	var out []Result
	const typ = "aws_s3_bucket_versioning"
	eachBucket(in, func(b bucketRef) {
		addr := b.res.Address
		cfgs := assocLive(in, b, typ)
		if len(cfgs) == 0 {
			out = append(out, r.finding(addr, "%s: read %s for the bucket (%s), expected one with status Enabled, so overwritten and deleted objects cannot be recovered.", addr, typ, missingNote(in, b, typ)))
			return
		}
		for _, c := range cfgs {
			a := c.Attr("versioning_configuration", "0", "status")
			switch s, _ := a.String(); {
			case a.Unknown:
				out = append(out, r.unknown(c.Address, "status"))
			case s != "Enabled":
				shown := s
				if shown == "" {
					shown = "no status"
				}
				out = append(out, r.finding(c.Address, "%s: read versioning status %q, expected \"Enabled\", so overwritten and deleted objects cannot be recovered.", c.Address, shown))
			}
		}
	})
	return out
}

// ---- plan rules ----

func hasAction(r *plan.Resource, a string) bool {
	for _, x := range r.Actions {
		if x == a {
			return true
		}
	}
	return false
}

func plannedDelete(in *Input, r Rule) []Result {
	var out []Result
	for _, res := range in.Doc.Resources {
		if res.Mode == "managed" && len(res.Actions) == 1 && res.Actions[0] == "delete" {
			out = append(out, r.finding(res.Address, "%s: read a planned action of delete, expected create, update or no-op, so applying this plan destroys the %s.", res.Address, res.Type))
		}
	}
	return out
}

func plannedReplace(in *Input, r Rule) []Result {
	var out []Result
	for _, res := range in.Doc.Resources {
		if res.Mode == "managed" && len(res.Actions) == 2 && hasAction(res, "delete") && hasAction(res, "create") {
			out = append(out, r.finding(res.Address, "%s: read a planned action of %s, expected an in place update or no-op, so applying this plan destroys the %s and builds a new one.", res.Address, strings.Join(res.Actions, " then "), res.Type))
		}
	}
	return out
}
