package broker_test

import (
	"testing"

	"github.com/xstockstrat/trading/internal/broker"
)

func TestDeriveBrokerClientOrderID(t *testing.T) {
	cases := []struct {
		name     string
		intentID string
	}{
		{"uuid-shaped", "a1b2c3d4-e5f6-7890-abcd-ef1234567890"},
		{"empty", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := broker.DeriveBrokerClientOrderID(c.intentID)
			want := "xss-" + c.intentID
			if got != want {
				t.Errorf("DeriveBrokerClientOrderID(%q) = %q, want %q", c.intentID, got, want)
			}
		})
	}
}

func TestDeriveBrokerClientOrderID_NoCollisionAcrossDifferentInputs(t *testing.T) {
	a := broker.DeriveBrokerClientOrderID("intent-a")
	b := broker.DeriveBrokerClientOrderID("intent-b")
	if a == b {
		t.Fatalf("two different intent IDs must never derive the same client-order-id: %q == %q", a, b)
	}
}

func TestDeriveBrokerClientOrderID_LengthUnderTypicalLimit(t *testing.T) {
	// A real UUID input (~36 chars) plus the "xss-" prefix (~40 chars total) — the doc
	// comment's stated assumption. See design.md Open Risk #1: no confirmed hard limit
	// found in IBKR's public docs at execute time; this asserts the documented estimate,
	// not a broker-confirmed ceiling.
	got := broker.DeriveBrokerClientOrderID("a1b2c3d4-e5f6-7890-abcd-ef1234567890")
	if len(got) > 45 {
		t.Errorf("DeriveBrokerClientOrderID output length = %d, expected ~40 chars for a UUID input", len(got))
	}
}
