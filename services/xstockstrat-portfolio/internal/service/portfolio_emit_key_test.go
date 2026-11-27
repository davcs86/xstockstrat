package service

import (
	"context"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestEmitEventAs_CallerKeyReachesLedger(t *testing.T) {
	ledger := &fakeLedger{}
	s := newSvc(newFakeStore(), &fakeConfig{}, ledger)

	if err := s.emitEventAs(context.Background(), "u1", "portfolio.position.closed", "u1", "position.closed:ev-1", map[string]interface{}{"k": "v"}); err != nil {
		t.Fatalf("emitEventAs: %v", err)
	}
	if len(ledger.reqs) != 1 {
		t.Fatalf("AppendEvent calls = %d, want 1", len(ledger.reqs))
	}
	if got := ledger.reqs[0].GetIdempotencyKey(); got != "position.closed:ev-1" {
		t.Fatalf("IdempotencyKey = %q, want %q", got, "position.closed:ev-1")
	}
}

func TestEmitEventAs_EmptyKeyGeneratesDistinctKeys(t *testing.T) {
	ledger := &fakeLedger{}
	s := newSvc(newFakeStore(), &fakeConfig{}, ledger)

	for i := 0; i < 2; i++ {
		if err := s.emitEventAs(context.Background(), "", "portfolio.snapshot", "u1", "", map[string]interface{}{}); err != nil {
			t.Fatalf("emitEventAs #%d: %v", i, err)
		}
	}
	if len(ledger.reqs) != 2 {
		t.Fatalf("AppendEvent calls = %d, want 2", len(ledger.reqs))
	}
	k1, k2 := ledger.reqs[0].GetIdempotencyKey(), ledger.reqs[1].GetIdempotencyKey()
	if k1 == "" || k2 == "" {
		t.Fatalf("generated keys must be non-empty, got %q and %q", k1, k2)
	}
	if k1 == k2 {
		t.Fatalf("two emits with an empty key share the key %q", k1)
	}
}

func TestEmitEventAs_LedgerErrorIsReturned(t *testing.T) {
	ledgerErr := status.Error(codes.Internal, "boom")
	ledger := &fakeLedger{err: ledgerErr}
	s := newSvc(newFakeStore(), &fakeConfig{}, ledger)

	err := s.emitEventAs(context.Background(), "", "portfolio.snapshot", "u1", "k-1", map[string]interface{}{})
	if status.Code(err) != codes.Internal {
		t.Fatalf("emitEventAs error = %v, want codes.Internal", err)
	}
	if ledger.calls != 1 {
		t.Fatalf("AppendEvent calls = %d, want 1 (non-Unavailable is not retried)", ledger.calls)
	}
}

func TestEmitEvent_SwallowsLedgerError(t *testing.T) {
	ledger := &fakeLedger{err: status.Error(codes.Internal, "boom")}
	s := newSvc(newFakeStore(), &fakeConfig{}, ledger)

	s.emitEvent(context.Background(), "portfolio.snapshot", "u1", map[string]interface{}{})
	if ledger.calls != 1 {
		t.Fatalf("AppendEvent calls = %d, want 1", ledger.calls)
	}
}

func TestEmitEventAs_SuccessReturnsNil(t *testing.T) {
	s := newSvc(newFakeStore(), &fakeConfig{}, &fakeLedger{})

	if err := s.emitEventAs(context.Background(), "", "portfolio.snapshot", "u1", "k-2", map[string]interface{}{}); err != nil {
		t.Fatalf("emitEventAs on success = %v, want nil", err)
	}
}
