package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/xstockstrat/portfolio/internal/repository"
)

// runBackfillSignalExpiry is the operator subcommand: flag parsing, the DATABASE_URL guard and exit
// codes only — every refusal and bound check lives in repository.RunBackfill.
func runBackfillSignalExpiry(args []string) int {
	fs := flag.NewFlagSet("backfill-signal-expiry", flag.ContinueOnError)
	mode := fs.String("mode", repository.BackfillModeReport, "report|apply")
	legacyOwner := fs.String("legacy-owner", "", "user id that owns pre-feature-224 signal rows (required)")
	expectUntracked := fs.Int64("expect-untracked", 0, "apply: at-most untracked count printed by REPORT")
	expectSeedExpired := fs.Int64("expect-seed-expired", 0, "apply: at-most seed_expired count printed by REPORT")
	if err := fs.Parse(args); err != nil {
		return 2
	}

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		fmt.Fprintln(os.Stderr, "backfill-signal-expiry: DATABASE_URL is required (pooled :25061 URL; no .env fallback)")
		return 2
	}
	pcfg, err := pgxpool.ParseConfig(dbURL)
	if err != nil {
		fmt.Fprintf(os.Stderr, "backfill-signal-expiry: invalid DATABASE_URL: %v\n", err)
		return 2
	}
	fmt.Printf("target host=%s db=%s\n", pcfg.ConnConfig.Host, pcfg.ConnConfig.Database)

	opts := repository.BackfillOptions{Mode: *mode, LegacyOwner: *legacyOwner}
	fs.Visit(func(f *flag.Flag) {
		switch f.Name {
		case "expect-untracked":
			opts.ExpectUntracked = expectUntracked
		case "expect-seed-expired":
			opts.ExpectSeedExpired = expectSeedExpired
		}
	})

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	repo, err := repository.NewPortfolioRepo(dbURL)
	if err != nil {
		fmt.Fprintf(os.Stderr, "backfill-signal-expiry: %v\n", err)
		return 1
	}
	defer repo.Pool().Close()

	if _, err := repository.RunBackfill(ctx, repo.Pool(), opts, os.Stdout); err != nil {
		fmt.Fprintf(os.Stderr, "backfill-signal-expiry: %v\n", err)
		if errors.Is(err, repository.ErrBackfillRefused) {
			return 3
		}
		return 1
	}
	return 0
}
