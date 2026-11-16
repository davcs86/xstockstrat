package service

import (
	"testing"
	"time"

	configv1 "github.com/xstockstrat/contracts/gen/go/config/v1"
	"github.com/xstockstrat/trading/internal/config"
)

const adaptiveRateLimitKey = "broker.adaptive_rate_limit_enabled"

func TestRateLimitBudget(t *testing.T) {
	for _, tc := range []struct {
		enabled  bool
		t, stale time.Duration
		want     time.Duration
	}{
		{true, 5 * time.Second, 30 * time.Second, 20 * time.Second},
		{true, 5 * time.Second, 15 * time.Second, 5 * time.Second},
		{true, 10 * time.Second, 15 * time.Second, 10 * time.Second},
		{true, time.Second, 30 * time.Second, 28 * time.Second},
		{false, 5 * time.Second, 30 * time.Second, 0},
	} {
		if got := rateLimitBudget(tc.enabled, tc.t, tc.stale); got != tc.want {
			t.Errorf("rateLimitBudget(%v, %v, %v) = %v, want %v", tc.enabled, tc.t, tc.stale, got, tc.want)
		}
	}
}

func rateLimitWatcher(timeoutMs, multiplier float64, enabled *bool) *config.Watcher {
	values := map[string]*configv1.ConfigValue{
		"broker.timeout_ms":             {Value: &configv1.ConfigValue_FloatVal{FloatVal: timeoutMs}},
		"order_intent.stale_multiplier": {Value: &configv1.ConfigValue_FloatVal{FloatVal: multiplier}},
	}
	if enabled != nil {
		values[adaptiveRateLimitKey] = &configv1.ConfigValue{Value: &configv1.ConfigValue_BoolVal{BoolVal: *enabled}}
	}
	return config.MustSnapshotWatcher("trading", values)
}

// The method the Alpaca client is wired to reads the live timeout, multiplier and kill switch.
func TestAlpacaRateLimitBudget_FollowsConfig(t *testing.T) {
	on, off := true, false
	for _, tc := range []struct {
		timeoutMs, multiplier float64
		want                  time.Duration
	}{
		{5000, 3.0, 20 * time.Second},
		{5000, 1.5, 5 * time.Second},
		{10000, 1.5, 10 * time.Second},
		{1000, 3.0, 28 * time.Second},
	} {
		svc := &TradingService{cfgW: rateLimitWatcher(tc.timeoutMs, tc.multiplier, nil)}
		if got := svc.alpacaRateLimitBudget(); got != tc.want {
			t.Errorf("key absent, %v ms x%v: budget = %v, want %v", tc.timeoutMs, tc.multiplier, got, tc.want)
		}
	}
	if got := (&TradingService{cfgW: rateLimitWatcher(5000, 3.0, &off)}).alpacaRateLimitBudget(); got != 0 {
		t.Errorf("kill switch false: budget = %v, want 0", got)
	}
	// true is the value the alpaca_adaptive_rate_limit_keys config migration seeds.
	if got := (&TradingService{cfgW: rateLimitWatcher(5000, 3.0, &on)}).alpacaRateLimitBudget(); got != 20*time.Second {
		t.Errorf("seeded true: budget = %v, want 20s", got)
	}
}
