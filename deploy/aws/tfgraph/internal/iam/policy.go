// Package iam parses IAM policy documents into plain data and resolves which policy reaches which IAM user.
package iam

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// Condition is one operator, key and value list of a statement's Condition block.
type Condition struct {
	Operator string   `json:"operator"`
	Key      string   `json:"key"`
	Values   []string `json:"values"`
}

// Statement is one parsed statement. Every field that IAM lets be a string or a list is a list here.
type Statement struct {
	Sid          string      `json:"sid,omitempty"`
	Effect       string      `json:"effect"`
	Actions      []string    `json:"actions,omitempty"`
	NotActions   []string    `json:"not_actions,omitempty"`
	Resources    []string    `json:"resources,omitempty"`
	NotResources []string    `json:"not_resources,omitempty"`
	Conditions   []Condition `json:"conditions,omitempty"`
}

// Label names the statement in messages: its Sid, or its position.
func (s Statement) Label(index int) string {
	if s.Sid != "" {
		return s.Sid
	}
	return "#" + strconv.Itoa(index+1)
}

// Policy is a parsed policy document.
type Policy struct {
	Version    string      `json:"version,omitempty"`
	Statements []Statement `json:"statements"`
}

// Parse reads a policy document. Statement may be one object or a list; Action, Resource and the Not forms may be
// one string or a list.
func Parse(document string) (*Policy, error) {
	var raw struct {
		Version   string          `json:"Version"`
		Statement json.RawMessage `json:"Statement"`
	}
	if err := json.Unmarshal([]byte(document), &raw); err != nil {
		return nil, fmt.Errorf("the document is not a JSON object (%s)", plainJSON(err))
	}
	if len(raw.Statement) == 0 {
		return nil, fmt.Errorf("the document has no Statement")
	}
	var list []json.RawMessage
	if err := json.Unmarshal(raw.Statement, &list); err != nil {
		var one json.RawMessage
		if err2 := json.Unmarshal(raw.Statement, &one); err2 != nil {
			return nil, fmt.Errorf("Statement is neither an object nor a list (%s)", plainJSON(err))
		}
		list = []json.RawMessage{one}
	}
	p := &Policy{Version: raw.Version}
	for i, item := range list {
		var rs struct {
			Sid         string                    `json:"Sid"`
			Effect      string                    `json:"Effect"`
			Action      json.RawMessage           `json:"Action"`
			NotAction   json.RawMessage           `json:"NotAction"`
			Resource    json.RawMessage           `json:"Resource"`
			NotResource json.RawMessage           `json:"NotResource"`
			Condition   map[string]map[string]any `json:"Condition"`
		}
		if err := json.Unmarshal(item, &rs); err != nil {
			return nil, fmt.Errorf("statement %d is not a JSON object of the usual shape (%s)", i+1, plainJSON(err))
		}
		if rs.Effect != "Allow" && rs.Effect != "Deny" {
			return nil, fmt.Errorf("statement %d has Effect %q where Allow or Deny is needed", i+1, rs.Effect)
		}
		st := Statement{Sid: rs.Sid, Effect: rs.Effect}
		var err error
		if st.Actions, err = stringList(rs.Action); err != nil {
			return nil, fmt.Errorf("statement %d Action: %v", i+1, err)
		}
		if st.NotActions, err = stringList(rs.NotAction); err != nil {
			return nil, fmt.Errorf("statement %d NotAction: %v", i+1, err)
		}
		if st.Resources, err = stringList(rs.Resource); err != nil {
			return nil, fmt.Errorf("statement %d Resource: %v", i+1, err)
		}
		if st.NotResources, err = stringList(rs.NotResource); err != nil {
			return nil, fmt.Errorf("statement %d NotResource: %v", i+1, err)
		}
		ops := make([]string, 0, len(rs.Condition))
		for op := range rs.Condition {
			ops = append(ops, op)
		}
		sort.Strings(ops)
		for _, op := range ops {
			keys := make([]string, 0, len(rs.Condition[op]))
			for k := range rs.Condition[op] {
				keys = append(keys, k)
			}
			sort.Strings(keys)
			for _, k := range keys {
				st.Conditions = append(st.Conditions, Condition{Operator: op, Key: k, Values: anyList(rs.Condition[op][k])})
			}
		}
		p.Statements = append(p.Statements, st)
	}
	return p, nil
}

func stringList(raw json.RawMessage) ([]string, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return []string{s}, nil
	}
	var l []string
	if err := json.Unmarshal(raw, &l); err != nil {
		return nil, fmt.Errorf("is neither a string nor a list of strings")
	}
	return l, nil
}

func anyList(v any) []string {
	switch t := v.(type) {
	case []any:
		out := make([]string, 0, len(t))
		for _, e := range t {
			out = append(out, fmt.Sprint(e))
		}
		return out
	case nil:
		return nil
	default:
		return []string{fmt.Sprint(t)}
	}
}

// Describe is the statement on one line, for the text report.
func (s Statement) Describe() string {
	var b strings.Builder
	b.WriteString(s.Effect)
	switch {
	case len(s.Actions) > 0:
		b.WriteString(" " + strings.Join(s.Actions, " "))
	case len(s.NotActions) > 0:
		b.WriteString(" every action except " + strings.Join(s.NotActions, " "))
	}
	switch {
	case len(s.Resources) > 0:
		b.WriteString(" on " + strings.Join(s.Resources, " "))
	case len(s.NotResources) > 0:
		b.WriteString(" on every resource except " + strings.Join(s.NotResources, " "))
	}
	if len(s.Conditions) == 0 {
		b.WriteString(", no condition")
	}
	for _, c := range s.Conditions {
		b.WriteString(fmt.Sprintf(", when %s %s is %s", c.Operator, c.Key, strings.Join(c.Values, " or ")))
	}
	return b.String()
}

// plainJSON keeps the position of a syntax error and drops the Go type names of a type error, which mean
// nothing to someone reading a policy.
func plainJSON(err error) string {
	var se *json.SyntaxError
	if errors.As(err, &se) {
		return se.Error()
	}
	return "it has a value of the wrong JSON type"
}
