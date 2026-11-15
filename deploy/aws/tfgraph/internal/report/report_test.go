package report_test

import (
	"bytes"
	"strings"
	"testing"

	"github.com/Exalt24/autoflow-pro/deploy/aws/tfgraph/internal/graph"
	"github.com/Exalt24/autoflow-pro/deploy/aws/tfgraph/internal/iam"
	"github.com/Exalt24/autoflow-pro/deploy/aws/tfgraph/internal/plan"
	"github.com/Exalt24/autoflow-pro/deploy/aws/tfgraph/internal/report"
	"github.com/Exalt24/autoflow-pro/deploy/aws/tfgraph/internal/rules"
	"github.com/Exalt24/autoflow-pro/deploy/aws/tfgraph/internal/testutil"
)

func build(t *testing.T, results []rules.Result) *report.Report {
	t.Helper()
	doc := testutil.Load(t, "real/plan-create-offline.json")
	g := graph.Build(doc)
	return report.New(doc, g, iam.Resolve(doc, g), results)
}

func TestCountsAndExitCode(t *testing.T) {
	cases := []struct {
		name               string
		results            []rules.Result
		findings, unknowns int
		exit               int
		resultLine         string
	}{
		{"clean", nil, 0, 0, 0, "Result: clean, 9 rules run on 10 resources"},
		{"one finding", []rules.Result{{Code: "TFG001", Status: rules.Finding}}, 1, 0, 1, "Result: 1 finding, 0 unknown, 9 rules run on 10 resources"},
		{"two findings and an unknown", []rules.Result{{Status: rules.Finding}, {Status: rules.Finding}, {Status: rules.Unknown}}, 2, 1, 1, "Result: 2 findings, 1 unknown, 9 rules run on 10 resources"},
		{"unknown only", []rules.Result{{Status: rules.Unknown}}, 0, 1, 0, "Result: no findings, 1 unknown (those checks could not run, so this is not clean), 9 rules run on 10 resources"},
	}
	for _, c := range cases {
		r := build(t, c.results)
		if r.Findings != c.findings || r.Unknowns != c.unknowns || r.ExitCode() != c.exit {
			t.Errorf("%s: findings %d unknowns %d exit %d", c.name, r.Findings, r.Unknowns, r.ExitCode())
		}
		var buf bytes.Buffer
		report.Text(&buf, r)
		if !strings.Contains(buf.String(), c.resultLine+"\n") {
			t.Errorf("%s: text lacks %q:\n%s", c.name, c.resultLine, buf.String())
		}
	}
}

func TestEmptyReportEncodesEmptyLists(t *testing.T) {
	doc := &plan.Doc{Source: "x.json", Kind: plan.KindPlan}
	r := report.New(doc, graph.Build(doc), nil, nil)
	var buf bytes.Buffer
	if err := report.JSON(&buf, r); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(buf.String(), `"results": []`) || !strings.Contains(buf.String(), `"iam_access": []`) {
		t.Errorf("lists must be [] and not null:\n%s", buf.String())
	}
}
