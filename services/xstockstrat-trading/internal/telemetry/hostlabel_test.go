package telemetry

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"

	"go.opentelemetry.io/otel/attribute"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
)

// fakeExporter records, at Export time, the attributes of every datapoint and the forwarded calls.
type fakeExporter struct {
	exported           [][]map[string]string
	flushes, shutdowns int
}

func (f *fakeExporter) Temporality(sdkmetric.InstrumentKind) metricdata.Temporality {
	return metricdata.DeltaTemporality
}

func (f *fakeExporter) Aggregation(sdkmetric.InstrumentKind) sdkmetric.Aggregation {
	return sdkmetric.AggregationDefault{}
}

func (f *fakeExporter) Export(_ context.Context, rm *metricdata.ResourceMetrics) error {
	f.exported = append(f.exported, attrMaps(rm))
	return nil
}

func (f *fakeExporter) ForceFlush(context.Context) error { f.flushes++; return nil }
func (f *fakeExporter) Shutdown(context.Context) error   { f.shutdowns++; return nil }

// attrMaps lists every datapoint's attributes across all 8 data types, enumerated independently of
// the production code under test.
func attrMaps(rm *metricdata.ResourceMetrics) []map[string]string {
	var out []map[string]string
	add := func(s attribute.Set) {
		m := map[string]string{}
		for _, kv := range s.ToSlice() {
			m[string(kv.Key)] = kv.Value.String()
		}
		out = append(out, m)
	}
	for _, sm := range rm.ScopeMetrics {
		for _, m := range sm.Metrics {
			switch d := m.Data.(type) {
			case metricdata.Gauge[int64]:
				for _, p := range d.DataPoints {
					add(p.Attributes)
				}
			case metricdata.Gauge[float64]:
				for _, p := range d.DataPoints {
					add(p.Attributes)
				}
			case metricdata.Sum[int64]:
				for _, p := range d.DataPoints {
					add(p.Attributes)
				}
			case metricdata.Sum[float64]:
				for _, p := range d.DataPoints {
					add(p.Attributes)
				}
			case metricdata.Histogram[int64]:
				for _, p := range d.DataPoints {
					add(p.Attributes)
				}
			case metricdata.Histogram[float64]:
				for _, p := range d.DataPoints {
					add(p.Attributes)
				}
			case metricdata.ExponentialHistogram[int64]:
				for _, p := range d.DataPoints {
					add(p.Attributes)
				}
			case metricdata.ExponentialHistogram[float64]:
				for _, p := range d.DataPoints {
					add(p.Attributes)
				}
			}
		}
	}
	return out
}

func sumBatch(sets ...attribute.Set) *metricdata.ResourceMetrics {
	pts := make([]metricdata.DataPoint[int64], len(sets))
	for i, s := range sets {
		pts[i] = metricdata.DataPoint[int64]{Attributes: s, Value: 1}
	}
	return &metricdata.ResourceMetrics{ScopeMetrics: []metricdata.ScopeMetrics{{
		Metrics: []metricdata.Metrics{{Name: "c", Data: metricdata.Sum[int64]{DataPoints: pts}}},
	}}}
}

func wrap(t *testing.T, inner sdkmetric.Exporter) *hostLabelExporter {
	t.Helper()
	e, ok := newHostLabelExporter(inner, "homelab").(*hostLabelExporter)
	if !ok {
		t.Fatal("newHostLabelExporter did not wrap the inner exporter")
	}
	return e
}

// B1 @AC-5: a labelling failure on any export must not lose the batch or add the label, and warns once.
func TestHostLabelFailureExportsOriginalBatchAndWarnsOnce(t *testing.T) {
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, nil)))
	t.Cleanup(func() { slog.SetDefault(prev) })

	fake := &fakeExporter{}
	e := wrap(t, fake)
	calls := 0
	e.stamp = func(s attribute.Set) attribute.Set {
		calls++
		if calls >= 2 {
			panic("boom")
		}
		return s
	}
	a, b := attribute.NewSet(attribute.String("outcome", "a")), attribute.NewSet(attribute.String("outcome", "b"))
	for range 2 {
		if err := e.Export(context.Background(), sumBatch(a, b)); err != nil {
			t.Fatalf("Export: %v", err)
		}
	}
	if len(fake.exported) != 2 {
		t.Fatalf("inner exporter got %d batches, want 2", len(fake.exported))
	}
	for i, batch := range fake.exported {
		if len(batch) != 2 || batch[0]["outcome"] != "a" || batch[1]["outcome"] != "b" {
			t.Fatalf("batch %d changed: %v", i, batch)
		}
		for _, m := range batch {
			if _, has := m["host.provider"]; has {
				t.Errorf("batch %d carries host.provider after a failed stamp: %v", i, m)
			}
		}
	}
	if got := strings.Count(buf.String(), "host_provider"); got != 1 {
		t.Errorf("warning mentioning host_provider logged %d times, want 1:\n%s", got, buf.String())
	}
}

// B2 @AC-13: a datapoint that already carries host.provider ends with exactly one such key.
func TestHostLabelOverwritesAnExistingKey(t *testing.T) {
	fake := &fakeExporter{}
	rm := sumBatch(attribute.NewSet(attribute.String("host.provider", "x"), attribute.String("outcome", "ok")))
	if err := wrap(t, fake).Export(context.Background(), rm); err != nil {
		t.Fatalf("Export: %v", err)
	}
	want := map[string]string{"host.provider": "homelab", "outcome": "ok"}
	got := fake.exported[0][0]
	if len(got) != len(want) || got["host.provider"] != "homelab" || got["outcome"] != "ok" {
		t.Errorf("exported attributes = %v, want %v", got, want)
	}
	// Go assigns in place by design (D-8): the input batch is labelled afterwards.
	if after := attrMaps(rm)[0]["host.provider"]; after != "homelab" {
		t.Errorf("input batch host.provider after Export = %q, want homelab", after)
	}
}

// B3/B4 @AC-21: the wrapper keeps the exporter contract (characterization; embedding forwards it).
func TestHostLabelForwardsTheExporterContract(t *testing.T) {
	fake := &fakeExporter{}
	e := wrap(t, fake)
	if got := e.Temporality(sdkmetric.InstrumentKindCounter); got != metricdata.DeltaTemporality {
		t.Errorf("Temporality(counter) = %v, want DELTA", got)
	}
	if err := e.ForceFlush(context.Background()); err != nil {
		t.Fatalf("ForceFlush: %v", err)
	}
	if err := e.Shutdown(context.Background()); err != nil {
		t.Fatalf("Shutdown: %v", err)
	}
	if fake.flushes != 1 || fake.shutdowns != 1 {
		t.Errorf("inner flushes=%d shutdowns=%d, want 1 and 1", fake.flushes, fake.shutdowns)
	}
}

// B5 @AC-15: every data type is labelled; a `for _, dp := range` implementation assigns to a copy and fails here.
func TestHostLabelLabelsEveryDataType(t *testing.T) {
	set := attribute.NewSet(attribute.String("outcome", "ok"))
	metrics := []metricdata.Metrics{
		{Name: "g64", Data: metricdata.Gauge[int64]{DataPoints: []metricdata.DataPoint[int64]{{Attributes: set}}}},
		{Name: "gf", Data: metricdata.Gauge[float64]{DataPoints: []metricdata.DataPoint[float64]{{Attributes: set}}}},
		{Name: "s64", Data: metricdata.Sum[int64]{DataPoints: []metricdata.DataPoint[int64]{{Attributes: set}}}},
		{Name: "sf", Data: metricdata.Sum[float64]{DataPoints: []metricdata.DataPoint[float64]{{Attributes: set}}}},
		{Name: "h64", Data: metricdata.Histogram[int64]{DataPoints: []metricdata.HistogramDataPoint[int64]{{Attributes: set}}}},
		{Name: "hf", Data: metricdata.Histogram[float64]{DataPoints: []metricdata.HistogramDataPoint[float64]{{Attributes: set}}}},
		{Name: "e64", Data: metricdata.ExponentialHistogram[int64]{DataPoints: []metricdata.ExponentialHistogramDataPoint[int64]{{Attributes: set}}}},
		{Name: "ef", Data: metricdata.ExponentialHistogram[float64]{DataPoints: []metricdata.ExponentialHistogramDataPoint[float64]{{Attributes: set}}}},
	}
	rm := &metricdata.ResourceMetrics{ScopeMetrics: []metricdata.ScopeMetrics{{Metrics: metrics}}}
	fake := &fakeExporter{}
	if err := wrap(t, fake).Export(context.Background(), rm); err != nil {
		t.Fatalf("Export: %v", err)
	}
	got := fake.exported[0]
	if len(got) != 8 {
		t.Fatalf("exported %d datapoints, want 8", len(got))
	}
	for i, m := range got {
		if m["host.provider"] != "homelab" || m["outcome"] != "ok" {
			t.Errorf("datapoint %d (%s) attributes = %v, want host.provider=homelab and outcome=ok", i, metrics[i].Name, m)
		}
	}
}
