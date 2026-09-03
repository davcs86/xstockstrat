package repository

import (
	"context"
	"fmt"
	"os"
	"strconv"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// defaultMaxConns caps each pool small to stay within DigitalOcean's shared connection
// budget (see root CLAUDE.md). Override with DB_POOL_MAX.
const defaultMaxConns int32 = 2

// newPool opens a pgxpool with MaxConns bounded by DB_POOL_MAX (default 2).
func newPool(ctx context.Context, connStr string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(connStr)
	if err != nil {
		return nil, fmt.Errorf("pgxpool.ParseConfig: %w", err)
	}
	cfg.MaxConns = defaultMaxConns
	if v := os.Getenv("DB_POOL_MAX"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 32); err == nil && n > 0 {
			cfg.MaxConns = int32(n)
		}
	}
	// Under DB_PGBOUNCER (transaction-mode pool) session-scoped prepared statements are unsafe —
	// consecutive queries may land on different backends — so use unnamed statements (QueryExecModeExec).
	if v := os.Getenv("DB_PGBOUNCER"); v == "true" || v == "1" {
		cfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeExec
	}
	return pgxpool.NewWithConfig(ctx, cfg)
}
