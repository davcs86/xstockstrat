package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
	"github.com/xstockstrat/contracts/marketsession"
)

type stubDailyCoverage struct {
	earliest, latest time.Time
	count            int64
	times            []time.Time
	err              error

	gotSymbol        string
	gotStart, gotEnd time.Time
}

func (s *stubDailyCoverage) GetDailyCoverage(_ context.Context, symbol string, start, end time.Time) (time.Time, time.Time, int64, []time.Time, error) {
	s.gotSymbol, s.gotStart, s.gotEnd = symbol, start, end
	return s.earliest, s.latest, s.count, s.times, s.err
}

func nyDate(s string) time.Time {
	d, err := time.Parse("2006-01-02", s)
	if err != nil {
		panic(err)
	}
	return marketsession.DayStart(d.Add(12 * time.Hour))
}

// sessionStamps returns the 00:00 America/New_York stamp of every trading day in [from, to].
func sessionStamps(from, to string) []time.Time {
	var out []time.Time
	for d := nyDate(from); !d.After(nyDate(to)); d = marketsession.DayStart(d.AddDate(0, 0, 1).Add(12 * time.Hour)) {
		if marketsession.IsTradingDay(d) {
			out = append(out, d)
		}
	}
	return out
}

func stubFrom(times []time.Time) *stubDailyCoverage {
	return &stubDailyCoverage{earliest: times[0], latest: times[len(times)-1], count: int64(len(times)), times: times}
}

func dailyCoverageReq(start, end time.Time) *marketdatav1.GetDataCoverageRequest {
	r := &commonv1.TimeRange{End: timestamppb.New(end)}
	if !start.IsZero() {
		r.Start = timestamppb.New(start)
	}
	return &marketdatav1.GetDataCoverageRequest{Symbol: "SCHW", Timeframe: commonv1.Timeframe_TIMEFRAME_1DAY, Range: r}
}

func TestGetDataCoverageDaily(t *testing.T) {
	reqStart := nyDate("2026-01-02")
	reqEnd := time.Date(2026, 11, 20, 23, 0, 0, 0, time.UTC)

	t.Run("AC-1 interior hole", func(t *testing.T) {
		stub := stubFrom(append(sessionStamps("2026-01-02", "2026-03-31"), sessionStamps("2026-09-28", "2026-11-20")...))
		svc := &MarketDataService{dailyCoverage: stub}
		resp, err := svc.GetDataCoverage(context.Background(), dailyCoverageReq(reqStart, reqEnd))
		if err != nil {
			t.Fatalf("GetDataCoverage: %v", err)
		}
		if len(resp.Gaps) != 1 {
			t.Fatalf("want 1 gap, got %d: %v", len(resp.Gaps), resp.Gaps)
		}
		wantStart, wantEnd := nyDate("2026-04-01"), nyDate("2026-09-25").Add(12*time.Hour)
		if g := resp.Gaps[0]; !g.Start.AsTime().Equal(wantStart) || !g.End.AsTime().Equal(wantEnd) {
			t.Errorf("gap = [%v, %v], want [%v, %v]", g.Start.AsTime(), g.End.AsTime(), wantStart, wantEnd)
		}
		if resp.BarsTotal != stub.count || !resp.Earliest.AsTime().Equal(stub.earliest) || !resp.Latest.AsTime().Equal(stub.latest) {
			t.Errorf("bars/earliest/latest = %d/%v/%v, want %d/%v/%v",
				resp.BarsTotal, resp.Earliest.AsTime(), resp.Latest.AsTime(), stub.count, stub.earliest, stub.latest)
		}
		if len(resp.CoveredRanges) != 1 || resp.CoveredRanges[0].BarCount != stub.count {
			t.Errorf("covered ranges = %v, want one range of %d bars", resp.CoveredRanges, stub.count)
		}
		if stub.gotSymbol != "SCHW" || !stub.gotStart.Equal(reqStart) || !stub.gotEnd.Equal(reqEnd) {
			t.Errorf("reader called with (%q, %v, %v)", stub.gotSymbol, stub.gotStart, stub.gotEnd)
		}
	})

	t.Run("AC-3 fully covered", func(t *testing.T) {
		svc := &MarketDataService{dailyCoverage: stubFrom(sessionStamps("2026-01-02", "2026-11-20"))}
		resp, err := svc.GetDataCoverage(context.Background(), dailyCoverageReq(reqStart, reqEnd))
		if err != nil {
			t.Fatalf("GetDataCoverage: %v", err)
		}
		if len(resp.Gaps) != 0 {
			t.Errorf("want no gaps, got %v", resp.Gaps)
		}
	})

	t.Run("unset start floors at 2000-01-01", func(t *testing.T) {
		stub := stubFrom(sessionStamps("2026-01-02", "2026-11-20"))
		svc := &MarketDataService{dailyCoverage: stub}
		if _, err := svc.GetDataCoverage(context.Background(), dailyCoverageReq(time.Time{}, reqEnd)); err != nil {
			t.Fatalf("GetDataCoverage: %v", err)
		}
		if want := time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC); !stub.gotStart.Equal(want) {
			t.Errorf("reader start = %v, want %v", stub.gotStart, want)
		}
	})

	t.Run("reader error is wrapped", func(t *testing.T) {
		boom := errors.New("boom")
		svc := &MarketDataService{dailyCoverage: &stubDailyCoverage{err: boom}}
		_, err := svc.GetDataCoverage(context.Background(), dailyCoverageReq(reqStart, reqEnd))
		if !errors.Is(err, boom) || !strings.HasPrefix(err.Error(), "get coverage:") {
			t.Errorf("err = %v, want wrapped get coverage: boom", err)
		}
	})
}
