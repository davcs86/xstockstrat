package edgar

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sort"
	"testing"
	"time"
)

// derivationGolden pins the period builder's output for a fixed fixture to DerivationVersion
// (feature 223). If this fails, the builder's semantics changed: bump DerivationVersion so stored
// rows re-derive on the next backfill, then record the new hash here under the new version.
var derivationGolden = map[int]string{
	1: "ba944d741ff613bc26379e490c89788a35aa42abca2ceaaf56801f0254d2df8b",
}

func TestDerivationVersion_GoldenDriftGuard_feature223(t *testing.T) {
	cf := axpFacts()
	gaap := cf["facts"].(map[string]any)["us-gaap"].(map[string]any)
	inst := func(end, filed string, fy int, fp string, v float64) map[string]any {
		return map[string]any{"end": end, "val": v, "accn": "x", "fy": fy, "fp": fp, "form": "10-Q", "filed": filed}
	}
	gaap["LongTermDebt"] = map[string]any{"units": map[string]any{"USD": []map[string]any{inst("2026-06-30", "2026-07-24", 2026, "Q2", 51000e6)}}}
	gaap["ShortTermBorrowings"] = map[string]any{"units": map[string]any{"USD": []map[string]any{inst("2026-06-30", "2026-07-24", 2026, "Q2", 1458e6)}}}
	gaap["Liabilities"] = map[string]any{"units": map[string]any{"USD": []map[string]any{inst("2026-06-30", "2026-07-24", 2026, "Q2", 266578e6)}}}

	periods, err := newTestClientCF211(cf).FetchHistorical(context.Background(), "AAPL", time.Time{}, time.Time{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	sort.Slice(periods, func(i, j int) bool { return periods[i].FiscalPeriod < periods[j].FiscalPeriod })
	// @AC-1 (feature 223) at the builder: AXP Q2-2026 is financial-debt D/E (52,458 / 30,264 ≈ 1.73),
	// not total liabilities / equity (≈ 8.81).
	q2 := periodByFP(t, periods, "Q2-2026")
	if q2.DebtToEquity == nil || *q2.DebtToEquity < 1.72 || *q2.DebtToEquity > 1.74 {
		t.Fatalf("Q2-2026 debt_to_equity = %v, want ≈1.73 (< de_bad 2.0)", q2.DebtToEquity)
	}
	for i := range periods {
		if periods[i].DerivationVersion != DerivationVersion {
			t.Fatalf("%s stamped version %d, want %d", periods[i].FiscalPeriod, periods[i].DerivationVersion, DerivationVersion)
		}
		periods[i].DerivationVersion = 0 // hash the semantics, not the stamp
	}
	b, err := json.Marshal(periods)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(b)
	got := hex.EncodeToString(sum[:])
	want, ok := derivationGolden[DerivationVersion]
	if !ok || got != want {
		t.Fatalf("period-builder output changed (hash %s) without a DerivationVersion bump — bump "+
			"DerivationVersion (currently %d) and record the new hash under the new version", got, DerivationVersion)
	}
}
