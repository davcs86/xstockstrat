package testdata

import (
	"fmt"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
)

// Feature 282 asset-list givens (docs/roadmap/features/282-filter-otc-symbols/acceptance.feature).
const (
	Aapl  = "AAPL"
	Zzzz  = "ZZZZ"
	Bossy = "BOSSY"
	Crtd  = "CRTD"
	Forl  = "FORL"
	// Dnb is deliberately absent from ServableAssets (delisted / not tradable).
	Dnb = "DNB"

	ExchangeNasdaq = "NASDAQ"
	ExchangeOTC    = "OTC"
)

// ServableAssets is the loaded active+tradable asset list: AAPL, MSFT, ZZZZ on NASDAQ; BOSSY, CRTD, FORL on OTC.
func ServableAssets() []*commonv1.Asset {
	return []*commonv1.Asset{
		{Symbol: Aapl, Exchange: ExchangeNasdaq},
		{Symbol: Msft, Exchange: ExchangeNasdaq},
		{Symbol: Zzzz, Exchange: ExchangeNasdaq},
		{Symbol: Bossy, Exchange: ExchangeOTC},
		{Symbol: Crtd, Exchange: ExchangeOTC},
		{Symbol: Forl, Exchange: ExchangeOTC},
	}
}

// SyntheticAssets returns n distinct NASDAQ assets (SYN0000…), for asset-set size (shrink-guard) cases.
func SyntheticAssets(n int) []*commonv1.Asset {
	out := make([]*commonv1.Asset, 0, n)
	for i := 0; i < n; i++ {
		out = append(out, &commonv1.Asset{Symbol: fmt.Sprintf("SYN%04d", i), Exchange: ExchangeNasdaq})
	}
	return out
}
