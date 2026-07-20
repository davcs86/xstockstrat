package service

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"testing"
	"time"

	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"
)

// captureLogs swaps the default slog logger for one writing JSON to a buffer and
// returns a function that yields the records logged so far. The original logger is
// restored via t.Cleanup.
func captureLogs(t *testing.T) func() []map[string]any {
	t.Helper()
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(prev) })
	return func() []map[string]any {
		var recs []map[string]any
		for _, line := range bytes.Split(bytes.TrimSpace(buf.Bytes()), []byte("\n")) {
			if len(line) == 0 {
				continue
			}
			var m map[string]any
			if err := json.Unmarshal(line, &m); err != nil {
				t.Fatalf("unmarshal log line %q: %v", line, err)
			}
			recs = append(recs, m)
		}
		return recs
	}
}

// TestLogCredentialStatusTransition verifies the OK→INVALID degrade is a WARN (sync
// silently stops for that account), recoveries/changes are INFO, a first observation
// is INFO, and an unchanged status logs nothing.
func TestLogCredentialStatusTransition(t *testing.T) {
	ok := int32(tradingv1.CredentialStatus_CREDENTIAL_STATUS_OK)
	invalid := int32(tradingv1.CredentialStatus_CREDENTIAL_STATUS_INVALID)

	tests := []struct {
		name      string
		seen      bool
		prev      int32
		status    int32
		wantLevel string // "" means no log expected
	}{
		{"degrade ok->invalid", true, ok, invalid, "WARN"},
		{"recover invalid->ok", true, invalid, ok, "INFO"},
		{"first seen ok", false, 0, ok, "INFO"},
		{"first seen invalid", false, 0, invalid, "WARN"},
		{"unchanged ok", true, ok, ok, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			records := captureLogs(t)
			logCredentialStatusTransition("acct-1", tt.seen, tt.prev, tt.status)
			recs := records()
			if tt.wantLevel == "" {
				if len(recs) != 0 {
					t.Fatalf("expected no log, got %v", recs)
				}
				return
			}
			if len(recs) != 1 {
				t.Fatalf("expected 1 log, got %d: %v", len(recs), recs)
			}
			if recs[0]["level"] != tt.wantLevel {
				t.Errorf("level = %v, want %v", recs[0]["level"], tt.wantLevel)
			}
			if recs[0]["account_id"] != "acct-1" {
				t.Errorf("account_id = %v, want acct-1", recs[0]["account_id"])
			}
		})
	}
}

// TestWarnCredSkip_Throttles verifies a skipped invalid account warns at most once
// per credSkipLogInterval, then warns again once the window elapses.
func TestWarnCredSkip_Throttles(t *testing.T) {
	records := captureLogs(t)
	s := &TradingService{credSkipLoggedAt: make(map[string]time.Time)}

	s.warnCredSkip("acct-1")
	s.warnCredSkip("acct-1") // within the window — suppressed
	s.warnCredSkip("acct-2") // different account — logs

	if n := len(records()); n != 2 {
		t.Fatalf("expected 2 warnings (one per account), got %d", n)
	}

	// Force the throttle window for acct-1 to have elapsed.
	s.credSkipLoggedAt["acct-1"] = time.Now().Add(-credSkipLogInterval - time.Second)
	records2 := captureLogs(t)
	s.warnCredSkip("acct-1")
	if n := len(records2()); n != 1 {
		t.Fatalf("expected 1 warning after window elapsed, got %d", n)
	}
}
