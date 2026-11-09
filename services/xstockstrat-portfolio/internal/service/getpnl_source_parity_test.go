package service

import (
	"testing"

	"github.com/xstockstrat/portfolio/internal/testdata"
)

// The trading producer stamps this literal at trading.go:3676 (emitLedgerEvent); the trading half is asserted there.
func TestGetPnL251_SourceServiceParity(t *testing.T) {
	const want = "xstockstrat-trading"
	if tradingSourceService != want || testdata.TradingSourceService != want {
		t.Fatalf("source service drift: service=%q testdata=%q want %q", tradingSourceService, testdata.TradingSourceService, want)
	}
}
