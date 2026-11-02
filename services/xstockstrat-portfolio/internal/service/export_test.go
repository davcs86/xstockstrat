package service

// An in-package _test.go must never import internal/handler (import cycle with the external wire test).
// These exports let package service_test build a real service over the shared fakes.

import (
	"testing"

	ledgerv1 "github.com/xstockstrat/contracts/gen/go/ledger/v1"
)

// WirePosition is one broker-valued position row served by NewWireTestService.
type WirePosition struct {
	Symbol, AccountID string
	Qty, Avg, Current float64
}

// NewWireTestService builds a PortfolioService over pgxmock positions and the given ledger.
func NewWireTestService(t *testing.T, ledger ledgerv1.LedgerServiceClient, positions ...WirePosition) *PortfolioService {
	t.Helper()
	svc, mock, _ := newQuoteSvc(t, &stubMarketData{}, 0)
	svc.ledger = ledger
	svc.watchlists = newFakeStore()
	svc.wlCfg = wideCaps()
	rows := mock.NewRows(positionCols)
	for _, p := range positions {
		posRow(rows, p.Symbol, p.AccountID, p.Qty, p.Avg, p.Current)
	}
	// 3 args without a trading-mode filter, 4 with one; the unmatched expectation is never asserted.
	mock.ExpectQuery(`FROM portfolio.positions`).WithArgs(anyArgs(3)...).WillReturnRows(rows)
	mock.ExpectQuery(`FROM portfolio.positions`).WithArgs(anyArgs(4)...).WillReturnRows(mock.NewRows(positionCols))
	return svc
}

var (
	CtxWithUser = ctxWithUser
	Guard       = guard
)
