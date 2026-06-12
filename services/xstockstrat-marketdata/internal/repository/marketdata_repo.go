package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"google.golang.org/protobuf/types/known/timestamppb"

	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
)

// MarketDataRepo handles TimescaleDB reads and writes for OHLCV bars and quotes.
type MarketDataRepo struct {
	pool *pgxpool.Pool
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
	return &MarketDataRepo{pool: pool}, nil
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
			return nil, "", fmt.Errorf("scan bar: %w", err)
		}
		bars = append(bars, &marketdatav1.Bar{
			Time:       timestamppb.New(t),
			Symbol:     sym,
			Timeframe:  tf,
			Open:       open,
			High:       high,
			Low:        low,
			Close:      close,
			Volume:     volume,
			Vwap:       vwap,
			TradeCount: tradeCount,
			Source:     source,
		})
	}
	if rows.Err() != nil {
		return nil, "", rows.Err()
	}

	nextToken := ""
	if len(bars) > pageSize {
		last := bars[pageSize]
		nextToken = last.Time.AsTime().Format(time.RFC3339Nano)
		bars = bars[:pageSize]
	}
	return bars, nextToken, nil
}

// GetCoverage returns the earliest/latest stored bar timestamps and the bar count for a
// symbol+timeframe within [start, end]. The PRIMARY KEY (symbol, timeframe, time) backs an
// efficient MIN/MAX/COUNT scan. When no rows match, earliest/latest are zero and count is 0.
// timeframe must be the canonical DB string (resolved via internal/timeframe.Resolve).
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

// buildDeleteBarsQuery assembles the scoped DELETE statement and its args. Extracted as a pure
// function (no pool) so the predicate scoping — crucially that the symbol predicate is ALWAYS
// present and is always $1 — is unit-testable without a database (FR-5, DBA gate). timeframe and
// the time bounds are appended only when supplied.
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

// DeleteBars performs a bounded, symbol-scoped delete of OHLCV bars (FR-5). The symbol
// predicate is ALWAYS present — callers must never pass an empty symbol — so this can never
// issue a full-table delete. Returns the number of rows deleted.
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
