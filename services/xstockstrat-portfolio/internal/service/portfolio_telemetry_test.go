package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/pashagolub/pgxmock/v4"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric/noop"
	"go.opentelemetry.io/otel/propagation"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	ledgerv1 "github.com/xstockstrat/contracts/gen/go/ledger/v1"
	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
	portfoliov1 "github.com/xstockstrat/contracts/gen/go/portfolio/v1"
	"github.com/xstockstrat/portfolio/internal/config"
	"github.com/xstockstrat/portfolio/internal/repository"
	"github.com/xstockstrat/portfolio/internal/telemetry"
	"github.com/xstockstrat/portfolio/internal/testdata"
)

// No t.Parallel(): every test below swaps the process-global MeterProvider and slog default.

func installMetricReader(t *testing.T) *sdkmetric.ManualReader {
	t.Helper()
	prev := otel.GetMeterProvider()
	reader := sdkmetric.NewManualReader()
	mp := sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader))
	otel.SetMeterProvider(mp)
	t.Cleanup(func() {
		otel.SetMeterProvider(prev)
		_ = mp.Shutdown(context.Background())
	})
	return reader
}

func collect(t *testing.T, reader *sdkmetric.ManualReader) metricdata.ResourceMetrics {
	t.Helper()
	var rm metricdata.ResourceMetrics
	if err := reader.Collect(context.Background(), &rm); err != nil {
		t.Fatalf("collect: %v", err)
	}
	return rm
}

func int64Points(t *testing.T, reader *sdkmetric.ManualReader) map[string][]metricdata.DataPoint[int64] {
	t.Helper()
	out := map[string][]metricdata.DataPoint[int64]{}
	for _, sm := range collect(t, reader).ScopeMetrics {
		for _, m := range sm.Metrics {
			if sum, ok := m.Data.(metricdata.Sum[int64]); ok {
				out[m.Name] = append(out[m.Name], sum.DataPoints...)
			}
		}
	}
	return out
}

// counterValue sums name's points whose attribute set holds every kv.
func counterValue(t *testing.T, reader *sdkmetric.ManualReader, name string, kv ...attribute.KeyValue) int64 {
	t.Helper()
	var total int64
	for _, dp := range int64Points(t, reader)[name] {
		match := true
		for _, want := range kv {
			if got, ok := dp.Attributes.Value(want.Key); !ok || got != want.Value {
				match = false
				break
			}
		}
		if match {
			total += dp.Value
		}
	}
	return total
}

func attr(k, v string) attribute.KeyValue { return attribute.String(k, v) }

func consumerEvents(t *testing.T, reader *sdkmetric.ManualReader, consumer, outcome string) int64 {
	t.Helper()
	return counterValue(t, reader, "portfolio.consumer.events", attr(telemetry.KeyConsumer, consumer), attr(telemetry.KeyOutcome, outcome))
}

func markSources(t *testing.T, reader *sdkmetric.ManualReader, source, path string) int64 {
	t.Helper()
	return counterValue(t, reader, "portfolio.mark_source", attr(telemetry.KeyMarkSource, source), attr(telemetry.KeyPath, path))
}

// logRecorder keeps every record at every level, plus the trace_id of the record's context.
type logRecorder struct {
	mu   sync.Mutex
	recs []map[string]string
}

func (h *logRecorder) Enabled(context.Context, slog.Level) bool { return true }
func (h *logRecorder) Handle(ctx context.Context, r slog.Record) error {
	rec := map[string]string{"msg": r.Message, "level": r.Level.String()}
	r.Attrs(func(a slog.Attr) bool { rec[a.Key] = fmt.Sprint(a.Value.Resolve().Any()); return true })
	carrier := propagation.MapCarrier{}
	propagation.TraceContext{}.Inject(ctx, carrier)
	if parts := strings.Split(carrier.Get("traceparent"), "-"); len(parts) == 4 {
		rec["trace_id"] = parts[1]
	}
	h.mu.Lock()
	h.recs = append(h.recs, rec)
	h.mu.Unlock()
	return nil
}
func (h *logRecorder) WithAttrs([]slog.Attr) slog.Handler { return h }
func (h *logRecorder) WithGroup(string) slog.Handler      { return h }

func (h *logRecorder) with(msg string) []map[string]string {
	h.mu.Lock()
	defer h.mu.Unlock()
	var out []map[string]string
	for _, r := range h.recs {
		if r["msg"] == msg {
			out = append(out, r)
		}
	}
	return out
}

func (h *logRecorder) atLevel(lvl slog.Level) []map[string]string {
	h.mu.Lock()
	defer h.mu.Unlock()
	var out []map[string]string
	for _, r := range h.recs {
		if r["level"] == lvl.String() {
			out = append(out, r)
		}
	}
	return out
}

func recordLogs(t *testing.T) *logRecorder {
	t.Helper()
	h := &logRecorder{}
	prev := slog.Default()
	slog.SetDefault(slog.New(h))
	t.Cleanup(func() { slog.SetDefault(prev) })
	return h
}

// @AC-8: a deterministic position-sync failure counts 4 errors then 1 park, and no ok.
func TestBoundedRetry_AC8_ErrorThenParkedCounted(t *testing.T) {
	reader := installMetricReader(t)
	rec := recordLogs(t)
	svc := &PortfolioService{now: fakeClock(2 * time.Second)}
	h := svc.boundedRetry("position sync", func(context.Context, *ledgerv1.LedgerEvent) error {
		return &pgconn.PgError{Code: "23505"}
	})
	ev := &ledgerv1.LedgerEvent{EventId: "evt-9", Sequence: 9, StreamKey: "off-9"}

	for i := 1; i <= 5; i++ {
		_ = h(context.Background(), ev)
	}

	if got := consumerEvents(t, reader, "position_sync", "error"); got != 4 {
		t.Errorf("consumer.events{position_sync,error} = %d, want 4", got)
	}
	if got := consumerEvents(t, reader, "position_sync", "parked"); got != 1 {
		t.Errorf("consumer.events{position_sync,parked} = %d, want 1", got)
	}
	if got := counterValue(t, reader, "portfolio.consumer.events", attr(telemetry.KeyOutcome, "ok")); got != 0 {
		t.Errorf("consumer.events{ok} = %d, want unchanged (0)", got)
	}
	parked := rec.with("event parked")
	if len(parked) != 1 || parked[0]["level"] != slog.LevelError.String() || parked[0]["event_id"] != "evt-9" {
		t.Fatalf("\"event parked\" records = %v, want one ERROR naming evt-9", parked)
	}
}

func quoteGetPortfolioSvc(t *testing.T, stub *stubMarketData, timeoutMs int64, rows func(pgxmock.PgxPoolIface) *pgxmock.Rows) (*PortfolioService, pgxmock.PgxPoolIface) {
	t.Helper()
	svc, mock, _ := newQuoteSvc(t, stub, timeoutMs)
	mock.ExpectQuery(`FROM portfolio.positions`).WithArgs(anyArgs(3)...).WillReturnRows(rows(mock))
	mock.ExpectQuery(`FROM portfolio.account_balances`).WithArgs("u-1").
		WillReturnRows(mock.NewRows([]string{"account_id", "cash", "buying_power", "equity", "last_equity"}).AddRow("acc-1", 1000.0, 1000.0, 1000.0, 1000.0))
	mock.ExpectQuery(`SELECT account_id FROM portfolio.offline_account_realized`).WithArgs("u-1").
		WillReturnRows(mock.NewRows([]string{"account_id"}))
	return svc, mock
}

// @AC-9: a quote fetch that runs into its deadline counts timeout on the read and the snapshot path.
func TestQuoteTimeout_AC9_FetchSnapshotAndMarkSourceCounted(t *testing.T) {
	reader := installMetricReader(t)
	rec := recordLogs(t)
	twoUnpriced := func(m pgxmock.PgxPoolIface) *pgxmock.Rows {
		return posRow(posRow(m.NewRows(positionCols), "AAPL", "acc-1", 1, 100, 0), "MSFT", "acc-1", 1, 200, 0)
	}
	svc, mock := quoteGetPortfolioSvc(t, &stubMarketData{block: true}, 50, twoUnpriced)
	mock.ExpectQuery(`FROM portfolio.positions`).WithArgs(anyArgs(4)...).WillReturnRows(twoUnpriced(mock))
	ctx := ctxWithUser(t, "u-1")

	var err error
	guard(t, func() { _, err = svc.GetPortfolio(ctx, &portfoliov1.GetPortfolioRequest{}) })
	if err != nil {
		t.Fatalf("GetPortfolio: %v, want OK", err)
	}
	guard(t, func() { svc.broadcastSnapshot(ctx, "u-1", commonv1.TradingMode_TRADING_MODE_PAPER) })

	if got := counterValue(t, reader, "portfolio.marketdata_fetch", attr(telemetry.KeyOp, "quotes"), attr(telemetry.KeyOutcome, "timeout")); got != 2 {
		t.Errorf("marketdata_fetch{quotes,timeout} = %d, want 2", got)
	}
	if got := counterValue(t, reader, "portfolio.marketdata_fetch", attr(telemetry.KeyOutcome, "error")); got != 0 {
		t.Errorf("marketdata_fetch{error} = %d, want 0 (a deadline is a timeout)", got)
	}
	if got := counterValue(t, reader, "portfolio.snapshot", attr(telemetry.KeyOutcome, "skipped_unpriced")); got != 1 {
		t.Errorf("snapshot{skipped_unpriced} = %d, want 1", got)
	}
	if got := markSources(t, reader, "none", "read"); got != 2 {
		t.Errorf("mark_source{none,read} = %d, want 2", got)
	}
	if got := markSources(t, reader, "none", "snapshot"); got != 2 {
		t.Errorf("mark_source{none,snapshot} = %d, want 2", got)
	}
	if got := rec.with("latest quote has no usable price"); len(got) != 0 {
		t.Errorf("unusable-quote records = %v, want none (no quote was present)", got)
	}
}

// @AC-10: a failed snapshot insert is logged and counted, and the emit and broadcast still run.
func TestBroadcastSnapshot_AC10_InsertFailureLoggedNotDropped(t *testing.T) {
	reader := installMetricReader(t)
	rec := recordLogs(t)
	svc, mock, ledger := newQuoteSvc(t, &stubMarketData{quotes: []*marketdatav1.Quote{quote("AAPL", 150)}}, 0)
	ch := svc.Subscribe("t", "u-1")
	mock.ExpectQuery(`FROM portfolio.positions`).WithArgs(anyArgs(4)...).
		WillReturnRows(posRow(mock.NewRows(positionCols), "AAPL", "acc-1", 1, 100, 0))
	mock.ExpectExec(`INSERT INTO portfolio.snapshots`).WithArgs(anyArgs(7)...).WillReturnError(errors.New("disk full"))

	svc.broadcastSnapshot(ctxWithUser(t, "u-1"), "u-1", commonv1.TradingMode_TRADING_MODE_PAPER)

	if got := counterValue(t, reader, "portfolio.snapshot", attr(telemetry.KeyOutcome, "db_error")); got != 1 {
		t.Errorf("snapshot{db_error} = %d, want 1", got)
	}
	if got := counterValue(t, reader, "portfolio.snapshot", attr(telemetry.KeyOutcome, "written")); got != 0 {
		t.Errorf("snapshot{written} = %d, want 0", got)
	}
	failed := rec.with("portfolio snapshot insert failed")
	if len(failed) != 1 || failed[0]["level"] != slog.LevelError.String() || !strings.Contains(failed[0]["error"], "disk full") {
		t.Fatalf("insert-failed records = %v, want one ERROR containing \"disk full\"", failed)
	}
	if len(ledger.reqs) != 1 || ledger.reqs[0].EventType != "portfolio.snapshot" {
		t.Fatalf("ledger emits = %d, want one portfolio.snapshot", len(ledger.reqs))
	}
	if len(ch) != 1 {
		t.Fatalf("subscriber got %d snapshots, want 1", len(ch))
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("pgxmock: %v", err)
	}
}

// @AC-11: 12 present-but-unusable quotes among 40 write one aggregate WARN carrying the span's trace_id.
func TestGetPortfolio_AC11_OneAggregateUnusableQuoteLine(t *testing.T) {
	reader := installMetricReader(t)
	rec := recordLogs(t)
	var quotes []*marketdatav1.Quote
	syms := make([]string, 40)
	for i := range syms {
		syms[i] = fmt.Sprintf("S%02d", i)
		if i < 12 {
			quotes = append(quotes, &marketdatav1.Quote{Symbol: syms[i], AskPrice: 10})
		} else {
			quotes = append(quotes, quote(syms[i], 10))
		}
	}
	forty := func(m pgxmock.PgxPoolIface) *pgxmock.Rows {
		rows := m.NewRows(positionCols)
		for _, s := range syms {
			posRow(rows, s, "acc-1", 1, 10, 0)
		}
		return rows
	}
	svc, _ := quoteGetPortfolioSvc(t, &stubMarketData{quotes: quotes}, 0, forty)
	tp := sdktrace.NewTracerProvider()
	t.Cleanup(func() { _ = tp.Shutdown(context.Background()) })
	ctx, span := tp.Tracer("t").Start(ctxWithUser(t, "u-1"), "GetPortfolio")
	defer span.End()

	if _, err := svc.GetPortfolio(ctx, &portfoliov1.GetPortfolioRequest{}); err != nil {
		t.Fatalf("GetPortfolio: %v", err)
	}

	lines := rec.with("latest quote has no usable price")
	if len(lines) != 1 {
		t.Fatalf("unusable-quote records = %v, want exactly one", lines)
	}
	if got, want := lines[0]["trace_id"], span.SpanContext().TraceID().String(); got != want {
		t.Errorf("trace_id = %q, want %q", got, want)
	}
	if lines[0]["count"] != "12" || lines[0]["level"] != slog.LevelWarn.String() {
		t.Errorf("record = %v, want WARN with count 12", lines[0])
	}
	if got := markSources(t, reader, "none", "read"); got != 12 {
		t.Errorf("mark_source{none,read} = %d, want 12", got)
	}
	if got := markSources(t, reader, "quote", "read"); got != 28 {
		t.Errorf("mark_source{quote,read} = %d, want 28", got)
	}
}

// scriptedStreamLedger answers each StreamEvents call from script, records each FromSequence, and
// cancels the consumer once the script is exhausted so consumeEventStream returns.
type scriptedStreamLedger struct {
	ledgerv1.LedgerServiceClient
	mu       sync.Mutex
	script   []func() (grpc.ServerStreamingClient[ledgerv1.LedgerEvent], error)
	cancel   context.CancelFunc
	fromSeqs []int64
	appended []string
}

func (l *scriptedStreamLedger) StreamEvents(_ context.Context, req *ledgerv1.StreamEventsRequest, _ ...grpc.CallOption) (grpc.ServerStreamingClient[ledgerv1.LedgerEvent], error) {
	l.mu.Lock()
	l.fromSeqs = append(l.fromSeqs, req.FromSequence)
	i := len(l.fromSeqs) - 1
	l.mu.Unlock()
	if i < len(l.script) {
		return l.script[i]()
	}
	l.cancel()
	return nil, errors.New("script exhausted")
}

func (l *scriptedStreamLedger) AppendEvent(_ context.Context, req *ledgerv1.AppendEventRequest, _ ...grpc.CallOption) (*ledgerv1.AppendEventResponse, error) {
	l.mu.Lock()
	l.appended = append(l.appended, fmt.Sprint(req.EventType, " ", req.StreamKey, " ", req.Payload.AsMap()))
	l.mu.Unlock()
	return &ledgerv1.AppendEventResponse{}, nil
}

func closeWith(code codes.Code) func() (grpc.ServerStreamingClient[ledgerv1.LedgerEvent], error) {
	return func() (grpc.ServerStreamingClient[ledgerv1.LedgerEvent], error) {
		return nil, status.Error(code, "stream closed")
	}
}

func deliver(evs ...*ledgerv1.LedgerEvent) func() (grpc.ServerStreamingClient[ledgerv1.LedgerEvent], error) {
	return func() (grpc.ServerStreamingClient[ledgerv1.LedgerEvent], error) {
		return &sliceStream{events: append([]*ledgerv1.LedgerEvent(nil), evs...)}, nil
	}
}

// streamHarness runs consumeEventStream to completion with a controllable clock and a recording sleep.
type streamHarness struct {
	svc    *PortfolioService
	ledger *scriptedStreamLedger
	now    time.Time
	sleeps []time.Duration
}

func newStreamHarness() *streamHarness {
	h := &streamHarness{ledger: &scriptedStreamLedger{}, now: time.Date(2026, 11, 6, 14, 0, 0, 0, time.UTC)}
	h.svc = &PortfolioService{
		ledger: h.ledger,
		now:    func() time.Time { return h.now },
		sleep: func(d time.Duration) {
			h.sleeps = append(h.sleeps, d)
			h.now = h.now.Add(d)
		},
	}
	return h
}

func (h *streamHarness) run(t *testing.T, handle eventHandler) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	h.ledger.cancel = cancel
	guard(t, func() { h.svc.consumeEventStream(ctx, "order fill", "order.filled", handle) })
}

func ackNothing(context.Context, *ledgerv1.LedgerEvent) error { return nil }

func assertSleeps(t *testing.T, got []time.Duration, n int) {
	t.Helper()
	if len(got) != n {
		t.Fatalf("sleeps = %v, want %d", got, n)
	}
	for _, d := range got {
		if d != 2*time.Second {
			t.Fatalf("sleeps = %v, want every one 2s", got)
		}
	}
}

// @AC-50 (portfolio half): 10 graceful closes log at INFO on the 1st and 10th only; the healthy
// session after them writes one "stream resumed".
func TestConsumeEventStream_AC50_GracefulClosesThrottledThenResumed(t *testing.T) {
	rec := recordLogs(t)
	h := newStreamHarness()
	for i := 0; i < 10; i++ {
		h.ledger.script = append(h.ledger.script, closeWith(codes.Unavailable))
	}
	h.ledger.script = append(h.ledger.script, deliver(&ledgerv1.LedgerEvent{Sequence: 1}))

	h.run(t, ackNothing)

	closes := rec.with("order fill stream disconnected, reconnecting")
	if len(closes) != 10 {
		t.Fatalf("close records = %d, want 10", len(closes))
	}
	for i, c := range closes {
		want := slog.LevelDebug.String()
		if i == 0 || i == 9 {
			want = slog.LevelInfo.String()
		}
		if c["level"] != want || c["consecutive_graceful"] != fmt.Sprint(i+1) {
			t.Errorf("close %d = %v, want level %s, consecutive_graceful %d", i+1, c, want, i+1)
		}
	}
	if errs := rec.atLevel(slog.LevelError); len(errs) != 0 {
		t.Errorf("ERROR records = %v, want none for graceful closes", errs)
	}
	assertSleeps(t, h.sleeps, 10)
	resumed := rec.with("order fill stream resumed")
	if len(resumed) != 1 || resumed[0]["level"] != slog.LevelInfo.String() ||
		resumed[0]["consecutive_graceful"] != "10" || resumed[0]["consecutive_failures"] != "0" {
		t.Fatalf("resumed records = %v, want one INFO with consecutive_graceful 10, consecutive_failures 0", resumed)
	}
}

// @AC-50: one close of each kind before a healthy session is not a resumption worth a line.
func TestConsumeEventStream_AC50_NoResumedLineBelowTwoOfAKind(t *testing.T) {
	for name, script := range map[string][]codes.Code{
		"one graceful":           {codes.Unavailable},
		"one graceful, one fail": {codes.Unavailable, codes.Internal},
	} {
		t.Run(name, func(t *testing.T) {
			rec := recordLogs(t)
			h := newStreamHarness()
			for _, c := range script {
				h.ledger.script = append(h.ledger.script, closeWith(c))
			}
			h.ledger.script = append(h.ledger.script, deliver(&ledgerv1.LedgerEvent{Sequence: 1}))

			h.run(t, ackNothing)

			if got := rec.with("order fill stream resumed"); len(got) != 0 {
				t.Fatalf("resumed records = %v, want none", got)
			}
			assertSleeps(t, h.sleeps, len(script))
		})
	}
}

// @AC-58: a close after a quiet gap of more than 10 minutes restarts the counter at 1.
func TestConsumeEventStream_AC58_CounterRestartsAfterQuietGap(t *testing.T) {
	rec := recordLogs(t)
	h := newStreamHarness()
	h.ledger.script = append(h.ledger.script, closeWith(codes.Unavailable), closeWith(codes.Unavailable), closeWith(codes.Unavailable),
		func() (grpc.ServerStreamingClient[ledgerv1.LedgerEvent], error) {
			h.now = h.now.Add(11*time.Minute - 2*time.Second) // the sleep after close 3 already advanced 2s
			return nil, status.Error(codes.Unavailable, "stream closed")
		})

	h.run(t, ackNothing)

	closes := rec.with("order fill stream disconnected, reconnecting")
	if len(closes) != 4 {
		t.Fatalf("close records = %d, want 4", len(closes))
	}
	if c := closes[3]; c["level"] != slog.LevelInfo.String() || c["consecutive_graceful"] != "1" {
		t.Fatalf("4th close = %v, want INFO with consecutive_graceful 1", c)
	}
	if got := rec.with("order fill stream resumed"); len(got) != 0 {
		t.Fatalf("resumed records = %v, want none", got)
	}
	assertSleeps(t, h.sleeps, 4)
}

func orderFillBatch() []*ledgerv1.LedgerEvent {
	const paper = "TRADING_MODE_PAPER"
	return []*ledgerv1.LedgerEvent{
		testdata.FilledEvent(1, "ord-55", "u-56", "AAPL", "acc-56", paper, 10, 100, "ORDER_SIDE_BUY"),
		testdata.PartialEvent(2, "ord-56", "u-56", "MSFT", "acc-56", paper, 4, 300, "ORDER_SIDE_BUY"),
		testdata.FilledEvent(3, "ord-56", "u-56", "MSFT", "acc-56", paper, 10, 300, "ORDER_SIDE_BUY"),
		testdata.FilledEvent(4, "ord-57", "u-56", "TSLA", "acc-56", paper, 5, 200, "ORDER_SIDE_BUY"),
	}
}

type fillRun struct {
	execs    string
	appended []string
	fromSeqs []int64
}

// runOrderFillBatch streams the 4-event batch through handle(svc) once and reports the persisted
// writes, the ledger emits and the cursor the consumer resumed from.
func runOrderFillBatch(t *testing.T, handle func(*PortfolioService) eventHandler) fillRun {
	t.Helper()
	db := &syncRecorderDB{}
	ledger := &scriptedStreamLedger{script: []func() (grpc.ServerStreamingClient[ledgerv1.LedgerEvent], error){deliver(orderFillBatch()...)}}
	svc := &PortfolioService{
		repo: repository.NewPortfolioRepoWithDB(db), ledger: ledger, cfg: &config.Watcher{},
		marketdata: &stubMarketData{}, subs: map[string]snapshotSubscriber{}, now: fakeClock(5 * time.Second),
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ledger.cancel = cancel
	guard(t, func() { svc.consumeEventStream(ctx, "order fill", "order.filled", handle(svc)) })
	return fillRun{execs: fmt.Sprint(db.execs), appended: ledger.appended, fromSeqs: ledger.fromSeqs}
}

// @AC-56 / @AC-7 (portfolio half): 4 order fills within 60s count 4 ok and write one tick record,
// with no rpc.client.* instrument, and the partial-then-filled handling equals a run without telemetry.
func TestOrderFillConsumer_AC56_OneTickRecordPerBatch(t *testing.T) {
	prev := otel.GetMeterProvider()
	otel.SetMeterProvider(noop.NewMeterProvider())
	baseline := runOrderFillBatch(t, func(s *PortfolioService) eventHandler { return s.processOrderFill })
	otel.SetMeterProvider(prev)

	reader := installMetricReader(t)
	rec := recordLogs(t)
	instrumented := runOrderFillBatch(t, func(s *PortfolioService) eventHandler {
		return s.observed("order fill", "ok", s.processOrderFill)
	})

	if got := consumerEvents(t, reader, "order_fill", "ok"); got != 4 {
		t.Errorf("consumer.events{order_fill,ok} = %d, want 4 (the partial and the fill both count)", got)
	}
	ticks := rec.with(telemetry.LoopTickOKMsg)
	if len(ticks) != 1 || ticks[0]["loop"] != string(telemetry.LoopOrderFill) {
		t.Fatalf("tick records = %v, want exactly one with loop=order_fill", ticks)
	}
	for _, sm := range collect(t, reader).ScopeMetrics {
		for _, m := range sm.Metrics {
			if strings.HasPrefix(m.Name, "rpc.client.") {
				t.Errorf("instrument %s recorded, want no rpc.client.* instrument", m.Name)
			}
		}
	}
	if instrumented.execs != baseline.execs || fmt.Sprint(instrumented.appended) != fmt.Sprint(baseline.appended) {
		t.Fatalf("handling changed by telemetry:\n writes %s\n vs    %s\n emits %v\n vs    %v",
			instrumented.execs, baseline.execs, instrumented.appended, baseline.appended)
	}
	if !strings.Contains(baseline.execs, "MSFT") || len(baseline.appended) == 0 {
		t.Fatalf("baseline run handled nothing: writes %s, emits %v", baseline.execs, baseline.appended)
	}
	if fmt.Sprint(instrumented.fromSeqs) != "[0 5]" || fmt.Sprint(baseline.fromSeqs) != "[0 5]" {
		t.Fatalf("resume cursors = %v (baseline %v), want [0 5]: all 4 events acked", instrumented.fromSeqs, baseline.fromSeqs)
	}
	assertTickRecordsBounded(t, reader, rec.with(telemetry.LoopTickOKMsg), "u-56", "acc-56", "ord-5", "AAPL", "MSFT", "TSLA")
}

// @AC-7 (portfolio half): every consumer's successful event writes its tick under a fixed loop name.
func TestConsumerTickRecords_AC7_FixedLoopNames(t *testing.T) {
	reader := installMetricReader(t)
	rec := recordLogs(t)
	svc := &PortfolioService{now: fakeClock(time.Second)}
	ev := &ledgerv1.LedgerEvent{EventId: "evt-7", Sequence: 7, StreamKey: "acc-7"}
	for _, tc := range []struct {
		name, label, outcome string
		h                    eventHandler
	}{
		{"order fill", "order_fill", "ok", svc.observed("order fill", "ok", ackNothing)},
		{"position sync", "position_sync", "ok", svc.boundedRetry("position sync", ackNothing)},
		{"account deregistration", "deregistration", "ok", svc.boundedRetry("account deregistration", ackNothing)},
		{"bracket update", "bracket", "acked", svc.observed("bracket update", "acked", ackAlways(func(context.Context, *ledgerv1.LedgerEvent) {}))},
		{"balance sync", "balance", "acked", svc.observed("balance sync", "acked", ackAlways(func(context.Context, *ledgerv1.LedgerEvent) {}))},
	} {
		if err := tc.h(context.Background(), ev); err != nil {
			t.Fatalf("%s: err = %v", tc.name, err)
		}
		if got := consumerEvents(t, reader, tc.label, tc.outcome); got != 1 {
			t.Errorf("%s: consumer.events{%s,%s} = %d, want 1", tc.name, tc.label, tc.outcome, got)
		}
	}
	ticks := rec.with(telemetry.LoopTickOKMsg)
	var loops []string
	for _, r := range ticks {
		loops = append(loops, r["loop"])
	}
	if want := "[order_fill position_sync deregistration bracket balance]"; fmt.Sprint(loops) != want {
		t.Fatalf("tick loops = %v, want %s", loops, want)
	}
	if slices.Contains(loops, string(telemetry.LoopSignalPrune)) {
		t.Fatal("signal_prune keeps its own record and must never be written through LogTickOK")
	}
	assertTickRecordsBounded(t, reader, ticks, "evt-7", "acc-7")
}

// assertTickRecordsBounded checks every tick record and metric attribute against the closed loop
// set and the identifier ban (AC-7).
func assertTickRecordsBounded(t *testing.T, reader *sdkmetric.ManualReader, ticks []map[string]string, ids ...string) {
	t.Helper()
	if len(telemetry.Loops) > 8 {
		t.Fatalf("len(telemetry.Loops) = %d, want at most 8", len(telemetry.Loops))
	}
	for _, r := range ticks {
		if !slices.Contains(telemetry.Loops, telemetry.Loop(r["loop"])) {
			t.Errorf("tick loop %q is not in telemetry.Loops", r["loop"])
		}
		for k, v := range r {
			for _, id := range ids {
				if strings.Contains(v, id) {
					t.Errorf("tick record %s=%q contains identifier %q", k, v, id)
				}
			}
		}
	}
	for name, dps := range int64Points(t, reader) {
		for _, dp := range dps {
			for _, kv := range dp.Attributes.ToSlice() {
				for _, id := range ids {
					if strings.Contains(kv.Value.AsString(), id) {
						t.Errorf("%s attribute %s=%q contains identifier %q", name, kv.Key, kv.Value.AsString(), id)
					}
				}
			}
		}
	}
}
