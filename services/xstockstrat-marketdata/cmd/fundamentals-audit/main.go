// Command fundamentals-audit reports what a fundamentals backfill would change for a lane's stored
// rows (plan) and what a repair changed (diff). It opens no database connection and calls no
// xstockstrat service: stored rows come from files, derived periods from SEC EDGAR.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"strings"

	"github.com/xstockstrat/marketdata/internal/edgar"
	"github.com/xstockstrat/marketdata/internal/fundaudit"
	"github.com/xstockstrat/marketdata/internal/source"
)

const (
	exitOK = iota
	exitVerdictFailed
	exitUsage
)

const usage = `usage:
  fundamentals-audit plan -rows FILE -stored-version N -user-agent UA -rate-limit-rps N [-base-url URL] [-post-repair-failed SYM,SYM]
  fundamentals-audit diff -pre FILE -post FILE

A rows file is {"<SYMBOL>": [<period as query_fundamentals historical mode returns it>, ...]}.
`

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	code := run(ctx, os.Args[1:], os.Stdout, os.Stderr)
	stop()
	os.Exit(code)
}

func run(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		say(stderr, usage)
		return exitUsage
	}
	switch args[0] {
	case "plan":
		return runPlan(ctx, args[1:], stdout, stderr)
	case "diff":
		return runDiff(args[1:], stdout, stderr)
	default:
		say(stderr, usage)
		return exitUsage
	}
}

func runPlan(ctx context.Context, args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("plan", flag.ContinueOnError)
	fs.SetOutput(stderr)
	rowsPath := fs.String("rows", "", "lane rows file (required)")
	storedVersion := fs.Int("stored-version", -1, "derivation version of the lane's stored rows (required)")
	userAgent := fs.String("user-agent", "", "SEC fair-use User-Agent (required)")
	rateLimit := fs.Int("rate-limit-rps", 0, "SEC requests per second (required, > 0)")
	baseURL := fs.String("base-url", "", "SEC EDGAR base URL (default: the client's)")
	failed := fs.String("post-repair-failed", "", "post-repair run: comma-separated symbols the repair reported failed (may be empty)")
	if err := fs.Parse(args); err != nil {
		return exitUsage
	}
	postRepair := false
	fs.Visit(func(f *flag.Flag) { postRepair = postRepair || f.Name == "post-repair-failed" })
	if *rowsPath == "" || *storedVersion < 0 || *userAgent == "" || *rateLimit <= 0 {
		say(stderr, "plan: -rows, -stored-version, -user-agent and -rate-limit-rps are required\n"+usage)
		return exitUsage
	}
	rows, err := readRows(*rowsPath, *storedVersion)
	if err != nil {
		say(stderr, err)
		return exitUsage
	}
	report := fundaudit.Plan(ctx, edgar.NewClient(*baseURL, *userAgent, *rateLimit), rows, *storedVersion)
	if postRepair {
		var symbols []string
		for _, s := range strings.Split(*failed, ",") {
			if s = strings.TrimSpace(s); s != "" {
				symbols = append(symbols, s)
			}
		}
		verdict := fundaudit.PostRepairVerdict(report, symbols)
		report.PostRepair = &verdict
	}
	if err := writeJSON(stdout, report); err != nil {
		say(stderr, err)
		return exitUsage
	}
	if report.PostRepair != nil && !report.PostRepair.Pass {
		return exitVerdictFailed
	}
	return exitOK
}

func runDiff(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("diff", flag.ContinueOnError)
	fs.SetOutput(stderr)
	prePath := fs.String("pre", "", "rows file read before the repair (required)")
	postPath := fs.String("post", "", "rows file read after the repair (required)")
	if err := fs.Parse(args); err != nil {
		return exitUsage
	}
	if *prePath == "" || *postPath == "" {
		say(stderr, "diff: -pre and -post are required\n"+usage)
		return exitUsage
	}
	// The diff reads no version, so none is assigned.
	pre, err := readRows(*prePath, 0)
	if err != nil {
		say(stderr, err)
		return exitUsage
	}
	post, err := readRows(*postPath, 0)
	if err != nil {
		say(stderr, err)
		return exitUsage
	}
	if err := writeJSON(stdout, fundaudit.Diff(pre, post)); err != nil {
		say(stderr, err)
		return exitUsage
	}
	return exitOK
}

func say(w io.Writer, a ...any) { _, _ = fmt.Fprintln(w, a...) }

func readRows(path string, storedVersion int) (map[string][]source.HistoricalPriceState, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close() //nolint:errcheck
	rows, err := fundaudit.ParseRows(f, storedVersion)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	return rows, nil
}

func writeJSON(w io.Writer, v any) error {
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	return enc.Encode(v)
}
