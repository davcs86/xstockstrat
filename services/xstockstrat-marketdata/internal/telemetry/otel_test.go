package telemetry

import (
	"context"
	"testing"
)

// TestNewResourceOmitsTradingMode is the feature-171 regression: the built OTel Resource must not
// carry the removed trading_mode attribute (redundant with deployment.environment) while keeping the
// service.name / deployment.environment / platform trio.
func TestNewResourceOmitsTradingMode(t *testing.T) {
	t.Setenv("APPLICATION_ENV", "staging")
	t.Setenv("TRADING_MODE", "paper")
	res, err := newResource(context.Background())
	if err != nil {
		t.Fatalf("newResource: %v", err)
	}
	got := map[string]bool{}
	for _, kv := range res.Attributes() {
		got[string(kv.Key)] = true
	}
	if got["trading_mode"] {
		t.Error("trading_mode attribute must be removed")
	}
	for _, want := range []string{"service.name", "deployment.environment", "platform"} {
		if !got[want] {
			t.Errorf("missing attribute %q", want)
		}
	}
}
