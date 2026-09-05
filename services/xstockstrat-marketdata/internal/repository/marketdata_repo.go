package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"google.golang.org/protobuf/types/known/timestamppb"

	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
	"github.com/xstockstrat/marketdata/internal/source"
	tfpkg "github.com/xstockstrat/marketdata/internal/timeframe"
)

// execer is the *pgxpool.Pool subset UpsertFundamentals + GetPreviousDailyClose need, extracted
// so their SQL is testable with pgxmock (no live-DB harness in CI). Production wires the real pool.
type execer interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// MarketDataRepo handles TimescaleDB reads and writes for OHLCV bars and quotes.
type MarketDataRepo struct {
	pool *pgxpool.Pool
	// db is the query surface UpsertFundamentals executes against — the real pool in
	// production, a pgxmock in tests.
	db execer
}

// NewMarketDataRepo opens a pgx connection pool.
func NewMarketDataRepo(connStr string) (*MarketDataRepo, error) {
	pool, err := newPool(context.Background(), connStr)
	if err != nil {
		return nil, fmt.Errorf("newPool: %w", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		return nil, fmt.Errorf("db ping: %w", err)
	}
	return &MarketDataRepo{pool: pool, db: pool}, nil
}

// InsertBars bulk-upserts OHLCV bars into the marketdata.ohlcv hypertable.
func (r *MarketDataRepo) InsertBars(ctx context.Context, bars []*marketdatav1.Bar) error {
	if len(bars) == 0 {
		return nil
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	const q = `
		INSERT INTO marketdata.ohlcv (time, symbol, timeframe, open, high, low, close, volume, vwap, trade_count, source)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		ON CONFLICT (symbol, timeframe, time) DO UPDATE
		SET open=EXCLUDED.open, high=EXCLUDED.high, low=EXCLUDED.low, close=EXCLUDED.close,
		    volume=EXCLUDED.volume, vwap=EXCLUDED.vwap, trade_count=EXCLUDED.trade_count`

	for _, b := range bars {
		var ts time.Time
		if b.Time != nil {
			ts = b.Time.AsTime()
		}
		_, err := tx.Exec(ctx, q,
			ts, b.Symbol, b.Timeframe, //nolint:staticcheck // SA1019: canonical string timeframe stored during one-release deprecation window (053)
			b.Open, b.High, b.Low, b.Close,
			b.Volume, b.Vwap, b.TradeCount,
			b.Source,
		)
		if err != nil {
			return fmt.Errorf("insert bar %s: %w", b.Symbol, err)
		}
	}
	return tx.Commit(ctx)
}

// QueryBars returns paginated OHLCV bars for a symbol/timeframe in a time range.
// pageToken is an ISO-8601 timestamp used as a cursor (exclusive).
func (r *MarketDataRepo) QueryBars(ctx context.Context, symbol, timeframe string, start, end time.Time, pageSize int, pageToken string) ([]*marketdatav1.Bar, string, error) {
	if pageSize <= 0 || pageSize > 5000 {
		pageSize = 500
	}
	cursor := start
	if pageToken != "" {
		t, err := time.Parse(time.RFC3339Nano, pageToken)
		if err == nil {
			cursor = t
		}
	}

	const q = `
		SELECT time, symbol, timeframe, open, high, low, close, volume, vwap, trade_count, source
		FROM marketdata.ohlcv
		WHERE symbol=$1 AND timeframe=$2 AND time >= $3 AND time <= $4
		ORDER BY time ASC
		LIMIT $5`

	rows, err := r.pool.Query(ctx, q, symbol, timeframe, cursor, end, pageSize+1)
	if err != nil {
		return nil, "", fmt.Errorf("query bars: %w", err)
	}
	defer rows.Close()

	bars, err := scanBars(rows)
	if err != nil {
		return nil, "", err
	}

	nextToken := ""
	if len(bars) > pageSize {
		last := bars[pageSize]
		nextToken = last.Time.AsTime().Format(time.RFC3339Nano)
		bars = bars[:pageSize]
	}
	return bars, nextToken, nil
}

// scanBars materializes OHLCV rows into Bar protos in query order. Shared by QueryBars and
// QueryRecentBars so the row→proto mapping lives in one place.
func scanBars(rows pgx.Rows) ([]*marketdatav1.Bar, error) {
	var bars []*marketdatav1.Bar
	for rows.Next() {
		var (
			t                      time.Time
			sym, tf                string
			open, high, low, close float64
			volume                 int64
			vwap                   float64
			tradeCount             int32
			source                 string
		)
		if err := rows.Scan(&t, &sym, &tf, &open, &high, &low, &close, &volume, &vwap, &tradeCount, &source); err != nil {
			return nil, fmt.Errorf("scan bar: %w", err)
		}
		bars = append(bars, &marketdatav1.Bar{
			Time:          timestamppb.New(t),
			Symbol:        sym,
			Timeframe:     tf, //nolint:staticcheck // SA1019: deprecated string timeframe written during the one-release deprecation window (053)
			Open:          open,
			High:          high,
			Low:           low,
			Close:         close,
			Volume:        volume,
			Vwap:          vwap,
			TradeCount:    tradeCount,
			Source:        source,
			TimeframeEnum: tfpkg.FromString(tf),
		})
	}
	if rows.Err() != nil {
		return nil, rows.Err()
	}
	return bars, nil
}

// QueryRecentBars returns the most-recent pageSize bars for a symbol/timeframe at or before
// `end`, in ASCENDING time order (what a live chart wants). No pagination token.
func (r *MarketDataRepo) QueryRecentBars(ctx context.Context, symbol, timeframe string, end time.Time, pageSize int) ([]*marketdatav1.Bar, error) {
	if pageSize <= 0 || pageSize > 5000 {
		pageSize = 500
	}
	const q = `
		SELECT time, symbol, timeframe, open, high, low, close, volume, vwap, trade_count, source
		FROM marketdata.ohlcv
		WHERE symbol=$1 AND timeframe=$2 AND time <= $3
		ORDER BY time DESC
		LIMIT $4`
	rows, err := r.pool.Query(ctx, q, symbol, timeframe, end, pageSize)
	if err != nil {
		return nil, fmt.Errorf("query recent bars: %w", err)
	}
	defer rows.Close()
	bars, err := scanBars(rows)
	if err != nil {
		return nil, err
	}
	// Reverse newest-first → oldest-first (ascending) for chart display.
	for i, j := 0, len(bars)-1; i < j; i, j = i+1, j-1 {
		bars[i], bars[j] = bars[j], bars[i]
	}
	return bars, nil
}

// GetPreviousDailyClose returns the prior session's daily close (second-newest 1d bar) for
// change% without a second Alpaca call. ok=false when fewer than two daily bars exist.
func (r *MarketDataRepo) GetPreviousDailyClose(ctx context.Context, symbol string) (close float64, ok bool, err error) {
	const q = `
		SELECT close
		FROM marketdata.ohlcv
		WHERE symbol=$1 AND timeframe='1d'
		ORDER BY time DESC
		OFFSET 1 LIMIT 1`
	row := r.db.QueryRow(ctx, q, symbol)
	if err := row.Scan(&close); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, false, nil
		}
		return 0, false, fmt.Errorf("prev daily close: %w", err)
	}
	return close, true, nil
}

// GetCoverage returns earliest/latest stored timestamps and bar count for a symbol+timeframe
// in [start,end]; zeros when no rows. timeframe must be the canonical DB string.
func (r *MarketDataRepo) GetCoverage(ctx context.Context, symbol, timeframe string, start, end time.Time) (earliest, latest time.Time, barCount int64, err error) {
	const sql = `
		SELECT MIN(time), MAX(time), COUNT(*)
		FROM marketdata.ohlcv
		WHERE symbol=$1 AND timeframe=$2 AND time >= $3 AND time <= $4`
	var minT, maxT *time.Time
	row := r.pool.QueryRow(ctx, sql, symbol, timeframe, start, end)
	if err = row.Scan(&minT, &maxT, &barCount); err != nil {
		return time.Time{}, time.Time{}, 0, err
	}
	if minT != nil {
		earliest = *minT
	}
	if maxT != nil {
		latest = *maxT
	}
	return earliest, latest, barCount, nil
}

// buildDeleteBarsQuery assembles the scoped DELETE. Pure/unit-testable, and the symbol
// predicate is ALWAYS present as $1 so it can never become a full-table delete (FR-5).
func buildDeleteBarsQuery(symbol, timeframe string, start, end time.Time) (string, []any) {
	sql := "DELETE FROM marketdata.ohlcv WHERE symbol=$1"
	args := []any{symbol}
	if timeframe != "" {
		args = append(args, timeframe)
		sql += fmt.Sprintf(" AND timeframe=$%d", len(args))
	}
	if !start.IsZero() {
		args = append(args, start)
		sql += fmt.Sprintf(" AND time >= $%d", len(args))
	}
	if !end.IsZero() {
		args = append(args, end)
		sql += fmt.Sprintf(" AND time <= $%d", len(args))
	}
	return sql, args
}

// DeleteBars performs a bounded, symbol-scoped delete of OHLCV bars — the symbol predicate is
// always present (never an empty symbol) so it can never issue a full-table delete. Returns rows deleted.
func (r *MarketDataRepo) DeleteBars(ctx context.Context, symbol, timeframe string, start, end time.Time) (int64, error) {
	sql, args := buildDeleteBarsQuery(symbol, timeframe, start, end)
	tag, err := r.pool.Exec(ctx, sql, args...)
	if err != nil {
		return 0, fmt.Errorf("delete bars: %w", err)
	}
	return tag.RowsAffected(), nil
}

// InsertQuote upserts a single quote into the marketdata.quotes hypertable.
func (r *MarketDataRepo) InsertQuote(ctx context.Context, q *marketdatav1.Quote) error {
	var ts time.Time
	if q.Time != nil {
		ts = q.Time.AsTime()
	}
	const sql = `
		INSERT INTO marketdata.quotes (time, symbol, ask_price, ask_size, bid_price, bid_size, source)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT (symbol, time) DO UPDATE
		SET ask_price=EXCLUDED.ask_price, ask_size=EXCLUDED.ask_size,
		    bid_price=EXCLUDED.bid_price, bid_size=EXCLUDED.bid_size`
	_, err := r.pool.Exec(ctx, sql, ts, q.Symbol, q.AskPrice, q.AskSize, q.BidPrice, q.BidSize, q.Source)
	return err
}

// GetLatestQuote returns the most recent quote for a symbol.
func (r *MarketDataRepo) GetLatestQuote(ctx context.Context, symbol string) (*marketdatav1.Quote, error) {
	const sql = `
		SELECT time, symbol, ask_price, ask_size, bid_price, bid_size, source
		FROM marketdata.quotes
		WHERE symbol=$1
		ORDER BY time DESC
		LIMIT 1`
	row := r.pool.QueryRow(ctx, sql, symbol)
	var (
		t                  time.Time
		sym                string
		askPrice, bidPrice float64
		askSize, bidSize   int32
		source             string
	)
	if err := row.Scan(&t, &sym, &askPrice, &askSize, &bidPrice, &bidSize, &source); err != nil {
		return nil, fmt.Errorf("get latest quote %s: %w", symbol, err)
	}
	return &marketdatav1.Quote{
		Time:     timestamppb.New(t),
		Symbol:   sym,
		AskPrice: askPrice,
		AskSize:  askSize,
		BidPrice: bidPrice,
		BidSize:  bidSize,
		Source:   source,
	}, nil
}

// GetLatestQuotesBatch returns the most recent quote per requested symbol in one query (feature
// 178). A symbol with no stored quote is absent from the map (null-not-zero) — never a zero Quote.
// DISTINCT ON (symbol) ORDER BY symbol, time DESC rides the existing idx_quotes_symbol_time
// (migration 001:56), so cache hits stay index-shaped — no new migration.
func (r *MarketDataRepo) GetLatestQuotesBatch(ctx context.Context, symbols []string) (map[string]*marketdatav1.Quote, error) {
	out := make(map[string]*marketdatav1.Quote, len(symbols))
	if len(symbols) == 0 {
		return out, nil
	}
	const sql = `
		SELECT DISTINCT ON (symbol) time, symbol, ask_price, ask_size, bid_price, bid_size, source
		FROM marketdata.quotes
		WHERE symbol = ANY($1)
		ORDER BY symbol, time DESC`
	rows, err := r.pool.Query(ctx, sql, symbols)
	if err != nil {
		return nil, fmt.Errorf("get latest quotes batch: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			t                  time.Time
			sym                string
			askPrice, bidPrice float64
			askSize, bidSize   int32
			source             string
		)
		if err := rows.Scan(&t, &sym, &askPrice, &askSize, &bidPrice, &bidSize, &source); err != nil {
			return nil, fmt.Errorf("scan latest quotes batch: %w", err)
		}
		out[sym] = &marketdatav1.Quote{
			Time:     timestamppb.New(t),
			Symbol:   sym,
			AskPrice: askPrice,
			AskSize:  askSize,
			BidPrice: bidPrice,
			BidSize:  bidSize,
			Source:   source,
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate latest quotes batch: %w", err)
	}
	return out, nil
}

// ── Fundamentals cache (feature 059) ─────────────────────────────────────────
// Reuses the existing pgxpool — no second pool (DB budget stays 2).

// fundamentalsColumns is the SELECT/scan column order for a fundamentals row.
const fundamentalsColumns = `symbol, as_of, market_cap, pe_ratio, pb_ratio, dividend_yield, eps, beta, roe, debt_to_equity, price, year_high, year_low, extra_metrics, currency, source, fetched_at`

// GetFundamentals reads one cached fundamentals row by symbol (PK lookup). found=false
// when no row exists. fetchedAt is returned so the service can apply the TTL/quota logic.
func (r *MarketDataRepo) GetFundamentals(ctx context.Context, symbol string) (f *source.Fundamentals, fetchedAt time.Time, found bool, err error) {
	row := r.pool.QueryRow(ctx,
		`SELECT `+fundamentalsColumns+` FROM marketdata.fundamentals WHERE symbol = $1`, symbol)
	var (
		sym, currency, src                                                   string
		asOf, fetched                                                        time.Time
		extraJSON                                                            []byte
		marketCap, pe, pb, divYield, eps, beta, roe, dte, price, yHigh, yLow *float64
	)
	if scanErr := row.Scan(&sym, &asOf, &marketCap, &pe, &pb, &divYield, &eps, &beta, &roe, &dte,
		&price, &yHigh, &yLow, &extraJSON, &currency, &src, &fetched); scanErr != nil {
		if errors.Is(scanErr, pgx.ErrNoRows) {
			return nil, time.Time{}, false, nil
		}
		return nil, time.Time{}, false, fmt.Errorf("get fundamentals %s: %w", symbol, scanErr)
	}
	extra := map[string]float64{}
	if len(extraJSON) > 0 {
		_ = json.Unmarshal(extraJSON, &extra)
	}
	// The scanned locals are already *float64 (NULL-preserving) — pass them through rather than
	// collapsing a real SQL NULL to 0.0 (metric fields are pointers for exactly this reason).
	return &source.Fundamentals{
		Symbol:        sym,
		AsOf:          asOf,
		MarketCap:     marketCap,
		PERatio:       pe,
		PBRatio:       pb,
		DividendYield: divYield,
		EPS:           eps,
		Beta:          beta,
		ROE:           roe,
		DebtToEquity:  dte,
		Price:         price,
		YearHigh:      yHigh,
		YearLow:       yLow,
		ExtraMetrics:  extra,
		Currency:      currency,
		Source:        src,
	}, fetched, true, nil
}

// UpsertFundamentals inserts or refreshes a cached fundamentals row, bumping fetched_at
// to now() so the quota count (CountFundamentalsFetchedToday) and TTL reflect the fetch.
func (r *MarketDataRepo) UpsertFundamentals(ctx context.Context, f *source.Fundamentals) error {
	extraJSON, err := json.Marshal(f.ExtraMetrics)
	if err != nil {
		return fmt.Errorf("marshal extra_metrics: %w", err)
	}
	if len(extraJSON) == 0 {
		extraJSON = []byte("{}")
	}
	// Under QueryExecModeExec (DB_PGBOUNCER) a []byte binds as bytea, and bytea::jsonb hex-garbles
	// to SQLSTATE 22P02 — bind jsonb as string so the ::jsonb cast is a real text→jsonb parse.
	extraJSONText := string(extraJSON)
	src := f.Source
	if src == "" {
		src = "fmp"
	}
	const q = `
		INSERT INTO marketdata.fundamentals
		  (symbol, as_of, market_cap, pe_ratio, pb_ratio, dividend_yield, eps, beta, roe,
		   debt_to_equity, price, year_high, year_low, extra_metrics, currency, source, fetched_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16, now())
		ON CONFLICT (symbol) DO UPDATE SET
		  as_of=EXCLUDED.as_of, market_cap=EXCLUDED.market_cap, pe_ratio=EXCLUDED.pe_ratio,
		  pb_ratio=EXCLUDED.pb_ratio, dividend_yield=EXCLUDED.dividend_yield, eps=EXCLUDED.eps,
		  beta=EXCLUDED.beta, roe=EXCLUDED.roe, debt_to_equity=EXCLUDED.debt_to_equity,
		  price=EXCLUDED.price, year_high=EXCLUDED.year_high, year_low=EXCLUDED.year_low,
		  extra_metrics=EXCLUDED.extra_metrics, currency=EXCLUDED.currency, source=EXCLUDED.source,
		  fetched_at=now()`
	asOf := f.AsOf
	if asOf.IsZero() {
		asOf = time.Now().UTC()
	}
	_, err = r.db.Exec(ctx, q,
		f.Symbol, asOf, f.MarketCap, f.PERatio, f.PBRatio, f.DividendYield, f.EPS, f.Beta, f.ROE,
		f.DebtToEquity, f.Price, f.YearHigh, f.YearLow, extraJSONText, f.Currency, src)
	if err != nil {
		return fmt.Errorf("upsert fundamentals %s: %w", f.Symbol, err)
	}
	return nil
}

// CountFundamentalsFetchedToday counts rows fetched within the current UTC day — the
// FR-4 daily quota window. The idx_fundamentals_fetched_at index backs this scan.
func (r *MarketDataRepo) CountFundamentalsFetchedToday(ctx context.Context) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx,
		`SELECT count(*) FROM marketdata.fundamentals
		 WHERE fetched_at >= date_trunc('day', now() AT TIME ZONE 'UTC')`).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("count fundamentals fetched today: %w", err)
	}
	return n, nil
}

// CountFundamentalsFetchedSince counts rows fetched since `since` — the rolling-window quota
// shape a per-minute-limited provider (Finnhub) needs, vs CountFundamentalsFetchedToday's UTC day.
func (r *MarketDataRepo) CountFundamentalsFetchedSince(ctx context.Context, since time.Time) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx,
		`SELECT count(*) FROM marketdata.fundamentals WHERE fetched_at >= $1`, since).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("count fundamentals fetched since %s: %w", since, err)
	}
	return n, nil
}
