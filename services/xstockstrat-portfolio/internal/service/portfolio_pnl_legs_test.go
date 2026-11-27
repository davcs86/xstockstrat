package service

import (
	"errors"
	"testing"

	ledgerv1 "github.com/xstockstrat/contracts/gen/go/ledger/v1"
	portfoliov1 "github.com/xstockstrat/contracts/gen/go/portfolio/v1"
	"github.com/xstockstrat/portfolio/internal/testdata"
)

// Feature 311 — bracket-leg fills reach GetPnL with the broker leg id as order_id and side always set.

func wantNoSideLookup(t *testing.T, l *testdata.Ledger) {
	t.Helper()
	for _, r := range l.Requests() {
		if r.GetStreamKey() != "" {
			t.Fatalf("unexpected side lookup for stream %q", r.GetStreamKey())
		}
	}
}

func TestPnLLegs_AC4_TakeProfitLegFillRealized(t *testing.T) {
	l := &testdata.Ledger{Events: []*ledgerv1.LedgerEvent{
		filled(1, "o-entry", "AAPL", "acct-A", 10, 100, buy),
		filled(2, "leg-tp-1", "AAPL", "acct-A", 10, 110, sell),
	}}
	wantRealized(t, l, 100)
	wantNoSideLookup(t, l)
}

func TestPnLLegs_AC5_LegPartialDroppedOnceFilled(t *testing.T) {
	l := &testdata.Ledger{Events: []*ledgerv1.LedgerEvent{
		filled(1, "o-entry", "AAPL", "acct-A", 10, 100, buy),
		partial(2, "leg-tp-1", "AAPL", "acct-A", 4, 110, sell),
		filled(3, "leg-tp-1", "AAPL", "acct-A", 10, 110, sell),
	}}
	wantRealized(t, l, 100)
	wantNoSideLookup(t, l)
}

func TestPnLLegs_TwoAccountsSameLegIDKeepOtherAccountsPartial(t *testing.T) {
	l := &testdata.Ledger{Events: []*ledgerv1.LedgerEvent{
		filled(1, "o-entry-a", "AAPL", "acct-A", 10, 100, buy),
		filled(2, "o-entry-b", "AAPL", "acct-B", 10, 100, buy),
		filled(3, "leg-1", "AAPL", "acct-A", 10, 110, sell),
		partial(4, "leg-1", "AAPL", "acct-B", 4, 110, sell),
	}}
	wantRealized(t, l, 140)
	wantNoSideLookup(t, l)
}

func TestPnLLegs_MixedAccountAttributionStillFailsClosed(t *testing.T) {
	resp, err := runPnL251(t, &testdata.Ledger{Events: []*ledgerv1.LedgerEvent{
		filled(1, "o-entry", "AAPL", "acct-A", 10, 100, buy),
		filled(2, "leg-tp-1", "AAPL", "", 10, 110, sell),
	}}, &portfoliov1.GetPnLRequest{})
	if resp != nil || !errors.Is(err, ErrFillUnattributable) {
		t.Fatalf("want ErrFillUnattributable and no response, got resp=%v err=%v", resp, err)
	}
}
