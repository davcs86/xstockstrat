package testdata

import (
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"

	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
	"github.com/xstockstrat/portfolio/internal/marketsession"
)

// Feature 230 acceptance givens (docs/roadmap/features/230-offline-account-full-pnl/acceptance.feature);
// the reference session is Mon 2026-10-19 unless a read time says otherwise.
const (
	Aapl              = "AAPL"
	AaplPrevClose     = 160.00 // session 2026-10-16
	AaplClose1015     = 158.00
	AaplSessionClose  = 162.00 // session 2026-10-19, after the close
	AaplFormingBar    = 161.00
	AaplMid           = 164.00
	AaplMidAfterClose = 163.00

	Tsla          = "TSLA"
	TslaShortQty  = -10.0
	TslaShortAvg  = 200.00
	TslaMid       = 180.00
	TslaClose1015 = 185.00
	TslaClose1016 = 180.00

	Xyz      = "XYZ"
	XyzClose = 22.00

	Newco    = "NEWCO"
	NewcoMid = 50.00

	Zzzz = "ZZZZ"
)

var (
	ReadLive       = time.Date(2026, 10, 19, 15, 0, 0, 0, time.UTC)
	ReadAfterClose = time.Date(2026, 10, 19, 21, 0, 0, 0, time.UTC)
	ReadSaturday   = time.Date(2026, 10, 17, 16, 0, 0, 0, time.UTC)
	// QuoteTime is inside the 2026-10-19 session (10:00 ET), so a two-sided quote counts as live.
	QuoteTime = time.Date(2026, 10, 19, 14, 0, 0, 0, time.UTC)
)

// Session returns the session date d as 00:00 America/New_York.
func Session(month time.Month, day int) time.Time {
	return marketsession.DayStart(time.Date(2026, month, day, 12, 0, 0, 0, time.UTC))
}

// DailyBar is a 1d bar stamped at 00:00 NY of its session date, as marketdata stores them.
func DailyBar(sym string, month time.Month, day int, closePrice float64) *marketdatav1.Bar {
	return &marketdatav1.Bar{Symbol: sym, Time: timestamppb.New(Session(month, day)), Close: closePrice}
}

// LiveQuote is a two-sided quote at mid, timed inside the 2026-10-19 session.
func LiveQuote(sym string, mid float64) *marketdatav1.Quote {
	return &marketdatav1.Quote{Symbol: sym, Time: timestamppb.New(QuoteTime), AskPrice: mid + 0.5, BidPrice: mid - 0.5}
}
