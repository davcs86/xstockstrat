package classification

import (
	"testing"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
)

// @AC-9: the Sector enum's zero value is the unspecified sentinel.
func TestSectorEnumSentinel_AC9(t *testing.T) {
	if commonv1.Sector_name[0] != "SECTOR_UNSPECIFIED" {
		t.Fatalf("Sector zero = %q", commonv1.Sector_name[0])
	}
}

func TestEpochSentinelIsNot1970(t *testing.T) {
	if EpochSentinel.Year() != 1900 {
		t.Fatalf("EpochSentinel = %v", EpochSentinel)
	}
}

func TestMapFMPSector(t *testing.T) {
	cases := map[string]commonv1.Sector{
		"Technology":             commonv1.Sector_SECTOR_TECHNOLOGY,
		"Financial Services":     commonv1.Sector_SECTOR_FINANCIALS,
		" consumer cyclical ":    commonv1.Sector_SECTOR_CONSUMER_DISCRETIONARY,
		"Healthcare":             commonv1.Sector_SECTOR_HEALTH_CARE,
		"Communication Services": commonv1.Sector_SECTOR_COMMUNICATION_SERVICES,
		"Basic Materials":        commonv1.Sector_SECTOR_MATERIALS,
	}
	for in, want := range cases {
		got, ok := MapFMPSector(in)
		if !ok || got != want {
			t.Errorf("MapFMPSector(%q) = %v,%v want %v", in, got, ok, want)
		}
	}
	for _, in := range []string{"", "Conglomerates"} {
		if _, ok := MapFMPSector(in); ok {
			t.Errorf("MapFMPSector(%q) ok, want unmapped", in)
		}
	}
}

func TestStoredNameRoundTrip(t *testing.T) {
	for v := range commonv1.Sector_name {
		s := commonv1.Sector(v)
		if s == commonv1.Sector_SECTOR_UNSPECIFIED {
			continue
		}
		if got := FromStoredName(StoredName(s)); got != s {
			t.Errorf("round trip %v → %q → %v", s, StoredName(s), got)
		}
	}
	if StoredName(commonv1.Sector_SECTOR_TECHNOLOGY) != "TECHNOLOGY" {
		t.Fatal("stored text must match acceptance strings")
	}
	if FromStoredName("bogus") != commonv1.Sector_SECTOR_UNSPECIFIED || FromStoredName("") != commonv1.Sector_SECTOR_UNSPECIFIED {
		t.Fatal("unknown stored text must map to UNSPECIFIED")
	}
}

func TestDecide(t *testing.T) {
	if Decide("", "ENERGY") != ActionSeed {
		t.Error("no open row → seed")
	}
	if Decide("TECHNOLOGY", "TECHNOLOGY") != ActionNone { // @AC-3
		t.Error("unchanged → no write")
	}
	if Decide("TECHNOLOGY", "COMMUNICATION_SERVICES") != ActionTransition { // @AC-2
		t.Error("changed → transition")
	}
}
