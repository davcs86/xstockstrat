package alpaca

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"

	"github.com/xstockstrat/marketdata/internal/telemetry"
)

// No t.Parallel(): these tests swap the process-global MeterProvider.

func streamMetricReader(t *testing.T) *sdkmetric.ManualReader {
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

func collectStreamMetrics(t *testing.T, reader *sdkmetric.ManualReader) map[string]metricdata.Aggregation {
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

func reconnects(got map[string]metricdata.Aggregation, result string) int64 {
	sum, _ := got["marketdata.stream.reconnects"].(metricdata.Sum[int64])
	var n int64
	for _, dp := range sum.DataPoints {
		if v, ok := dp.Attributes.Value(attribute.Key(telemetry.KeyResult)); ok && v.AsString() == result {
			n += dp.Value
		}
	}
	return n
}

func lastMessageAges(got map[string]metricdata.Aggregation) []float64 {
	g, _ := got["marketdata.stream.last_message_age"].(metricdata.Gauge[float64])
	vals := make([]float64, 0, len(g.DataPoints))
	for _, dp := range g.DataPoints {
		vals = append(vals, dp.Value)
	}
	return vals
}

// clientFor wires m as c's stream manager, so StreamLastFrame reads it through streamMgr().
func clientFor(m *streamManager) *Client {
	c := &Client{}
	c.streamOnce.Do(func() { c.stream = m })
	return c
}

// @AC-12: one frame at T, then five failed sessions with MaxReconnects 5. While reconnecting the gauge
// reports T+30s - T; the loop counts 4 reconnects and 1 give-up, after which the gauge reports nothing.
func TestStreamMetrics_LastMessageAgeAndReconnects_AC12(t *testing.T) {
	reader := streamMetricReader(t)
	frameAt := time.Date(2026, 11, 6, 12, 0, 0, 0, time.UTC)
	var clock atomic.Int64
	clock.Store(frameAt.UnixNano())
	now := func() time.Time { return time.Unix(0, clock.Load()) }

	held, release := make(chan struct{}), make(chan struct{})
	var conns atomic.Int32
	srv := newStreamTestServer(t, func(conn *websocket.Conn) {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		n := conns.Add(1)
		if n <= 2 {
			for i := 0; i < 2; i++ { // auth, subscribe
				if _, _, err := conn.Read(ctx); err != nil {
					return
				}
			}
		}
		switch n {
		case 1:
			_ = conn.Write(ctx, websocket.MessageText, []byte(`[{"T":"success","msg":"authenticated"}]`))
		case 2:
			close(held)
			select {
			case <-release:
			case <-ctx.Done():
			}
		}
		_ = conn.Close(websocket.StatusNormalClosure, "")
	})
	m, _ := newStreamTestManager(t, srv, ClientConfig{MaxReconnects: 5, ReconnectDelayMs: 1})
	m.now = now
	c := clientFor(m)
	telemetry.RegisterStreamLastMessageAge(c.StreamLastFrame, now)

	subCtx, cancelSub := context.WithCancel(context.Background())
	t.Cleanup(cancelSub)
	barCh := m.subscribe(subCtx, []string{"AAPL"}, true)

	select {
	case <-held:
	case <-time.After(5 * time.Second):
		t.Fatal("the second session never connected")
	}
	clock.Store(frameAt.Add(30 * time.Second).UnixNano())
	got := collectStreamMetrics(t, reader)
	if ages := lastMessageAges(got); len(ages) != 1 || ages[0] != 30 {
		t.Fatalf("@AC-12: last_message_age while reconnecting = %v, want [30]", ages)
	}
	if n := reconnects(got, telemetry.StreamReconnected); n != 1 {
		t.Fatalf("@AC-12: reconnects{reconnected} while held = %d, want 1", n)
	}
	close(release)

	select {
	case _, ok := <-barCh:
		if ok {
			t.Fatal("received a bar; want the channel closed on give-up")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("subscriber channel not closed after give-up")
	}
	got = collectStreamMetrics(t, reader)
	if n := reconnects(got, telemetry.StreamReconnected); n != 4 {
		t.Errorf("@AC-12: reconnects{reconnected} = %d, want 4", n)
	}
	if n := reconnects(got, telemetry.StreamGaveUp); n != 1 {
		t.Errorf("@AC-12: reconnects{gave_up} = %d, want 1", n)
	}
	if ages := lastMessageAges(got); len(ages) != 0 {
		t.Errorf("@AC-12: last_message_age after give-up = %v, want no sample", ages)
	}
	if n := conns.Load(); n != 5 {
		t.Errorf("sessions = %d, want 5", n)
	}
}

// @AC-12: a lazy manager that never had a subscriber reports no age sample.
func TestStreamMetrics_LazyManagerReportsNothing_AC12(t *testing.T) {
	reader := streamMetricReader(t)
	c := NewClient(ClientConfig{})
	if _, ok := c.StreamLastFrame(); ok {
		t.Fatal("StreamLastFrame ok on a manager with no subscribers")
	}
	telemetry.RegisterStreamLastMessageAge(c.StreamLastFrame, time.Now)
	if ages := lastMessageAges(collectStreamMetrics(t, reader)); len(ages) != 0 {
		t.Fatalf("@AC-12: last_message_age = %v, want no sample", ages)
	}
}
