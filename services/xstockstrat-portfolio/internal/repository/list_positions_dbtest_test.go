//go:build dbtest

package repository

import (
	"context"
	"reflect"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	portfoliov1 "github.com/xstockstrat/contracts/gen/go/portfolio/v1"
)

// listPositionsRepos builds both pools at the parent level: production binds in Exec mode behind
// PgBouncer (pool.go), where text[] args are text-encoded client-side instead of binary.
func listPositionsRepos(t *testing.T) map[string]*PortfolioRepo {
	t.Helper()
	return map[string]*PortfolioRepo{
		"default": NewPortfolioRepoWithDB(testPool(t)),
		"exec": NewPortfolioRepoWithDB(testPool(t, func(c *pgxpool.Config) {
			c.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeExec
		})),
	}
}

func traverse(t *testing.T, repo *PortfolioRepo, userID string, mode commonv1.TradingMode, pageSize int) ([]*portfoliov1.Position, []int) {
	t.Helper()
	var all []*portfoliov1.Position
	var pageLens []int
	token := ""
	for page := 0; ; page++ {
		if page == 50 {
			t.Fatalf("traversal did not end after 50 pages")
		}
		got, next, err := repo.ListPositions(context.Background(), userID, mode, pageSize, token, "", "", portfoliov1.PositionSide_POSITION_SIDE_UNSPECIFIED)
		if err != nil {
			t.Fatalf("ListPositions page %d: %v", page, err)
		}
		all = append(all, got...)
		pageLens = append(pageLens, len(got))
		if next == "" {
			return all, pageLens
		}
		if next == token {
			t.Fatalf("page %d returned the token it was sent: %q", page, next)
		}
		token = next
	}
}

func qtys(ps []*portfoliov1.Position) []float64 {
	out := make([]float64, len(ps))
	for i, p := range ps {
		out[i] = p.Qty
	}
	return out
}

func TestListPositions_TraversalYieldsEveryRowOnce(t *testing.T) {
	for name, repo := range listPositionsRepos(t) {
		t.Run(name, func(t *testing.T) {
			pool := repo.db.(*pgxpool.Pool)
			user := testUserID(t)
			// qty is the row identity: Position carries no trading_mode.
			for i, r := range [][3]string{
				{"AAPL", "TRADING_MODE_LIVE", "a"},
				{"AAPL", "TRADING_MODE_PAPER", "a"},
				{"AAPL", "TRADING_MODE_PAPER", "b"},
				{"AAPL", "TRADING_MODE_PAPER", "c"},
				{"MSFT", "TRADING_MODE_LIVE", "a"},
				{"MSFT", "TRADING_MODE_PAPER", "a"},
				{"NVDA", "TRADING_MODE_PAPER", "a"},
			} {
				seedPosition(t, pool, user, r[0], r[1], r[2], float64(i+1))
			}
			want := []float64{1, 2, 3, 4, 5, 6, 7}

			got, pageLens := traverse(t, repo, user, commonv1.TradingMode_TRADING_MODE_UNSPECIFIED, 3)
			if !reflect.DeepEqual(qtys(got), want) {
				t.Errorf("page size 3: got qty sequence %v, want %v", qtys(got), want)
			}
			if !reflect.DeepEqual(pageLens, []int{3, 3, 1}) {
				t.Errorf("page size 3: got page lengths %v, want [3 3 1]", pageLens)
			}

			got, pageLens = traverse(t, repo, user, commonv1.TradingMode_TRADING_MODE_UNSPECIFIED, 1)
			if !reflect.DeepEqual(qtys(got), want) {
				t.Errorf("page size 1: got qty sequence %v, want %v", qtys(got), want)
			}
			if len(pageLens) != 7 {
				t.Errorf("page size 1: got %d pages, want 7", len(pageLens))
			}

			got, _ = traverse(t, repo, user, commonv1.TradingMode_TRADING_MODE_PAPER, 1)
			if wantPaper := []float64{2, 3, 4, 6, 7}; !reflect.DeepEqual(qtys(got), wantPaper) {
				t.Errorf("PAPER filter, page size 1: got qty sequence %v, want %v", qtys(got), wantPaper)
			}
		})
	}
}

func TestListPositions_CursorMatchesOracleOrder(t *testing.T) {
	for name, repo := range listPositionsRepos(t) {
		t.Run(name, func(t *testing.T) {
			pool := repo.db.(*pgxpool.Pool)
			user := testUserID(t)
			for i, acct := range []string{"acct_1", "Acct-1", "acct-1", `a,"{}\ b`, "NULL"} {
				seedPosition(t, pool, user, "AAPL", "TRADING_MODE_PAPER", acct, float64(i+1))
			}
			rows, err := pool.Query(context.Background(),
				`SELECT account_id FROM portfolio.positions WHERE user_id=$1 ORDER BY symbol, trading_mode, account_id`, user)
			if err != nil {
				t.Fatalf("oracle query: %v", err)
			}
			want, err := pgx.CollectRows(rows, pgx.RowTo[string])
			if err != nil {
				t.Fatalf("oracle rows: %v", err)
			}
			for _, size := range []int{1, 2} {
				got, _ := traverse(t, repo, user, commonv1.TradingMode_TRADING_MODE_UNSPECIFIED, size)
				accts := make([]string, len(got))
				for i, p := range got {
					accts[i] = p.AccountId
				}
				if !reflect.DeepEqual(accts, want) {
					t.Errorf("page size %d: got account order %q, want oracle %q", size, accts, want)
				}
			}
		})
	}
}
