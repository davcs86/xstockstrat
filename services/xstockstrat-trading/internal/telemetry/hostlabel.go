package telemetry

import (
	"context"
	"log/slog"
	"sync"

	"go.opentelemetry.io/otel/attribute"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
)

const hostProviderKey = "host.provider"

// hostLabelExporter stamps host.provider on every datapoint after aggregation; any failure exports the batch unlabelled.
type hostLabelExporter struct {
	sdkmetric.Exporter
	stamp func(attribute.Set) attribute.Set
	warn  sync.Once
}

func newHostLabelExporter(inner sdkmetric.Exporter, provider string) sdkmetric.Exporter {
	kv := attribute.String(hostProviderKey, provider)
	return &hostLabelExporter{
		Exporter: inner,
		stamp: func(s attribute.Set) attribute.Set {
			return attribute.NewSet(append(s.ToSlice(), kv)...)
		},
	}
}

func (e *hostLabelExporter) Export(ctx context.Context, rm *metricdata.ResourceMetrics) error {
	e.label(rm)
	return e.Exporter.Export(ctx, rm)
}

// label stages every new set first and commits only when all succeeded, so a failure never leaves a partial batch.
func (e *hostLabelExporter) label(rm *metricdata.ResourceMetrics) {
	defer func() {
		if r := recover(); r != nil {
			e.warn.Do(func() { slog.Warn("host_provider labelling failed; exporting metrics without it", "panic", r) })
		}
	}()
	var slots []*attribute.Set
	for i := range rm.ScopeMetrics {
		ms := rm.ScopeMetrics[i].Metrics
		for j := range ms {
			switch d := ms[j].Data.(type) {
			case metricdata.Gauge[int64]:
				slots = collectAttrSlots(slots, d.DataPoints, func(p *metricdata.DataPoint[int64]) *attribute.Set { return &p.Attributes })
			case metricdata.Gauge[float64]:
				slots = collectAttrSlots(slots, d.DataPoints, func(p *metricdata.DataPoint[float64]) *attribute.Set { return &p.Attributes })
			case metricdata.Sum[int64]:
				slots = collectAttrSlots(slots, d.DataPoints, func(p *metricdata.DataPoint[int64]) *attribute.Set { return &p.Attributes })
			case metricdata.Sum[float64]:
				slots = collectAttrSlots(slots, d.DataPoints, func(p *metricdata.DataPoint[float64]) *attribute.Set { return &p.Attributes })
			case metricdata.Histogram[int64]:
				slots = collectAttrSlots(slots, d.DataPoints, func(p *metricdata.HistogramDataPoint[int64]) *attribute.Set { return &p.Attributes })
			case metricdata.Histogram[float64]:
				slots = collectAttrSlots(slots, d.DataPoints, func(p *metricdata.HistogramDataPoint[float64]) *attribute.Set { return &p.Attributes })
			case metricdata.ExponentialHistogram[int64]:
				slots = collectAttrSlots(slots, d.DataPoints, func(p *metricdata.ExponentialHistogramDataPoint[int64]) *attribute.Set { return &p.Attributes })
			case metricdata.ExponentialHistogram[float64]:
				slots = collectAttrSlots(slots, d.DataPoints, func(p *metricdata.ExponentialHistogramDataPoint[float64]) *attribute.Set { return &p.Attributes })
			}
		}
	}
	staged := make([]attribute.Set, len(slots))
	for i, s := range slots {
		staged[i] = e.stamp(*s)
	}
	for i, s := range slots {
		*s = staged[i]
	}
}

func collectAttrSlots[T any](out []*attribute.Set, dps []T, attrs func(*T) *attribute.Set) []*attribute.Set {
	for i := range dps {
		out = append(out, attrs(&dps[i]))
	}
	return out
}
