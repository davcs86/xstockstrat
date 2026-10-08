package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
	"github.com/xstockstrat/marketdata/internal/classification"
	"github.com/xstockstrat/marketdata/internal/fmp"
	"github.com/xstockstrat/marketdata/internal/repository"
)

type fakeClassStore struct {
	open     map[string]string
	applied  []string
	seeded   []string
	history  []repository.ClassificationRow
	asOfHits map[string]string
}

func (f *fakeClassStore) CurrentSectors(_ context.Context, symbols []string) (map[string]string, error) {
	out := map[string]string{}
	for _, s := range symbols {
		if v, ok := f.open[s]; ok {
			out[s] = v
		}
	}
	return out, nil
}
func (f *fakeClassStore) SectorAsOf(_ context.Context, symbol string, _ time.Time) (string, bool, error) {
	v, ok := f.asOfHits[symbol]
	return v, ok, nil
}
func (f *fakeClassStore) SectorHistory(_ context.Context, _ []string, _, _ *time.Time) ([]repository.ClassificationRow, error) {
	return f.history, nil
}
func (f *fakeClassStore) SeedEpoch(_ context.Context, symbol, sector string) (bool, error) {
	f.seeded = append(f.seeded, symbol+"="+sector)
	return true, nil
}
func (f *fakeClassStore) ApplyObservation(_ context.Context, symbol, sector string, _ time.Time) (classification.Action, error) {
	f.applied = append(f.applied, symbol+"="+sector)
	a := classification.Decide(f.open[symbol], sector)
	f.open[symbol] = sector
	return a, nil
}

type fakeSectorSrc struct {
	bySymbol map[string]string
	errFor   map[string]error
	calls    int
}

func (f *fakeSectorSrc) FetchSector(_ context.Context, symbol string) (string, error) {
	f.calls++
	if err := f.errFor[symbol]; err != nil {
		return "", err
	}
	return f.bySymbol[symbol], nil
}

func TestRefreshClassifications_MapsAndSkipsUnknown(t *testing.T) {
	store := &fakeClassStore{open: map[string]string{"XYZ": "TECHNOLOGY"}}
	src := &fakeSectorSrc{bySymbol: map[string]string{"XYZ": "Communication Services", "ODD": "Conglomerates", "AXP": "Financial Services"},
		errFor: map[string]error{"DOWN": errors.New("fmp: HTTP 503")}}
	svc := &MarketDataService{}
	svc.SetClassification(store, src, fakeBudget{cap: 250})
	n := svc.RefreshClassifications(context.Background(), []string{"XYZ", "ODD", "DOWN", "AXP"})
	if n != 2 {
		t.Fatalf("applied = %d, want 2 (unknown sector + vendor failure skipped)", n)
	}
	want := []string{"XYZ=COMMUNICATION_SERVICES", "AXP=FINANCIALS"}
	if len(store.applied) != 2 || store.applied[0] != want[0] || store.applied[1] != want[1] {
		t.Fatalf("applied = %v, want %v", store.applied, want)
	}
}

func TestRefreshClassifications_CapEndsCycle(t *testing.T) {
	store := &fakeClassStore{open: map[string]string{}}
	src := &fakeSectorSrc{errFor: map[string]error{"A": fmp.ErrFMPDailyCapExceeded}}
	svc := &MarketDataService{}
	svc.SetClassification(store, src, fakeBudget{})
	if n := svc.RefreshClassifications(context.Background(), []string{"A", "B", "C"}); n != 0 || src.calls != 1 {
		t.Fatalf("applied=%d calls=%d, want 0 and 1 (cycle ends on cap)", n, src.calls)
	}
}

// @AC-4: during an FMP outage the read path serves the stored sector and never calls FMP.
func TestGetCurrentSector_ServesStoreDuringOutage_AC4(t *testing.T) {
	store := &fakeClassStore{open: map[string]string{"XYZ": "ENERGY"}}
	src := &fakeSectorSrc{errFor: map[string]error{"XYZ": errors.New("fmp: HTTP 503")}}
	svc := &MarketDataService{}
	svc.SetClassification(store, src, fakeBudget{cap: 250})
	_ = svc.RefreshClassifications(context.Background(), []string{"XYZ"}) // failing cycle
	calls := src.calls
	resp, err := svc.GetCurrentSector(context.Background(), &marketdatav1.GetCurrentSectorRequest{Symbols: []string{"xyz", "newco"}})
	if err != nil {
		t.Fatalf("GetCurrentSector: %v", err)
	}
	if resp.GetSectors()[0].GetSector() != commonv1.Sector_SECTOR_ENERGY {
		t.Fatalf("XYZ = %v, want ENERGY", resp.GetSectors()[0].GetSector())
	}
	if resp.GetSectors()[1].GetSector() != commonv1.Sector_SECTOR_UNSPECIFIED {
		t.Fatalf("NEWCO = %v, want UNSPECIFIED (never an error)", resp.GetSectors()[1].GetSector())
	}
	if src.calls != calls {
		t.Fatal("read path called FMP")
	}
	if u := svc.classificationUniverse(); len(u) != 2 {
		t.Fatalf("read symbols not recorded as refresh demand: %v", u)
	}
}

func TestGetSectorAsOfAndHistory(t *testing.T) {
	split := time.Date(2018, 10, 1, 0, 0, 0, 0, time.UTC)
	store := &fakeClassStore{
		asOfHits: map[string]string{"XYZ": "TECHNOLOGY"},
		history: []repository.ClassificationRow{
			{Symbol: "XYZ", Sector: "TECHNOLOGY", Source: "seed", ValidFrom: classification.EpochSentinel, ValidTo: &split},
			{Symbol: "XYZ", Sector: "COMMUNICATION_SERVICES", Source: "fmp", ValidFrom: split},
		},
	}
	svc := &MarketDataService{}
	svc.SetClassification(store, nil, nil)
	ts := timestamppb.New(time.Date(2018, 6, 15, 0, 0, 0, 0, time.UTC))
	got, err := svc.GetSectorAsOf(context.Background(), &marketdatav1.GetSectorAsOfRequest{Symbol: "XYZ", AsOf: ts})
	if err != nil || got.GetSector() != commonv1.Sector_SECTOR_TECHNOLOGY {
		t.Fatalf("as-of = %v, %v", got, err)
	}
	miss, err := svc.GetSectorAsOf(context.Background(), &marketdatav1.GetSectorAsOfRequest{Symbol: "NEWCO", AsOf: ts})
	if err != nil || miss.GetSector() != commonv1.Sector_SECTOR_UNSPECIFIED {
		t.Fatalf("as-of miss = %v, %v", miss, err)
	}
	if _, err := svc.GetSectorAsOf(context.Background(), &marketdatav1.GetSectorAsOfRequest{Symbol: "XYZ"}); err == nil {
		t.Fatal("missing as_of must be InvalidArgument")
	}
	h, err := svc.GetSectorHistory(context.Background(), &marketdatav1.GetSectorHistoryRequest{Symbols: []string{"XYZ"}})
	if err != nil || len(h.GetRows()) != 2 || h.GetRows()[0].GetValidTo() == nil || h.GetRows()[1].GetValidTo() != nil || h.GetRows()[0].GetSource() != "seed" {
		t.Fatalf("history = %v, %v", h, err)
	}
}

func TestSeedFromProfile_WriteThrough(t *testing.T) {
	store := &fakeClassStore{open: map[string]string{}}
	svc := &MarketDataService{}
	svc.SetClassification(store, nil, nil)
	svc.seedFromProfile(context.Background(), "axp", "Financial Services")
	svc.seedFromProfile(context.Background(), "odd", "Conglomerates")
	if len(store.seeded) != 1 || store.seeded[0] != "AXP=FINANCIALS" {
		t.Fatalf("seeded = %v", store.seeded)
	}
}

// Shared budget governs the FMP snapshot quota (one throttle authority, not a DB row count).
func TestFundamentalsQuota_UsesSharedBudget(t *testing.T) {
	svc := &MarketDataService{fundProvider: "fmp", fmpBudget: fakeBudget{used: 200, cap: 250}}
	count, cap, _, err := svc.fundamentalsQuota(context.Background())
	if err != nil || count != 200 || cap != 250 {
		t.Fatalf("quota = %d/%d, %v", count, cap, err)
	}
	if svc.quotaCountAfterFetch(context.Background(), 1) != 200 {
		t.Fatal("post-fetch count must re-read the budget snapshot")
	}
}
