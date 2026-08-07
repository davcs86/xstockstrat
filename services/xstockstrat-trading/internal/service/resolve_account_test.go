package service

import (
	"testing"
)

// TestResolveAccount_SingleRegisteredAccount_ReturnsResolvedID proves the fix for a
// confirmed bug (feature 101 sdd-spec discovery): the single-registered-account fallback
// path previously discarded the resolved account ID (the fallback loop never captured the
// map key), so order.AccountId — and now order_intents.broker_account_id (NOT NULL) —
// could be empty on that path even though a real account was used.
func TestResolveAccount_SingleRegisteredAccount_ReturnsResolvedID(t *testing.T) {
	s := &TradingService{
		brokers: map[string]brokerPoolEntry{
			"acct-1": {brokerType: 1, userID: "u1"},
		},
	}
	id, entry, err := s.resolveAccount("")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if id != "acct-1" {
		t.Errorf("resolveAccount(\"\") with exactly one registered account: id = %q, want %q", id, "acct-1")
	}
	if entry.userID != "u1" {
		t.Errorf("resolved entry userID = %q, want %q", entry.userID, "u1")
	}
}

func TestResolveAccount_ExplicitAccountID_ReturnsSameID(t *testing.T) {
	s := &TradingService{
		brokers: map[string]brokerPoolEntry{
			"acct-1": {brokerType: 1, userID: "u1"},
			"acct-2": {brokerType: 2, userID: "u2"},
		},
	}
	id, entry, err := s.resolveAccount("acct-2")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if id != "acct-2" {
		t.Errorf("resolveAccount(\"acct-2\"): id = %q, want %q", id, "acct-2")
	}
	if entry.userID != "u2" {
		t.Errorf("resolved entry userID = %q, want %q", entry.userID, "u2")
	}
}

func TestResolveAccount_NoAccountsRegistered_FailsPrecondition(t *testing.T) {
	s := &TradingService{brokers: map[string]brokerPoolEntry{}}
	_, _, err := s.resolveAccount("")
	if err == nil {
		t.Fatal("expected an error when no accounts are registered")
	}
}

func TestResolveAccount_MultipleAccounts_RequiresExplicitID(t *testing.T) {
	s := &TradingService{
		brokers: map[string]brokerPoolEntry{
			"acct-1": {brokerType: 1},
			"acct-2": {brokerType: 2},
		},
	}
	_, _, err := s.resolveAccount("")
	if err == nil {
		t.Fatal("expected an error when multiple accounts are registered and no account_id given")
	}
}
