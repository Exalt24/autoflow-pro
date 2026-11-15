// Command tfgraph reads `terraform show -json` output, builds a graph of the resources and checks the IAM
// documents and the S3 bucket settings in it.
package main

import (
	"os"

	"github.com/Exalt24/autoflow-pro/deploy/aws/tfgraph/internal/cli"
)

func main() {
	os.Exit(cli.Run(os.Args[1:], os.Stdout, os.Stderr))
}
