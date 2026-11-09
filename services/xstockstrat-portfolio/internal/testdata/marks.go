// Package testdata holds shared test fixtures for xstockstrat-portfolio's service tests
// (Constitution C-13 — Go canonical fixture home).
package testdata

// Feature 231 acceptance givens (docs/roadmap/features/231-fix-after-hours-positions-priced/acceptance.feature).
const (
	Lyft            = "LYFT"
	LyftLoneSide    = 16.05
	LyftMark        = 16.98
	LyftQty         = 10
	LyftAvgEntry    = 15.00
	LyftTwoSidedAsk = 17.10
	LyftTwoSidedBid = 17.00

	Msft            = "MSFT"
	MsftBrokerPrice = 533.65
	MsftQty         = 2

	Elwt    = "ELWT"
	ElwtAsk = 5.60
	ElwtQty = 100
)
