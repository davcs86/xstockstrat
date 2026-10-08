// Package classification holds the sector-classification vocabulary shared by the SCD repo, the
// refresh job, and the read RPCs (feature 217).
package classification

import (
	"strings"
	"time"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
)

// EpochSentinel is the valid_from of an epoch-seed row. Not 1970: an unset proto Timestamp decodes
// to unix-0, so a 1970 sentinel would be indistinguishable from "no as_of supplied".
var EpochSentinel = time.Date(1900, 1, 1, 0, 0, 0, 0, time.UTC)

const (
	SourceFMP    = "fmp"
	SourceSeed   = "seed"
	TaxonomyGICS = "GICS"
)

// fmpSectors maps FMP profile sector text (Morningstar-style labels) and GICS names onto the enum.
var fmpSectors = map[string]commonv1.Sector{
	"energy":                 commonv1.Sector_SECTOR_ENERGY,
	"basic materials":        commonv1.Sector_SECTOR_MATERIALS,
	"materials":              commonv1.Sector_SECTOR_MATERIALS,
	"industrials":            commonv1.Sector_SECTOR_INDUSTRIALS,
	"consumer cyclical":      commonv1.Sector_SECTOR_CONSUMER_DISCRETIONARY,
	"consumer discretionary": commonv1.Sector_SECTOR_CONSUMER_DISCRETIONARY,
	"consumer defensive":     commonv1.Sector_SECTOR_CONSUMER_STAPLES,
	"consumer staples":       commonv1.Sector_SECTOR_CONSUMER_STAPLES,
	"healthcare":             commonv1.Sector_SECTOR_HEALTH_CARE,
	"health care":            commonv1.Sector_SECTOR_HEALTH_CARE,
	"financial services":     commonv1.Sector_SECTOR_FINANCIALS,
	"financials":             commonv1.Sector_SECTOR_FINANCIALS,
	"financial":              commonv1.Sector_SECTOR_FINANCIALS,
	"technology":             commonv1.Sector_SECTOR_TECHNOLOGY,
	"information technology": commonv1.Sector_SECTOR_TECHNOLOGY,
	"communication services": commonv1.Sector_SECTOR_COMMUNICATION_SERVICES,
	"utilities":              commonv1.Sector_SECTOR_UTILITIES,
	"real estate":            commonv1.Sector_SECTOR_REAL_ESTATE,
}

// MapFMPSector maps FMP's free-text sector to the enum; ok=false for empty/unknown text, which
// callers must treat as "no write" (never a bogus row).
func MapFMPSector(text string) (commonv1.Sector, bool) {
	s, ok := fmpSectors[strings.ToLower(strings.TrimSpace(text))]
	return s, ok
}

// StoredName is the SCD sector column text for an enum value (e.g. SECTOR_TECHNOLOGY → "TECHNOLOGY").
func StoredName(s commonv1.Sector) string {
	return strings.TrimPrefix(s.String(), "SECTOR_")
}

// FromStoredName parses SCD sector column text; unknown text → SECTOR_UNSPECIFIED.
func FromStoredName(name string) commonv1.Sector {
	v, ok := commonv1.Sector_value["SECTOR_"+strings.ToUpper(strings.TrimSpace(name))]
	if !ok {
		return commonv1.Sector_SECTOR_UNSPECIFIED
	}
	return commonv1.Sector(v)
}

// Action is the refresh job's three-way branch for one observed sector.
type Action int

const (
	// ActionNone: open row already carries the observed sector — no write.
	ActionNone Action = iota
	// ActionSeed: no open row — epoch-seed INSERT (ON CONFLICT DO NOTHING).
	ActionSeed
	// ActionTransition: open row differs — close it at now and open a new row at now.
	ActionTransition
)

// Decide picks the SCD write for an observation given the current open row's sector ("" = none).
func Decide(openSector, observed string) Action {
	switch openSector {
	case "":
		return ActionSeed
	case observed:
		return ActionNone
	default:
		return ActionTransition
	}
}
