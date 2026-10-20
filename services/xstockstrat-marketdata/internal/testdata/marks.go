// Package testdata holds shared test fixtures for xstockstrat-marketdata's repository and service tests
// (Constitution C-13 — Go canonical fixture home).
package testdata

// Feature 231 acceptance givens (docs/roadmap/features/231-fix-after-hours-positions-priced/acceptance.feature).
const (
	Lyft            = "LYFT"
	LyftLoneSide    = 16.05
	LyftDailyClose  = 16.98
	LyftFiledClose  = 14.20
	LyftTwoSidedAsk = 17.10
	LyftTwoSidedBid = 17.00

	Msft    = "MSFT"
	MsftAsk = 534.00
	MsftBid = 533.30

	Elwt           = "ELWT"
	ElwtAsk        = 5.60
	ElwtDailyClose = 5.48

	MarkCloseMaxAgeHours = 168
)
