package repository

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"google.golang.org/protobuf/types/known/timestamppb"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	portfoliov1 "github.com/xstockstrat/contracts/gen/go/portfolio/v1"
)

// queryRower is the subset of *pgxpool.Pool the mockable reads/writes need, so they can be
// exercised with pgxmock. Both *pgxpool.Pool and pgxmock/v4 satisfy all three methods.
type queryRower interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// PortfolioRepo handles reads and writes for positions and snapshots.
type PortfolioRepo struct {
	pool *pgxpool.Pool
	// db is the mockable query surface (pool in prod, pgxmock in tests); kept alongside pool so
	// Pool() still returns the concrete *pgxpool.Pool sibling repos reuse.
	db queryRower
}

// NewPortfolioRepo opens a pgx connection pool.
func NewPortfolioRepo(connStr string) (*PortfolioRepo, error) {
	pool, err := newPool(context.Background(), connStr)
	if err != nil {
		return nil, fmt.Errorf("newPool: %w", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		return nil, fmt.Errorf("db ping: %w", err)
	}
	return &PortfolioRepo{pool: pool, db: pool}, nil
}

// Pool exposes the underlying pool so sibling repos (e.g. WatchlistRepo) reuse the single portfolio
// pgxpool instead of opening a second — keeps the connection-pool budget at 2.
func (r *PortfolioRepo) Pool() *pgxpool.Pool {
	return r.pool
}

// UpsertPosition inserts or updates a position row. realizedDelta/feesDelta accumulate into
// realized_accum/fees_accum on conflict — attribution-stats-only, never a user-facing figure.
func (r *PortfolioRepo) UpsertPosition(ctx context.Context, userID, symbol string, qty, avgEntry, costBasis float64, mode commonv1.TradingMode, accountID string, realizedDelta, feesDelta float64) error {
	const q = `
		INSERT INTO portfolio.positions (user_id, symbol, qty, avg_entry_price, cost_basis, trading_mode, account_id, realized_accum, fees_accum, opened_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
		ON CONFLICT (user_id, symbol, trading_mode, account_id) DO UPDATE
		SET qty=$3, avg_entry_price=$4, cost_basis=$5, realized_accum=portfolio.positions.realized_accum + $8, fees_accum=portfolio.positions.fees_accum + $9, updated_at=NOW()`
	_, err := r.pool.Exec(ctx, q, userID, symbol, qty, avgEntry, costBasis, mode.String(), accountID, realizedDelta, feesDelta)
	return err
}

// GetRealizedAccum returns the position's accumulated realized P&L, or 0 when the row does not exist.
func (r *PortfolioRepo) GetRealizedAccum(ctx context.Context, userID, symbol string, mode commonv1.TradingMode, accountID string) (float64, error) {
	q := `SELECT COALESCE(realized_accum, 0) FROM portfolio.positions
	      WHERE user_id=$1 AND symbol=$2 AND trading_mode=$3`
	args := []any{userID, symbol, mode.String()}
	if accountID != "" {
		q += ` AND account_id=$4`
		args = append(args, accountID)
	}
	q += ` ORDER BY opened_at DESC LIMIT 1`
	var accum float64
	err := r.db.QueryRow(ctx, q, args...).Scan(&accum)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	return accum, err
}

// GetFeesAccum returns the position's accumulated broker fees, or 0 when the row does not exist.
func (r *PortfolioRepo) GetFeesAccum(ctx context.Context, userID, symbol string, mode commonv1.TradingMode, accountID string) (float64, error) {
	q := `SELECT COALESCE(fees_accum, 0) FROM portfolio.positions
	      WHERE user_id=$1 AND symbol=$2 AND trading_mode=$3`
	args := []any{userID, symbol, mode.String()}
	if accountID != "" {
		q += ` AND account_id=$4`
		args = append(args, accountID)
	}
	q += ` ORDER BY opened_at DESC LIMIT 1`
	var accum float64
	err := r.db.QueryRow(ctx, q, args...).Scan(&accum)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	return accum, err
}

// ClosePosition removes a position row (qty reached zero). Account-scoped so a multi-account user's
// other-account position for the same (user, symbol, mode) survives.
func (r *PortfolioRepo) ClosePosition(ctx context.Context, userID, symbol string, mode commonv1.TradingMode, accountID string) error {
	const q = `DELETE FROM portfolio.positions WHERE user_id=$1 AND symbol=$2 AND trading_mode=$3 AND account_id=$4`
	_, err := r.pool.Exec(ctx, q, userID, symbol, mode.String(), accountID)
	return err
}

// GetPosition returns a single position for a user/symbol/mode.
func (r *PortfolioRepo) GetPosition(ctx context.Context, userID, symbol string, mode commonv1.TradingMode, accountID string) (*portfoliov1.Position, error) {
	// Scope to a specific account when requested: without it a multi-account user's GetPosition falls
	// through to ORDER BY opened_at DESC LIMIT 1 and returns the wrong account's most-recent position.
	q := `
		SELECT ` + positionColumns + `
		FROM portfolio.positions
		WHERE user_id=$1 AND symbol=$2 AND trading_mode=$3`
	args := []any{userID, symbol, mode.String()}
	if accountID != "" {
		q += ` AND account_id=$4`
		args = append(args, accountID)
	}
	// LIMIT 1 tie-breaks a stale duplicate within the (now account-narrowed) candidate set.
	q += ` ORDER BY opened_at DESC LIMIT 1`
	row := r.db.QueryRow(ctx, q, args...)
	return scanPositionRow(row)
}

// ListPositions returns paginated positions for a user, optionally filtered by mode and accountID.
func (r *PortfolioRepo) ListPositions(ctx context.Context, userID string, mode commonv1.TradingMode, pageSize int, pageToken string, accountID string, symbolFilter string, side portfoliov1.PositionSide) ([]*portfoliov1.Position, string, error) {
	if pageSize <= 0 || pageSize > 500 {
		pageSize = 100
	}

	conds := []string{"user_id = $1"}
	args := []any{userID}
	add := func(condFmt string, val any) {
		args = append(args, val)
		conds = append(conds, fmt.Sprintf(condFmt, len(args)))
	}
	if mode != commonv1.TradingMode_TRADING_MODE_UNSPECIFIED {
		add("trading_mode = $%d", mode.String())
	}
	if accountID != "" {
		add("account_id = $%d", accountID)
	}
	if symbolFilter != "" {
		add("symbol = $%d", symbolFilter)
	}
	switch side {
	case portfoliov1.PositionSide_POSITION_SIDE_LONG:
		conds = append(conds, "qty > 0")
	case portfoliov1.PositionSide_POSITION_SIDE_SHORT:
		conds = append(conds, "qty < 0")
	}
	args = append(args, pageToken)
	conds = append(conds, fmt.Sprintf("($%d = '' OR symbol > $%d)", len(args), len(args)))
	args = append(args, pageSize+1)
	limitIdx := len(args)

	// Select broker valuation columns (via positionColumns) so broker-valued positions return
	// authoritative figures; the service only re-enriches from marketdata when current_price <= 0.
	q := fmt.Sprintf(`
		SELECT `+positionColumns+`
		FROM portfolio.positions
		WHERE %s
		ORDER BY symbol ASC LIMIT $%d`, strings.Join(conds, " AND "), limitIdx)

	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, "", fmt.Errorf("list positions: %w", err)
	}
	defer rows.Close()

	var positions []*portfoliov1.Position
	for rows.Next() {
		p, err := scanPositionRow(rows)
		if err != nil {
			return nil, "", err
		}
		positions = append(positions, p)
	}
	if rows.Err() != nil {
		return nil, "", rows.Err()
	}

	nextToken := ""
	if len(positions) > pageSize {
		nextToken = positions[pageSize].Symbol
		positions = positions[:pageSize]
	}
	return positions, nextToken, nil
}

// InsertSnapshot writes a portfolio snapshot to the hypertable.
func (r *PortfolioRepo) InsertSnapshot(ctx context.Context, portfolioID, userID string, equity, cash, dayPnL float64, openPositions int, mode commonv1.TradingMode) error {
	const q = `
		INSERT INTO portfolio.snapshots (snapshot_time, portfolio_id, user_id, equity, cash, buying_power, day_pnl, open_positions, trading_mode)
		VALUES (NOW(), $1, $2, $3, $4, $4, $5, $6, $7)
		ON CONFLICT (portfolio_id, snapshot_time) DO NOTHING`
	_, err := r.pool.Exec(ctx, q, portfolioID, userID, equity, cash, dayPnL, openPositions, mode.String())
	return err
}

// GetSnapshot returns the snapshot closest to atTime for a portfolio.
func (r *PortfolioRepo) GetSnapshot(ctx context.Context, portfolioID string, atTime time.Time) (*portfoliov1.PortfolioSnapshot, error) {
	const q = `
		SELECT portfolio_id, snapshot_time, equity, cash, day_pnl, open_positions
		FROM portfolio.snapshots
		WHERE portfolio_id=$1 AND snapshot_time <= $2
		ORDER BY snapshot_time DESC LIMIT 1`
	row := r.pool.QueryRow(ctx, q, portfolioID, atTime)
	var (
		pid                  string
		snapTime             time.Time
		equity, cash, dayPnL float64
		openPos              int32
	)
	if err := row.Scan(&pid, &snapTime, &equity, &cash, &dayPnL, &openPos); err != nil {
		return nil, fmt.Errorf("get snapshot: %w", err)
	}
	return &portfoliov1.PortfolioSnapshot{
		PortfolioId:   pid,
		SnapshotTime:  timestamppb.New(snapTime),
		Equity:        equity,
		Cash:          cash,
		DayPnl:        dayPnL,
		OpenPositions: openPos,
	}, nil
}

// CountPositions returns how many open positions a user has for a given mode.
func (r *PortfolioRepo) CountPositions(ctx context.Context, userID string, mode commonv1.TradingMode) (int, error) {
	const q = `SELECT COUNT(*) FROM portfolio.positions WHERE user_id=$1 AND trading_mode=$2`
	var count int
	err := r.pool.QueryRow(ctx, q, userID, mode.String()).Scan(&count)
	return count, err
}

// ErrPositionNotFound is returned when a position row does not exist — lets the handler distinguish
// "no position" (NotFound) from a backend failure (Internal).
var ErrPositionNotFound = errors.New("position not found")

type pgxRow interface {
	Scan(dest ...any) error
}

func scanPositionRow(row pgxRow) (*portfoliov1.Position, error) {
	var (
		symbol, modeStr, accountID                                 string
		qty, avgEntry, costBasis                                   float64
		currentPrice, marketValue, unrealizedPnl, unrealizedPnlPct float64
		dayPnl, dayPnlPct                                          float64
		stopOrderID, takeProfitOrderID                             string
		openedAt                                                   time.Time
		source                                                     int
		asOf                                                       *time.Time
	)
	if err := row.Scan(&symbol, &qty, &avgEntry, &costBasis, &openedAt, &modeStr, &accountID,
		&currentPrice, &marketValue, &unrealizedPnl, &unrealizedPnlPct, &dayPnl, &dayPnlPct,
		&stopOrderID, &takeProfitOrderID, &source, &asOf); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrPositionNotFound
		}
		return nil, fmt.Errorf("scan position: %w", err)
	}
	pos := &portfoliov1.Position{
		Symbol:            symbol,
		Qty:               qty,
		AvgEntryPrice:     avgEntry,
		CostBasis:         costBasis,
		OpenedAt:          timestamppb.New(openedAt),
		AccountId:         accountID,
		CurrentPrice:      currentPrice,
		MarketValue:       marketValue,
		UnrealizedPnl:     unrealizedPnl,
		UnrealizedPnlPct:  unrealizedPnlPct,
		DayPnl:            dayPnl,
		DayPnlPct:         dayPnlPct,
		StopOrderId:       stopOrderID,
		TakeProfitOrderId: takeProfitOrderID,
		Source:            portfoliov1.PositionSource(source),
	}
	if asOf != nil {
		pos.AsOf = timestamppb.New(*asOf)
	}
	return pos, nil
}

// positionColumns is the SELECT list backing scanPositionRow — column order MUST stay in lockstep
// with the Scan call. Nullable bracket IDs are COALESCE'd to "" ("empty = no active bracket").
const positionColumns = `symbol, qty, avg_entry_price, cost_basis, opened_at, trading_mode, account_id, current_price, market_value, unrealized_pnl, unrealized_pnl_pct, day_pnl, day_pnl_pct, COALESCE(stop_order_id, ''), COALESCE(take_profit_order_id, ''), source, as_of`

// PositionValuation is the broker's mark-to-market snapshot for a position (from
// account.positions.synced). Zero fields = not reported; the service then falls back to marketdata.
type PositionValuation struct {
	CurrentPrice     float64
	MarketValue      float64
	UnrealizedPnl    float64
	UnrealizedPnlPct float64
	// DayPnl / DayPnlPct are the broker's intraday (today's) P&L — change since the
	// previous close. Distinct from UnrealizedPnl (total since entry); zero = not reported.
	DayPnl    float64
	DayPnlPct float64
	// Source is the PositionSource enum integer: 0=UNSPECIFIED, 1=ORDERS, 2=BASELINE, 3=MIXED.
	// Legacy events default to 0.
	Source int
	// AsOf is the baseline snapshot effective date (RFC3339 or empty). Empty/zero = unset.
	AsOf string
}

// UpsertPositionFromSync upserts a position from a broker sync. Unlike UpsertPosition, opened_at is
// never overwritten on conflict; cost_basis is total (qty × avg_cost) to match the per-fill P&L math.
func (r *PortfolioRepo) UpsertPositionFromSync(ctx context.Context, userID, symbol, tradingMode, accountID string, qty, avgCost float64, val PositionValuation) error {
	costBasis := qty * avgCost
	var asOf *time.Time
	if val.AsOf != "" {
		if t, err := time.Parse(time.RFC3339Nano, val.AsOf); err == nil {
			asOf = &t
		}
	}
	const q = `
		INSERT INTO portfolio.positions (user_id, symbol, qty, avg_entry_price, cost_basis, trading_mode, account_id, current_price, market_value, unrealized_pnl, unrealized_pnl_pct, day_pnl, day_pnl_pct, source, as_of, opened_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW())
		ON CONFLICT (user_id, symbol, trading_mode, account_id) DO UPDATE
		SET qty=$3, avg_entry_price=$4, cost_basis=$5, current_price=$8, market_value=$9, unrealized_pnl=$10, unrealized_pnl_pct=$11, day_pnl=$12, day_pnl_pct=$13, source=$14, as_of=$15, updated_at=NOW()`
	_, err := r.pool.Exec(ctx, q, userID, symbol, qty, avgCost, costBasis, tradingMode, accountID,
		val.CurrentPrice, val.MarketValue, val.UnrealizedPnl, val.UnrealizedPnlPct, val.DayPnl, val.DayPnlPct,
		val.Source, asOf)
	return err
}

// UpdatePositionBracket sets or clears a position's bracket leg order IDs. Empty ID = "cleared":
// NULLIF maps it to NULL so scanPositionRow's COALESCE round-trips back to "".
func (r *PortfolioRepo) UpdatePositionBracket(ctx context.Context, userID, symbol, tradingMode, accountID, stopOrderID, takeProfitOrderID string) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE portfolio.positions
		SET stop_order_id = NULLIF($5, ''), take_profit_order_id = NULLIF($6, '')
		WHERE user_id = $1 AND symbol = $2 AND trading_mode = $3 AND account_id = $4
	`, userID, symbol, tradingMode, accountID, stopOrderID, takeProfitOrderID)
	return err
}

// DeletePositionsNotInSync reconciles an account to a broker snapshot: deletes account rows not in
// (userID, present-symbols), including stale rows under another user_id. Empty presentSymbols = delete all.
func (r *PortfolioRepo) DeletePositionsNotInSync(ctx context.Context, accountID, userID string, presentSymbols []string) error {
	if len(presentSymbols) == 0 {
		const q = `DELETE FROM portfolio.positions WHERE account_id=$1`
		_, err := r.pool.Exec(ctx, q, accountID)
		return err
	}
	args := make([]interface{}, 0, len(presentSymbols)+2)
	args = append(args, accountID, userID)
	placeholders := make([]string, len(presentSymbols))
	for i, s := range presentSymbols {
		args = append(args, s)
		placeholders[i] = fmt.Sprintf("$%d", i+3)
	}
	q := fmt.Sprintf(`DELETE FROM portfolio.positions WHERE account_id=$1 AND (user_id <> $2 OR symbol NOT IN (%s))`,
		joinStrings(placeholders, ","))
	_, err := r.pool.Exec(ctx, q, args...)
	return err
}

func joinStrings(ss []string, sep string) string {
	result := ""
	for i, s := range ss {
		if i > 0 {
			result += sep
		}
		result += s
	}
	return result
}

// AccountBalance is the latest broker-reported balance snapshot for an account.
type AccountBalance struct {
	Cash        float64
	BuyingPower float64
	Equity      float64
	LastEquity  float64
}

// UpsertAccountBalance inserts or updates the latest balance snapshot for an account.
func (r *PortfolioRepo) UpsertAccountBalance(ctx context.Context, accountID, userID, tradingMode string, cash, buyingPower, equity, lastEquity float64) error {
	const q = `
		INSERT INTO portfolio.account_balances (account_id, user_id, trading_mode, cash, buying_power, equity, last_equity, peak_equity, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $6, NOW())
		ON CONFLICT (account_id) DO UPDATE
		SET user_id=$2, trading_mode=$3, cash=$4, buying_power=$5, equity=$6, last_equity=$7,
			peak_equity = GREATEST(portfolio.account_balances.peak_equity, EXCLUDED.equity),
			updated_at=NOW()`
	_, err := r.db.Exec(ctx, q, accountID, userID, tradingMode, cash, buyingPower, equity, lastEquity)
	return err
}

// AccountDrawdown is one account's current equity against its persisted high-water-mark, used by
// the per-account drawdown risk check (feature 172).
type AccountDrawdown struct {
	AccountID  string
	Equity     float64
	PeakEquity float64
}

// GetAccountDrawdowns returns current-vs-peak equity for every account a user holds in the given
// trading mode, so the risk path can flag per-account drawdown breaches.
func (r *PortfolioRepo) GetAccountDrawdowns(ctx context.Context, userID, tradingMode string) ([]AccountDrawdown, error) {
	const q = `
		SELECT account_id, equity, peak_equity
		FROM portfolio.account_balances
		WHERE user_id=$1 AND trading_mode=$2`
	rows, err := r.db.Query(ctx, q, userID, tradingMode)
	if err != nil {
		return nil, fmt.Errorf("get account drawdowns: %w", err)
	}
	defer rows.Close()

	var result []AccountDrawdown
	for rows.Next() {
		var d AccountDrawdown
		if err := rows.Scan(&d.AccountID, &d.Equity, &d.PeakEquity); err != nil {
			return nil, fmt.Errorf("scan account drawdown: %w", err)
		}
		result = append(result, d)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("account drawdown rows: %w", err)
	}
	return result, nil
}

// GetAccountBalance returns the latest balance snapshot for an account, or
// (nil, nil) when no balance has been synced yet.
func (r *PortfolioRepo) GetAccountBalance(ctx context.Context, accountID string) (*AccountBalance, error) {
	const q = `
		SELECT cash, buying_power, equity, last_equity
		FROM portfolio.account_balances
		WHERE account_id=$1`
	var b AccountBalance
	err := r.pool.QueryRow(ctx, q, accountID).Scan(&b.Cash, &b.BuyingPower, &b.Equity, &b.LastEquity)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("get account balance: %w", err)
	}
	return &b, nil
}

// UpsertOfflineRealized records an offline account's cumulative realized P&L. account_id is the PK,
// so it survives the position-row wipe on a full close.
func (r *PortfolioRepo) UpsertOfflineRealized(ctx context.Context, accountID, userID, tradingMode string, realizedPnl float64) error {
	const q = `
		INSERT INTO portfolio.offline_account_realized (account_id, user_id, trading_mode, realized_pnl, updated_at)
		VALUES ($1, $2, $3, $4, NOW())
		ON CONFLICT (account_id) DO UPDATE
		SET user_id=$2, trading_mode=$3, realized_pnl=$4, updated_at=NOW()`
	_, err := r.pool.Exec(ctx, q, accountID, userID, tradingMode, realizedPnl)
	return err
}

// GetOfflineRealized returns an offline account's realized P&L. The bool is false (not an error)
// when no row exists — a broker account, or an offline account with no confirmed orders yet.
func (r *PortfolioRepo) GetOfflineRealized(ctx context.Context, accountID string) (float64, bool, error) {
	if accountID == "" {
		return 0, false, nil
	}
	const q = `SELECT realized_pnl FROM portfolio.offline_account_realized WHERE account_id=$1`
	var v float64
	err := r.db.QueryRow(ctx, q, accountID).Scan(&v)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, false, nil
		}
		return 0, false, fmt.Errorf("get offline realized: %w", err)
	}
	return v, true, nil
}

// DeleteOfflineRealized removes an offline account's realized row.
func (r *PortfolioRepo) DeleteOfflineRealized(ctx context.Context, accountID string) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM portfolio.offline_account_realized WHERE account_id=$1`, accountID)
	return err
}

// UserAccountBalance pairs an account_id with its latest balance snapshot.
type UserAccountBalance struct {
	AccountID string
	Balance   AccountBalance
}

// ListAccountBalancesByUser returns the latest balance snapshot for every account a user owns,
// ordered by account_id (backs the "all accounts" portfolio view).
func (r *PortfolioRepo) ListAccountBalancesByUser(ctx context.Context, userID string) ([]UserAccountBalance, error) {
	const q = `
		SELECT account_id, cash, buying_power, equity, last_equity
		FROM portfolio.account_balances
		WHERE user_id=$1
		ORDER BY account_id ASC`
	rows, err := r.pool.Query(ctx, q, userID)
	if err != nil {
		return nil, fmt.Errorf("list account balances by user: %w", err)
	}
	defer rows.Close()

	var result []UserAccountBalance
	for rows.Next() {
		var ab UserAccountBalance
		if err := rows.Scan(&ab.AccountID, &ab.Balance.Cash, &ab.Balance.BuyingPower, &ab.Balance.Equity, &ab.Balance.LastEquity); err != nil {
			return nil, fmt.Errorf("scan account balance: %w", err)
		}
		result = append(result, ab)
	}
	return result, rows.Err()
}

// ListOfflineAccountIdsByUser returns a user's offline account IDs — those with an
// offline_account_realized row, the offline-exclusive marker (broker accounts never get one).
func (r *PortfolioRepo) ListOfflineAccountIdsByUser(ctx context.Context, userID string) ([]string, error) {
	const q = `SELECT account_id FROM portfolio.offline_account_realized WHERE user_id=$1 ORDER BY account_id ASC`
	rows, err := r.pool.Query(ctx, q, userID)
	if err != nil {
		return nil, fmt.Errorf("list offline account ids by user: %w", err)
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan offline account id: %w", err)
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// ListPositionsByAccount returns all positions for a given account, optionally filtered by tradingMode.
func (r *PortfolioRepo) ListPositionsByAccount(ctx context.Context, accountID string, tradingMode string) ([]*portfoliov1.Position, error) {
	var (
		rows interface {
			Next() bool
			Scan(dest ...any) error
			Close()
			Err() error
		}
		err error
	)
	if tradingMode == "" {
		q := `
			SELECT ` + positionColumns + `
			FROM portfolio.positions
			WHERE account_id=$1
			ORDER BY symbol ASC`
		rows, err = r.pool.Query(ctx, q, accountID)
	} else {
		q := `
			SELECT ` + positionColumns + `
			FROM portfolio.positions
			WHERE account_id=$1 AND trading_mode=$2
			ORDER BY symbol ASC`
		rows, err = r.pool.Query(ctx, q, accountID, tradingMode)
	}
	if err != nil {
		return nil, fmt.Errorf("list positions by account: %w", err)
	}
	defer rows.Close()

	var positions []*portfoliov1.Position
	for rows.Next() {
		p, err := scanPositionRow(rows)
		if err != nil {
			return nil, err
		}
		positions = append(positions, p)
	}
	return positions, rows.Err()
}
