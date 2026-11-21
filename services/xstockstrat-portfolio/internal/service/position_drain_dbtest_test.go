//go:build dbtest

package service

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"google.golang.org/protobuf/proto"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	portfoliov1 "github.com/xstockstrat/contracts/gen/go/portfolio/v1"
	"github.com/xstockstrat/portfolio/internal/repository"
)

// drainDBTestPrefix scopes this package's seeded rows; it must never start with the repository dbtests' prefix.
const drainDBTestPrefix = "it-357-"

// Twin of repository testPool (internal/repository/dbtest_helpers_test.go:22-44); keep the skip/CI-fatal/lock_timeout rules in step (C-18 waiver D-17).
func serviceTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("PORTFOLIO_DB_TEST_URL")
	if url == "" {
		if os.Getenv("CI") == "true" {
			t.Fatal("PORTFOLIO_DB_TEST_URL is unset under CI=true; the portfolio-db-test job must provide it")
		}
		t.Skip("PORTFOLIO_DB_TEST_URL unset; skipping real-Postgres test")
	}
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatalf("pgxpool.ParseConfig: %v", err)
	}
	cfg.ConnConfig.RuntimeParams["lock_timeout"] = "500ms"
	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatalf("pgxpool.NewWithConfig: %v", err)
	}
	t.Cleanup(pool.Close)
	t.Cleanup(func() {
		if _, err := pool.Exec(context.Background(),
			`DELETE FROM portfolio.positions WHERE user_id LIKE $1`, drainDBTestPrefix+"%"); err != nil {
			t.Errorf("cleanup positions: %v", err)
		}
	})
	return pool
}

// drainDBFixture seeds n PAPER positions S000.. on account for userID and returns a service over the real repo.
func drainDBFixture(t *testing.T, pool *pgxpool.Pool, userID, account string, n int) *PortfolioService {
	t.Helper()
	repo := repository.NewPortfolioRepoWithDB(pool)
	seedDrainPositions(t, repo, userID, account, n)
	stub := &stubMarketData{}
	for i := 0; i < n; i++ {
		stub.quotes = append(stub.quotes, quote(fmt.Sprintf("S%03d", i), 11))
	}
	return &PortfolioService{repo: repo, marketdata: stub, ledger: &fakeLedger{}, subs: map[string]snapshotSubscriber{}}
}

func seedDrainPositions(t *testing.T, repo *repository.PortfolioRepo, userID, account string, n int) {
	t.Helper()
	for i := 0; i < n; i++ {
		if err := repo.UpsertPosition(context.Background(), userID, fmt.Sprintf("S%03d", i), 1, 10, 10,
			commonv1.TradingMode_TRADING_MODE_PAPER, account, 0, 0); err != nil {
			t.Fatalf("seed position %d: %v", i, err)
		}
	}
}

func drainDBUser(t *testing.T) string {
	return fmt.Sprintf("%s%s-%d", drainDBTestPrefix, t.Name(), time.Now().UnixNano())
}

func TestPositionDrain_357_AC1_GetPnLCountsAll501(t *testing.T) {
	pool := serviceTestPool(t)
	userID := drainDBUser(t)
	svc := drainDBFixture(t, pool, userID, userID+"-a", 501)

	resp, err := svc.GetPnL(ctxWithUser(t, userID), &portfoliov1.GetPnLRequest{TradingMode: commonv1.TradingMode_TRADING_MODE_PAPER})
	if err != nil {
		t.Fatalf("GetPnL: %v", err)
	}
	if resp.UnrealizedPnl != 501 {
		t.Errorf("UnrealizedPnl = %v, want 501 (one per position)", resp.UnrealizedPnl)
	}
}

func TestPositionDrain_357_AC1_GetPortfolioCountsAll501(t *testing.T) {
	pool := serviceTestPool(t)
	userID := drainDBUser(t)
	svc := drainDBFixture(t, pool, userID, userID+"-a", 501)

	p, err := svc.GetPortfolio(ctxWithUser(t, userID), &portfoliov1.GetPortfolioRequest{TradingMode: commonv1.TradingMode_TRADING_MODE_PAPER})
	if err != nil {
		t.Fatalf("GetPortfolio: %v", err)
	}
	if len(p.Positions) != 501 {
		t.Errorf("len(Positions) = %d, want 501", len(p.Positions))
	}
	found := false
	for _, pos := range p.Positions {
		if pos.Symbol == "S500" {
			found = true
		}
	}
	if !found {
		t.Error("S500 (the 501st position) missing from Positions")
	}
}

func TestPositionDrain_357_AC3_AccountScopedPast500(t *testing.T) {
	pool := serviceTestPool(t)
	userID := drainDBUser(t)
	acctA, acctB := userID+"-a", userID+"-b"
	svc := drainDBFixture(t, pool, userID, acctA, 501)
	seedDrainPositions(t, repository.NewPortfolioRepoWithDB(pool), userID, acctB, 3)

	p, err := svc.GetPortfolio(ctxWithUser(t, userID), &portfoliov1.GetPortfolioRequest{
		TradingMode: commonv1.TradingMode_TRADING_MODE_PAPER,
		AccountId:   proto.String(acctA),
	})
	if err != nil {
		t.Fatalf("GetPortfolio: %v", err)
	}
	if len(p.Positions) != 501 {
		t.Errorf("len(Positions) = %d, want 501", len(p.Positions))
	}
	for _, pos := range p.Positions {
		if pos.AccountId != acctA {
			t.Errorf("position %s has AccountId %q, want %q", pos.Symbol, pos.AccountId, acctA)
		}
	}
}
