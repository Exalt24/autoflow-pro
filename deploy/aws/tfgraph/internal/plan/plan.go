// Package plan reads the JSON that `terraform show -json` prints for a plan file or for a state and turns it
// into one flat list of resources and references, so the rest of tfgraph does not care which of the two it was given.
package plan

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// Kind says which representation was read.
type Kind string

const (
	KindPlan  Kind = "plan"
	KindState Kind = "state"
)

// InputError is a failure to use the input. Its message always says what was read and what was expected.
type InputError struct {
	Source   string
	Read     string
	Expected string
}

func (e *InputError) Error() string {
	return fmt.Sprintf("could not use %s: read %s but expected %s", e.Source, e.Read, e.Expected)
}

const expectedShape = "the JSON printed by `terraform show -json <planfile>` or `terraform show -json` of a state"

// Resource is one resource instance as planned or as stored in state.
type Resource struct {
	Address       string         // instance address, for example aws_iam_access_key.archive_writer[0]
	ConfigAddress string         // the same without instance keys, the graph node it belongs to
	Mode          string         // managed or data
	Type          string         // aws_s3_bucket
	Name          string         // archive
	Actions       []string       // plan only: create, update, delete, no-op, read
	Values        map[string]any // planned values (plan) or stored values (state); nil when the plan deletes it
	Before        map[string]any // plan only
	Unknown       any            // the after_unknown tree: true, or a map or list that mirrors Values
}

// Live reports whether the resource still exists after the plan is applied.
func (r *Resource) Live() bool {
	return !(len(r.Actions) == 1 && r.Actions[0] == "delete")
}

// Reference is a use of one address inside another's configuration, or a dependency recorded in a state.
type Reference struct {
	From string // config address of the resource that holds the reference
	To   string // config address of what it points at, or var.x, local.x, module.x
	Via  string // the attribute of From that holds the reference, empty for depends_on and state
	Kind string // config, depends_on or state
}

// Doc is the normalised input.
type Doc struct {
	Source           string
	Kind             Kind
	FormatVersion    string
	TerraformVersion string
	Resources        []*Resource
	Refs             []Reference
	Relevant         map[string][]string // plan only: attributes of a resource that other resources read
	HasConfiguration bool
}

type rawChange struct {
	Address       string `json:"address"`
	ModuleAddress string `json:"module_address"`
	Mode          string `json:"mode"`
	Type          string `json:"type"`
	Name          string `json:"name"`
	Change        struct {
		Actions      []string `json:"actions"`
		Before       any      `json:"before"`
		After        any      `json:"after"`
		AfterUnknown any      `json:"after_unknown"`
	} `json:"change"`
}

type rawStateResource struct {
	Address   string         `json:"address"`
	Mode      string         `json:"mode"`
	Type      string         `json:"type"`
	Name      string         `json:"name"`
	Values    map[string]any `json:"values"`
	DependsOn []string       `json:"depends_on"`
}

type rawStateModule struct {
	Address      string             `json:"address"`
	Resources    []rawStateResource `json:"resources"`
	ChildModules []rawStateModule   `json:"child_modules"`
}

type rawValues struct {
	RootModule rawStateModule `json:"root_module"`
}

type rawConfigResource struct {
	Address         string         `json:"address"`
	Expressions     map[string]any `json:"expressions"`
	DependsOn       []string       `json:"depends_on"`
	CountExpression any            `json:"count_expression"`
	ForEachExpr     any            `json:"for_each_expression"`
}

type rawConfigModule struct {
	Resources   []rawConfigResource `json:"resources"`
	ModuleCalls map[string]struct {
		Expressions map[string]any  `json:"expressions"`
		Module      rawConfigModule `json:"module"`
	} `json:"module_calls"`
}

type rawDoc struct {
	FormatVersion    string          `json:"format_version"`
	TerraformVersion string          `json:"terraform_version"`
	Errored          *bool           `json:"errored"`
	PlannedValues    json.RawMessage `json:"planned_values"`
	ResourceChanges  []rawChange     `json:"resource_changes"`
	PriorState       *struct {
		Values *rawValues `json:"values"`
	} `json:"prior_state"`
	Relevant []struct {
		Resource  string   `json:"resource"`
		Attribute []string `json:"attribute"`
	} `json:"relevant_attributes"`
	Configuration *struct {
		RootModule rawConfigModule `json:"root_module"`
	} `json:"configuration"`
	Values *rawValues `json:"values"`
}

// Load reads a file.
func Load(path string) (*Doc, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, &InputError{Source: path, Read: "nothing (" + simplifyOSError(err) + ")", Expected: expectedShape}
	}
	return Parse(path, data)
}

func simplifyOSError(err error) string {
	msg := err.Error()
	if i := strings.LastIndex(msg, ": "); i >= 0 {
		return msg[i+2:]
	}
	return msg
}

var indexKey = regexp.MustCompile(`\[[^\]]*\]`)

// ConfigAddress removes instance keys: module.a[0].aws_x.y["k"] becomes module.a.aws_x.y.
func ConfigAddress(address string) string { return indexKey.ReplaceAllString(address, "") }

// Parse reads the JSON bytes of a plan or a state. source names where they came from, for messages.
func Parse(source string, data []byte) (*Doc, error) {
	if len(bytes.TrimSpace(data)) == 0 {
		return nil, &InputError{Source: source, Read: "an empty file", Expected: expectedShape}
	}
	var raw rawDoc
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, &InputError{Source: source, Read: fmt.Sprintf("%d bytes that are not a JSON object of that shape (%s)", len(data), jsonErrorText(err)), Expected: expectedShape}
	}
	doc := &Doc{Source: source, FormatVersion: raw.FormatVersion, TerraformVersion: raw.TerraformVersion, Relevant: map[string][]string{}}
	if major, _, _ := strings.Cut(raw.FormatVersion, "."); raw.FormatVersion != "" && major != "1" {
		return nil, &InputError{Source: source, Read: "format_version " + raw.FormatVersion, Expected: "format_version 1.x, which is what Terraform 1.x prints"}
	}
	isPlan := raw.PlannedValues != nil || raw.ResourceChanges != nil
	isState := raw.Values != nil && !isPlan
	switch {
	case isPlan:
		if raw.Errored != nil && *raw.Errored {
			return nil, &InputError{Source: source, Read: "a plan with errored set to true", Expected: "a plan that finished, so the resource changes can be trusted"}
		}
		doc.Kind = KindPlan
		loadPlan(doc, &raw)
	case isState:
		doc.Kind = KindState
		loadState(doc, raw.Values)
	default:
		return nil, &InputError{Source: source, Read: "a JSON object with neither resource_changes (a plan) nor values (a state)", Expected: expectedShape}
	}
	if raw.Configuration != nil {
		doc.HasConfiguration = true
		walkConfig(doc, "", raw.Configuration.RootModule)
	}
	sort.SliceStable(doc.Resources, func(i, j int) bool { return doc.Resources[i].Address < doc.Resources[j].Address })
	return doc, nil
}

func jsonErrorText(err error) string {
	if se, ok := err.(*json.SyntaxError); ok {
		return fmt.Sprintf("syntax error at byte %d: %v", se.Offset, se)
	}
	if ue, ok := err.(*json.UnmarshalTypeError); ok {
		return fmt.Sprintf("field %q holds %s, which is not the shape terraform prints", ue.Field, ue.Value)
	}
	return err.Error()
}

func asMap(v any) map[string]any {
	m, _ := v.(map[string]any)
	return m
}

func loadPlan(doc *Doc, raw *rawDoc) {
	seen := map[string]bool{}
	for _, c := range raw.ResourceChanges {
		r := &Resource{
			Address: c.Address, ConfigAddress: ConfigAddress(c.Address), Mode: c.Mode, Type: c.Type, Name: c.Name,
			Actions: c.Change.Actions, Values: asMap(c.Change.After), Before: asMap(c.Change.Before), Unknown: c.Change.AfterUnknown,
		}
		if len(r.Actions) == 1 && r.Actions[0] == "delete" {
			r.Values = nil
		}
		doc.Resources = append(doc.Resources, r)
		seen[c.Address] = true
	}
	if raw.PriorState != nil && raw.PriorState.Values != nil {
		collectState(doc, raw.PriorState.Values.RootModule, func(sr rawStateResource) {
			for _, d := range sr.DependsOn {
				doc.Refs = append(doc.Refs, Reference{From: ConfigAddress(sr.Address), To: ConfigAddress(d), Kind: "state"})
			}
			if seen[sr.Address] {
				return
			}
			doc.Resources = append(doc.Resources, &Resource{
				Address: sr.Address, ConfigAddress: ConfigAddress(sr.Address), Mode: sr.Mode, Type: sr.Type, Name: sr.Name, Values: sr.Values,
			})
		})
	}
	for _, r := range raw.Relevant {
		key := ConfigAddress(r.Resource)
		doc.Relevant[key] = append(doc.Relevant[key], strings.Join(r.Attribute, "."))
	}
}

func loadState(doc *Doc, v *rawValues) {
	collectState(doc, v.RootModule, func(sr rawStateResource) {
		doc.Resources = append(doc.Resources, &Resource{
			Address: sr.Address, ConfigAddress: ConfigAddress(sr.Address), Mode: sr.Mode, Type: sr.Type, Name: sr.Name, Values: sr.Values,
		})
		for _, d := range sr.DependsOn {
			doc.Refs = append(doc.Refs, Reference{From: ConfigAddress(sr.Address), To: ConfigAddress(d), Kind: "state"})
		}
	})
}

func collectState(doc *Doc, m rawStateModule, fn func(rawStateResource)) {
	for _, r := range m.Resources {
		fn(r)
	}
	for _, c := range m.ChildModules {
		collectState(doc, c, fn)
	}
}

func walkConfig(doc *Doc, prefix string, m rawConfigModule) {
	for _, r := range m.Resources {
		from := prefix + r.Address
		for _, d := range r.DependsOn {
			if to := NormalizeReference(prefix, d); to != "" {
				doc.Refs = append(doc.Refs, Reference{From: from, To: to, Kind: "depends_on"})
			}
		}
		for _, extra := range []struct {
			name string
			expr any
		}{{"count", r.CountExpression}, {"for_each", r.ForEachExpr}} {
			collectRefs(doc, prefix, from, extra.name, extra.expr)
		}
		keys := make([]string, 0, len(r.Expressions))
		for k := range r.Expressions {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			collectRefs(doc, prefix, from, k, r.Expressions[k])
		}
	}
	names := make([]string, 0, len(m.ModuleCalls))
	for n := range m.ModuleCalls {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		walkConfig(doc, prefix+"module."+n+".", m.ModuleCalls[n].Module)
	}
}

// collectRefs walks one expression value. An expression object has a "references" list, a "constant_value", or
// (for a nested block) is a list or map of further expressions.
func collectRefs(doc *Doc, prefix, from, via string, v any) {
	switch t := v.(type) {
	case map[string]any:
		if refs, ok := t["references"].([]any); ok {
			for _, r := range refs {
				if s, ok := r.(string); ok {
					if to := NormalizeReference(prefix, s); to != "" {
						doc.Refs = append(doc.Refs, Reference{From: from, To: to, Via: via, Kind: "config"})
					}
				}
			}
			return
		}
		if _, ok := t["constant_value"]; ok {
			return
		}
		keys := make([]string, 0, len(t))
		for k := range t {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			collectRefs(doc, prefix, from, via+"."+k, t[k])
		}
	case []any:
		for i, e := range t {
			collectRefs(doc, prefix, from, via+"."+strconv.Itoa(i), e)
		}
	}
}

// NormalizeReference turns a reference as Terraform writes it (aws_s3_bucket.archive.id, var.region,
// data.aws_partition.current.partition, module.net.vpc_id) into the config address of the thing it names,
// prefixed with the module path the reference was written in. It returns "" for iterators such as each, count
// and self, which name no node.
func NormalizeReference(prefix, ref string) string {
	ref = indexKey.ReplaceAllString(ref, "")
	parts := strings.Split(ref, ".")
	if len(parts) < 2 {
		return ""
	}
	switch parts[0] {
	case "each", "count", "self", "path", "terraform":
		return ""
	case "var", "local", "module":
		return prefix + parts[0] + "." + parts[1]
	case "data":
		if len(parts) < 3 {
			return ""
		}
		return prefix + strings.Join(parts[:3], ".")
	}
	return prefix + parts[0] + "." + parts[1]
}

// Attr is the result of looking up one attribute path.
type Attr struct {
	Value   any
	Found   bool
	Unknown bool // known only after apply
}

// Attr looks a path up in the planned values. A path segment that is a number indexes a list, which is how
// Terraform writes a nested block (versioning_configuration.0.status).
func (r *Resource) Attr(path ...string) Attr {
	if unknownAt(r.Unknown, path) {
		return Attr{Unknown: true}
	}
	var cur any = r.Values
	if r.Values == nil {
		return Attr{}
	}
	for _, seg := range path {
		switch t := cur.(type) {
		case map[string]any:
			next, ok := t[seg]
			if !ok {
				return Attr{}
			}
			cur = next
		case []any:
			i, err := strconv.Atoi(seg)
			if err != nil || i < 0 || i >= len(t) {
				return Attr{}
			}
			cur = t[i]
		default:
			return Attr{}
		}
	}
	return Attr{Value: cur, Found: true}
}

// String is the attribute as a string when it is one.
func (a Attr) String() (string, bool) {
	s, ok := a.Value.(string)
	return s, a.Found && ok
}

func unknownAt(tree any, path []string) bool {
	cur := tree
	for _, seg := range path {
		switch t := cur.(type) {
		case bool:
			return t
		case map[string]any:
			next, ok := t[seg]
			if !ok {
				return false
			}
			cur = next
		case []any:
			i, err := strconv.Atoi(seg)
			if err != nil || i < 0 || i >= len(t) {
				return false
			}
			cur = t[i]
		default:
			return false
		}
	}
	b, _ := cur.(bool)
	return b
}
