# Context Log: fix-fundamentals-roe-unit

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-15 (/sdd-triage)

- Bug reported via defect report `docs/reports/2026-11-15-marketdata-roe-value-implausible-defect.md`: Fundamentals ROE value implausible against sibling metrics
- Source: operator report from staging (homelab) on 2026-11-15, with screenshots; root causes from read-only recon the same day
- Severity: SEV-3
- Routed to SDD path (Track C)
- Created: feature.md, product-spec.md, acceptance.feature (regression scenario), context.md
- Affected services (from report): `xstockstrat-marketdata`
- Root cause hypothesis: see product-spec.md § Root Cause Hypothesis
- Recommended design depth: quick → `/sdd-design fix-fundamentals-roe-unit quick` (rationale: SEV-3, single service, root cause under investigation)
- Development branch: feature/fix-fundamentals-roe-unit

## Session 2026-11-15 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings:
  - Criterion 8 (C-15): the `Given` of `@AC-1` and `@AC-5` names no provider (deferred on purpose, Open Question 1). The `Then` values (0.0366) and inputs (28070000 / 767000000) are concrete. Design must pin the traced provider and its native input unit into both Givens, or the scenarios stay unverifiable.
  - Criterion 9: Open Question 1 is marked Decided, but the decision is "not traced; recon must trace it" — still unanswered in substance. Recon must resolve it before FR-2 can be called testable.
  - Criterion 2: FR-2 depends on the untraced root cause and is testable only through `@AC-1`.
  - Criterion 8: `@AC-1` and `@AC-5` are partly redundant (both check LYFT 0.0366); AC-5 adds the stored-value (FR-5) angle. Kept — both are regression scenarios.
  - FR-5 / Fix Scope: the `DerivationVersion` bump / `BackfillFundamentals` covers only EDGAR-derived historical rows; the current-snapshot `marketdata.fundamentals` row is overwritten on re-fetch. Resolved in product-spec.md § Fix Scope (both paths named); design confirms which applies to the traced path.
  - Process note: a stale working-tree copy of product-spec.md had unchecked `- [ ]` gate boxes; the branch copy has none and is the authoritative one.
- Overlap findings (WARN — file-level only, rebase risk; no config-key, proto field-number or migration collision):
  - `internal/service/marketdata_service.go` — vs `317-fix-marketdata-miss-path-noise` (spec-ready, `:338`). Disjoint functions.
  - `internal/fmp/fmp_client.go` — vs `320-fix-vendor-key-in-url` (spec-ready, `:260`). Disjoint lines. The overlap pass reported the cited `:481` as drifted; checked on the branch — `:474` is the struct field, `:481` is the `f.ROE = r.ReturnOnEquityTTM` pass-through, so the spec anchor stands.
  - `internal/finnhub/finnhub_client.go` — vs `320-fix-vendor-key-in-url` (spec-ready, `:126`). Disjoint lines.
  - `packages/proto/marketdata/v1/marketdata.proto` — comment-only edits to `roe = 8` / `roe = 13` vs `322-fix-retired-surface-proto-cleanup` (spec-ready, near `:333`). No field-number or message overlap.
- Recommended design depth: full (escalate signals: proto touched, overlap findings, root cause untraced) — supersedes the triage `quick` recommendation.

OPERATOR DECISIONS (binding, recorded 2026-11-15):
- Root cause is not traced; recon must trace which provider or merge path produced roe ~3.66 for LYFT on staging before any fix is designed.
