// Package cli is the command line of tfgraph, kept apart from main so tests can call it.
package cli

import (
	"fmt"
	"io"
	"strings"

	"github.com/Exalt24/autoflow-pro/deploy/aws/tfgraph/internal/graph"
	"github.com/Exalt24/autoflow-pro/deploy/aws/tfgraph/internal/iam"
	"github.com/Exalt24/autoflow-pro/deploy/aws/tfgraph/internal/plan"
	"github.com/Exalt24/autoflow-pro/deploy/aws/tfgraph/internal/report"
	"github.com/Exalt24/autoflow-pro/deploy/aws/tfgraph/internal/rules"
)

// Exit codes of `tfgraph check`.
const (
	ExitClean    = 0
	ExitFindings = 1
	ExitInput    = 2
)

const usage = `usage:
  tfgraph check <plan.json|state.json> [--format text|json] [--prefix executions/]
  tfgraph graph <plan.json|state.json> [--format text|json] [--resources-only]

The input is the output of "terraform show -json <planfile>" or "terraform show -json" of a state.
check exits 0 when clean, 1 when there is a finding and 2 when the input could not be read.
An UNKNOWN result (a value known only after apply) is printed but does not change the exit code.`

type options struct {
	format        string
	prefix        string
	resourcesOnly bool
	file          string
}

// Run executes one command line and returns the exit code.
func Run(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 || args[0] == "-h" || args[0] == "--help" || args[0] == "help" {
		fmt.Fprintln(stderr, usage)
		if len(args) == 0 {
			return ExitInput
		}
		return ExitClean
	}
	cmd := args[0]
	if cmd != "check" && cmd != "graph" {
		fmt.Fprintf(stderr, "tfgraph: read the command %q but expected check or graph\n%s\n", cmd, usage)
		return ExitInput
	}
	opts, err := parseOptions(args[1:])
	if err != nil {
		fmt.Fprintf(stderr, "tfgraph: %v\n%s\n", err, usage)
		return ExitInput
	}
	doc, err := plan.Load(opts.file)
	if err != nil {
		fmt.Fprintf(stderr, "tfgraph: %v\n", err)
		return ExitInput
	}
	g := graph.Build(doc)
	access := iam.Resolve(doc, g)
	if cmd == "graph" {
		if opts.format == "json" {
			if err := report.GraphJSON(stdout, g, opts.resourcesOnly); err != nil {
				fmt.Fprintf(stderr, "tfgraph: could not write the graph: %v\n", err)
				return ExitInput
			}
			return ExitClean
		}
		report.GraphText(stdout, g, opts.resourcesOnly)
		return ExitClean
	}
	results := rules.Run(&rules.Input{Doc: doc, Graph: g, Documents: iam.Documents(doc), Opts: rules.Options{Prefix: opts.prefix}})
	rep := report.New(doc, g, access, results)
	if opts.format == "json" {
		if err := report.JSON(stdout, rep); err != nil {
			fmt.Fprintf(stderr, "tfgraph: could not write the report: %v\n", err)
			return ExitInput
		}
	} else {
		report.Text(stdout, rep)
	}
	return rep.ExitCode()
}

// parseOptions accepts flags before or after the one file argument.
func parseOptions(args []string) (options, error) {
	o := options{format: "text"}
	for i := 0; i < len(args); i++ {
		a := args[i]
		name, value, hasValue := strings.Cut(a, "=")
		next := func() (string, error) {
			if hasValue {
				return value, nil
			}
			if i+1 >= len(args) {
				return "", fmt.Errorf("read %s with no value but expected one after it", name)
			}
			i++
			return args[i], nil
		}
		switch name {
		case "--format":
			v, err := next()
			if err != nil {
				return o, err
			}
			if v != "text" && v != "json" {
				return o, fmt.Errorf("read --format %q but expected text or json", v)
			}
			o.format = v
		case "--prefix":
			v, err := next()
			if err != nil {
				return o, err
			}
			o.prefix = v
		case "--resources-only":
			o.resourcesOnly = true
		default:
			if strings.HasPrefix(a, "-") && a != "-" {
				return o, fmt.Errorf("read the option %q but expected --format, --prefix or --resources-only", a)
			}
			if o.file != "" {
				return o, fmt.Errorf("read a second file %q but expected exactly one input file", a)
			}
			o.file = a
		}
	}
	if o.file == "" {
		return o, fmt.Errorf("read no input file but expected the path of a plan.json or state.json")
	}
	return o, nil
}
