# Product Spec: screener-preset-criteria

**Created**: 2026-09-12

---

## Problem Statement

Composing a multi-criterion screener scan is repetitive — a trader must manually add each criterion row, select the metric, set the comparator/threshold/weight, and toggle hard/rank for every scan. The fundamentals signal producer already codifies a known-good scoring model (`_BUILTIN_BANDS` in `fundsignal_loop.py`) that traders have no way to replicate in the Screener without memorizing the exact metric bands.

## User Story

As a trader, I want to select a preset criteria configuration in the Screener (e.g. "Fundamentals Signal"), so that I can load a proven multi-criterion setup instantly instead of manually rebuilding it each time.

## Functional Requirements

FR-1. The Screener page displays a preset selector (above the criteria builder) that lists available preset configurations by name and short description.

FR-2. Selecting a preset replaces all current criteria rows with the preset's criteria rows via the existing `setCriteria` mutator — no new backend RPC, no persistence.

FR-3. Presets are defined as a typed constant array in a new `screenPresets.ts` module (DRY: shared between the Screener page and the `SymbolScreening` card if it gains a preset picker in a future feature).

FR-4. The first shipped preset is **"Fundamentals Signal"** — it mirrors the `_BUILTIN_BANDS` scoring model from `fundsignal_loop.py` plus the EPS binary criterion, producing five `CriterionRow` entries:
  - `pe_ratio < 35` (weight 1, rank) — lower is better; threshold = bad endpoint
  - `pb_ratio < 5` (weight 1, rank) — lower is better; threshold = bad endpoint
  - `roe > 0.05` (weight 1, rank) — higher is better; threshold = bad endpoint
  - `debt_to_equity < 2` (weight 1, rank) — lower is better; threshold = bad endpoint
  - `eps > 0` (weight 1, hard) — binary positive earnings gate

FR-5. The preset selector is a `Select` dropdown with a "Load preset…" placeholder. Selecting a preset immediately applies it; no confirmation dialog (the action is reversible by manual editing or loading a different preset).

FR-6. After a preset is applied, the criteria builder renders the preset's rows identically to manually-added rows — the trader can edit, remove, or add criteria on top of the preset freely. There is no "locked" state.

## Out of Scope

- Persistence of custom presets (user-defined saved screens) — future feature.
- Presets on the `SymbolScreening` card (compact single-symbol view) — future feature.
- Backend changes — presets are purely frontend data; the `ScreenSymbols` RPC is unchanged.
- The preset does not set `symbolsText` — it only populates criteria rows.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-ui` — new `screenPresets.ts` module, preset selector UI in the Screener page

## Consumer Surface(s)

_Constitution **C-14**._ The end-user-reachable surface(s) this capability is consumed through.

- [x] **UI** — `xstockstrat-ui` segment(s): `/insights` (Screener page at `/insights/screener` — new preset selector dropdown above the criteria builder)
- [ ] **Agent** — n/a
- [ ] **None** — n/a

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/screener-preset-criteria` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change)
- [ ] DBA review + service owner (schema migration)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] **Known trap (fails.md:1399–1403, feature 117):** the `_validate_fundamental_metrics` server-side validator accepts `_FUNDAMENTAL_FIELDS` ∪ `extra_metrics` observed in the fetched batch. The Fundamentals Signal preset uses only the closed 11-field set (`pe_ratio`, `pb_ratio`, `roe`, `debt_to_equity`, `eps`), so this trap does not apply here — but any future preset that references provider-specific `extra_metrics` keys must be aware of this validation superset.
