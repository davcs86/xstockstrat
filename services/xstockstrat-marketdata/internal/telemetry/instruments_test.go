package telemetry

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"testing"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric/noop"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
)

// No t.Parallel() in this file: every test swaps the process-global MeterProvider or slog default.

func restoreMeterProvider(t *testing.T) {
	t.Helper()
	prev := otel.GetMeterProvider()
	t.Cleanup(func() { otel.SetMeterProvider(prev) })
}

func newReaderProvider(t *testing.T) *sdkmetric.ManualReader {
	t.Helper()
	reader := sdkmetric.NewManualReader()
	mp := sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader), sdkmetric.WithView(serverMetricViews()...))
	t.Cleanup(func() { _ = mp.Shutdown(context.Background()) })
	otel.SetMeterProvider(mp)
	return reader
}

func collect(t *testing.T, reader *sdkmetric.ManualReader) map[string]metricdata.Aggregation {
	t.Helper()
	var rm metricdata.ResourceMetrics
	if err := reader.Collect(context.Background(), &rm); err != nil {
		t.Fatalf("collect: %v", err)
	}
	out := map[string]metricdata.Aggregation{}
	for _, sm := range rm.ScopeMetrics {
		for _, m := range sm.Metrics {
			out[m.Name] = m.Data
		}
	}
	return out
}

func counterSum(t *testing.T, got map[string]metricdata.Aggregation, name string) int64 {
	t.Helper()
	sum, ok := got[name].(metricdata.Sum[int64])
	if !ok {
		t.Fatalf("%s not collected as an int64 sum (seen=%v)", name, got)
	}
	var total int64
	for _, dp := range sum.DataPoints {
		total += dp.Value
	}
	return total
}

func histogramCount(t *testing.T, got map[string]metricdata.Aggregation, name string) uint64 {
	t.Helper()
	h, ok := got[name].(metricdata.Histogram[float64])
	if !ok {
		t.Fatalf("%s not collected as a float64 histogram (seen=%v)", name, got)
	}
	var n uint64
	for _, dp := range h.DataPoints {
		n += dp.Count
	}
	return n
}

func gaugeValues(t *testing.T, got map[string]metricdata.Aggregation, name string) []float64 {
	t.Helper()
	g, ok := got[name].(metricdata.Gauge[float64])
	if !ok {
		t.Fatalf("%s not collected as a float64 gauge (seen=%v)", name, got)
	}
	vals := make([]float64, 0, len(g.DataPoints))
	for _, dp := range g.DataPoints {
		vals = append(vals, dp.Value)
	}
	return vals
}

func TestAccessorsRebindWhenProviderChanges(t *testing.T) {
	restoreMeterProvider(t)
	ctx := context.Background()
	c := NewCounter("test.rebind.counter")
	h := NewHistogram("test.rebind.histogram")
	gaugeVal := 1.0
	g := NewGauge("test.rebind.gauge", func(context.Context) (float64, bool) { return gaugeVal, true })
	attr := attribute.String("outcome", "ok")

	readerA := newReaderProvider(t)
	c.Add(ctx, 1, attr)
	h.Record(ctx, 0.5, attr)
	g.Register()
	g.Register()

	readerB := newReaderProvider(t)
	c.Add(ctx, 1, attr)
	h.Record(ctx, 0.25, attr)
	gaugeVal = 2
	g.Register()

	gotA, gotB := collect(t, readerA), collect(t, readerB)
	if n := counterSum(t, gotA, "test.rebind.counter"); n != 1 {
		t.Errorf("provider A counter = %d, want exactly its own 1", n)
	}
	if n := counterSum(t, gotB, "test.rebind.counter"); n != 1 {
		t.Errorf("provider B counter = %d, want exactly its own 1", n)
	}
	if n := histogramCount(t, gotA, "test.rebind.histogram"); n != 1 {
		t.Errorf("provider A histogram count = %d, want 1", n)
	}
	if n := histogramCount(t, gotB, "test.rebind.histogram"); n != 1 {
		t.Errorf("provider B histogram count = %d, want 1", n)
	}
	if vals := gaugeValues(t, gotB, "test.rebind.gauge"); len(vals) != 1 || vals[0] != 2 {
		t.Errorf("provider B gauge = %v, want [2]", vals)
	}
	if g, ok := gotA["test.rebind.gauge"].(metricdata.Gauge[float64]); ok && len(g.DataPoints) != 0 {
		t.Errorf("provider A still observes the gauge after the move to B: %v", g.DataPoints)
	}
}

func TestGaugeSkipsObservationWhenNotOK(t *testing.T) {
	restoreMeterProvider(t)
	reader := newReaderProvider(t)
	NewGauge("test.gauge.skip", func(context.Context) (float64, bool) { return 7, false }).Register()

	if g, ok := collect(t, reader)["test.gauge.skip"].(metricdata.Gauge[float64]); ok && len(g.DataPoints) != 0 {
		t.Errorf("gauge reported %v while observe returned false", g.DataPoints)
	}
}

func TestAccessorsAreNoOpWhenDisabled(t *testing.T) {
	t.Setenv("OTEL_ENABLED", "")
	captureSlog(t)
	restoreMeterProvider(t)
	otel.SetMeterProvider(noop.NewMeterProvider())
	ctx := context.Background()

	NewCounter("test.noop.counter").Add(ctx, 1)
	NewHistogram("test.noop.histogram").Record(ctx, 1)
	NewGauge("test.noop.gauge", func(context.Context) (float64, bool) { return 1, true }).Register()
	NewGauge("test.noop.gauge.nilobserve", nil).Register()

	var nc *Counter
	var nh *Histogram
	var ng *Gauge
	nc.Add(ctx, 1)
	nh.Record(ctx, 1)
	ng.Register()

	LogTickOK(ctx, Loop("noop_loop"), time.Second, "")
	var tt TickThrottle
	_ = tt.Allow(time.Now())
}

func captureSlog(t *testing.T) *bytes.Buffer {
	t.Helper()
	prev := slog.Default()
	t.Cleanup(func() { slog.SetDefault(prev) })
	var buf bytes.Buffer
	slog.SetDefault(slog.New(slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo})))
	return &buf
}

func decodeRecords(t *testing.T, buf *bytes.Buffer) []map[string]any {
	t.Helper()
	var recs []map[string]any
	dec := json.NewDecoder(buf)
	dec.UseNumber()
	for dec.More() {
		rec := map[string]any{}
		if err := dec.Decode(&rec); err != nil {
			t.Fatalf("decode slog record: %v", err)
		}
		recs = append(recs, rec)
	}
	return recs
}

func TestLogTickOKWritesOneInfoRecord(t *testing.T) {
	buf := captureSlog(t)
	LogTickOK(context.Background(), Loop("unit_loop"), 1500*time.Millisecond, "")

	recs := decodeRecords(t, buf)
	if len(recs) != 1 {
		t.Fatalf("got %d records, want 1: %s", len(recs), buf.String())
	}
	rec := recs[0]
	if rec["msg"] != LoopTickOKMsg || LoopTickOKMsg != "loop tick ok" {
		t.Errorf("msg = %v, want %q", rec["msg"], "loop tick ok")
	}
	if rec["level"] != "INFO" {
		t.Errorf("level = %v, want INFO", rec["level"])
	}
	if rec["loop"] != "unit_loop" {
		t.Errorf("loop = %v, want unit_loop", rec["loop"])
	}
	d, ok := rec["duration_ms"].(json.Number)
	if !ok {
		t.Fatalf("duration_ms = %#v, want a JSON number", rec["duration_ms"])
	}
	if n, err := d.Int64(); err != nil || n != 1500 {
		t.Errorf("duration_ms = %v (err %v), want integer 1500", d, err)
	}
	if _, has := rec["state"]; has {
		t.Errorf("state present for an empty state: %v", rec["state"])
	}
}

func TestLogTickOKIncludesNonEmptyState(t *testing.T) {
	buf := captureSlog(t)
	LogTickOK(context.Background(), Loop("unit_loop"), 0, "idle")

	recs := decodeRecords(t, buf)
	if len(recs) != 1 || recs[0]["state"] != "idle" {
		t.Errorf("records = %v, want one record with state idle", recs)
	}
}

func TestTickThrottleLeadingEdge(t *testing.T) {
	t0 := time.Date(2026, 11, 6, 12, 0, 0, 0, time.UTC)
	var tt TickThrottle
	if !tt.Allow(t0) {
		t.Error("Allow(t0) = false, want true on the first call")
	}
	if tt.Allow(t0.Add(59 * time.Second)) {
		t.Error("Allow(t0+59s) = true, want false inside the interval")
	}
	if !tt.Allow(t0.Add(60 * time.Second)) {
		t.Error("Allow(t0+60s) = false, want true at the interval")
	}
	if tickThrottleInterval != 60*time.Second {
		t.Errorf("tickThrottleInterval = %v, want 60s", tickThrottleInterval)
	}
}

func TestServerMetricViewsUnchangedAndNoClientInstruments(t *testing.T) {
	views := serverMetricViews()
	if len(views) != 4 {
		t.Fatalf("serverMetricViews() has %d views, want exactly 4", len(views))
	}
	dropped := []string{
		"rpc.server.request.size",
		"rpc.server.response.size",
		"rpc.server.requests_per_rpc",
		"rpc.server.responses_per_rpc",
	}
	for i, name := range dropped {
		s, ok := views[i](sdkmetric.Instrument{Name: name})
		if !ok {
			t.Errorf("view %d does not match %q", i, name)
			continue
		}
		if _, drop := s.Aggregation.(sdkmetric.AggregationDrop); !drop {
			t.Errorf("view %d aggregation for %q = %T, want AggregationDrop", i, name, s.Aggregation)
		}
	}
	for i, v := range views {
		if _, ok := v(sdkmetric.Instrument{Name: "rpc.server.duration"}); ok {
			t.Errorf("view %d matches rpc.server.duration, which must be kept", i)
		}
	}

	restoreMeterProvider(t)
	reader := newReaderProvider(t)
	ctx := context.Background()
	NewCounter("test.views.counter").Add(ctx, 1)
	NewHistogram("test.views.histogram").Record(ctx, 1)
	NewGauge("test.views.gauge", func(context.Context) (float64, bool) { return 1, true }).Register()
	got := collect(t, reader)
	if len(got) == 0 {
		t.Fatal("reader collected nothing after exercising the accessors")
	}
	for name := range got {
		if strings.HasPrefix(name, "rpc.client.") {
			t.Errorf("unexpected client instrument %q collected", name)
		}
	}
}

func TestDBPoolStatsGaugesReportPoolSaturation(t *testing.T) {
	restoreMeterProvider(t)
	reader := newReaderProvider(t)
	RegisterDBPoolStats(func() DBPoolStats {
		return DBPoolStats{Acquired: 2, Max: 2, EmptyAcquireCount: 40, EmptyAcquireWait: 90 * time.Second}
	})

	got := collect(t, reader)
	for name, want := range map[string]float64{
		"marketdata.db.pool.acquired":            2,
		"marketdata.db.pool.max":                 2,
		"marketdata.db.pool.empty_acquire_count": 40,
		"marketdata.db.pool.empty_acquire_wait":  90,
	} {
		g, ok := got[name].(metricdata.Gauge[float64])
		if !ok || len(g.DataPoints) != 1 || g.DataPoints[0].Value != want {
			t.Errorf("%s = %v, want one point %v", name, got[name], want)
		}
	}
}
