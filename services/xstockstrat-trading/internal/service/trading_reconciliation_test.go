package service

import (
	"testing"
	"time"

	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"
	"github.com/xstockstrat/trading/internal/repository"
)

// TestRecordToProtoAccount_MapsHaltFields proves recordToProtoAccount (feature 030) now also
// maps the halt_source discriminator this feature (102) added.
func TestRecordToProtoAccount_MapsHaltFields(t *testing.T) {
	haltedAt := time.Date(2026, 8, 7, 12, 0, 0, 0, time.UTC)
	rec := &repository.BrokerAccountRecord{
		ID:         "acct-1",
		Halted:     true,
		HaltReason: "reconciliation mismatch",
		HaltSource: 2, // HALT_SOURCE_RECONCILIATION
		HaltedAt:   &haltedAt,
	}

	acct := recordToProtoAccount(rec)

	if !acct.Halted {
		t.Error("expected Halted = true")
	}
	if acct.HaltReason != "reconciliation mismatch" {
		t.Errorf("HaltReason = %q, want %q", acct.HaltReason, "reconciliation mismatch")
	}
	if acct.HaltSource != tradingv1.HaltSource_HALT_SOURCE_RECONCILIATION {
		t.Errorf("HaltSource = %v, want HALT_SOURCE_RECONCILIATION", acct.HaltSource)
	}
	if acct.HaltedAt == nil || !acct.HaltedAt.AsTime().Equal(haltedAt) {
		t.Errorf("HaltedAt = %v, want %v", acct.HaltedAt, haltedAt)
	}
}

// TestRecordToProtoAccount_UnhaltedLeavesHaltSourceUnspecified proves an unhalted record maps
// to the zero-value enum and a nil HaltedAt — never a fabricated zero-value Timestamp.
func TestRecordToProtoAccount_UnhaltedLeavesHaltSourceUnspecified(t *testing.T) {
	rec := &repository.BrokerAccountRecord{
		ID:         "acct-2",
		Halted:     false,
		HaltSource: 0,
	}

	acct := recordToProtoAccount(rec)

	if acct.Halted {
		t.Error("expected Halted = false")
	}
	if acct.HaltSource != tradingv1.HaltSource_HALT_SOURCE_UNSPECIFIED {
		t.Errorf("HaltSource = %v, want HALT_SOURCE_UNSPECIFIED", acct.HaltSource)
	}
	if acct.HaltedAt != nil {
		t.Errorf("HaltedAt = %v, want nil (nil-time must not convert to a zero-value Timestamp)", acct.HaltedAt)
	}
}
