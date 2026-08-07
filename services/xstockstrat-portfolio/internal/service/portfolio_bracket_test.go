package service

import (
	"testing"

	"google.golang.org/protobuf/types/known/structpb"
)

// TestParseBracketUpdatePayload_ParsesBothIDs proves the happy path: both leg order IDs
// present, all identity fields round-trip.
func TestParseBracketUpdatePayload_ParsesBothIDs(t *testing.T) {
	payload, err := structpb.NewStruct(map[string]interface{}{
		"user_id":              "user-abc",
		"account_id":           "acct-123",
		"symbol":               "AAPL",
		"trading_mode":         "TRADING_MODE_LIVE",
		"stop_order_id":        "stop-1",
		"take_profit_order_id": "tp-1",
	})
	if err != nil {
		t.Fatalf("build payload: %v", err)
	}
	upd, err := parseBracketUpdatePayload(payload)
	if err != nil {
		t.Fatalf("parseBracketUpdatePayload: %v", err)
	}
	if upd.UserID != "user-abc" || upd.AccountID != "acct-123" || upd.Symbol != "AAPL" ||
		upd.TradingMode != "TRADING_MODE_LIVE" {
		t.Errorf("identity fields: got %+v", upd)
	}
	if upd.StopOrderID != "stop-1" {
		t.Errorf("StopOrderID: got %q, want %q", upd.StopOrderID, "stop-1")
	}
	if upd.TakeProfitOrderID != "tp-1" {
		t.Errorf("TakeProfitOrderID: got %q, want %q", upd.TakeProfitOrderID, "tp-1")
	}
}

// TestParseBracketUpdatePayload_EmptyIDMeansCleared proves an explicit "" for a leg ID
// (the "bracket canceled" signal from trading's CancelOrder) parses to "", the same value
// processBracketUpdate treats as "clear this column" — distinguishing it from a field that
// was never set is not the parser's job; both must map to the empty string here.
func TestParseBracketUpdatePayload_EmptyIDMeansCleared(t *testing.T) {
	payload, err := structpb.NewStruct(map[string]interface{}{
		"user_id":              "user-abc",
		"account_id":           "acct-123",
		"symbol":               "AAPL",
		"trading_mode":         "TRADING_MODE_LIVE",
		"stop_order_id":        "",
		"take_profit_order_id": "",
	})
	if err != nil {
		t.Fatalf("build payload: %v", err)
	}
	upd, err := parseBracketUpdatePayload(payload)
	if err != nil {
		t.Fatalf("parseBracketUpdatePayload: %v", err)
	}
	if upd.StopOrderID != "" || upd.TakeProfitOrderID != "" {
		t.Errorf("explicit empty IDs must parse to \"\", got %+v", upd)
	}
}

// TestParseBracketUpdatePayload_AbsentIDFieldAlsoMeansCleared proves a payload that omits
// the leg-ID fields entirely (e.g. an older event shape) parses identically to an explicit
// "" — Go's zero value for string closes this gap for free, but pin it down as a named case.
func TestParseBracketUpdatePayload_AbsentIDFieldAlsoMeansCleared(t *testing.T) {
	payload, err := structpb.NewStruct(map[string]interface{}{
		"user_id":      "user-abc",
		"account_id":   "acct-123",
		"symbol":       "AAPL",
		"trading_mode": "TRADING_MODE_PAPER",
	})
	if err != nil {
		t.Fatalf("build payload: %v", err)
	}
	upd, err := parseBracketUpdatePayload(payload)
	if err != nil {
		t.Fatalf("parseBracketUpdatePayload: %v", err)
	}
	if upd.StopOrderID != "" || upd.TakeProfitOrderID != "" {
		t.Errorf("absent ID fields must parse to \"\", got %+v", upd)
	}
}

// TestParseBracketUpdatePayload_TradingModeMatchesOrderFillConvention proves the trading-mode
// string is passed through verbatim (not re-derived), matching processOrderFill's
// "TRADING_MODE_LIVE" string convention (portfolio_service.go's mode-string mapping).
func TestParseBracketUpdatePayload_TradingModeMatchesOrderFillConvention(t *testing.T) {
	payload, err := structpb.NewStruct(map[string]interface{}{
		"user_id":      "user-abc",
		"account_id":   "acct-123",
		"symbol":       "AAPL",
		"trading_mode": "TRADING_MODE_LIVE",
	})
	if err != nil {
		t.Fatalf("build payload: %v", err)
	}
	upd, err := parseBracketUpdatePayload(payload)
	if err != nil {
		t.Fatalf("parseBracketUpdatePayload: %v", err)
	}
	if upd.TradingMode != "TRADING_MODE_LIVE" {
		t.Errorf("TradingMode: got %q, want %q", upd.TradingMode, "TRADING_MODE_LIVE")
	}
}

// TestParseBracketUpdatePayload_NilPayloadErrors proves the nil-payload guard (mirrors
// processPositionSync/processOrderFill's `if event.Payload == nil { return }` early-out,
// but as a returned error here since this is a pure function, not an event handler).
func TestParseBracketUpdatePayload_NilPayloadErrors(t *testing.T) {
	if _, err := parseBracketUpdatePayload(nil); err == nil {
		t.Error("expected an error for a nil payload, got nil")
	}
}
