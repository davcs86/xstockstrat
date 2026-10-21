# Context Log: fix-portfolio-snapshot-surface

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-21 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-21-portfolio-snapshot-surface-defect.md` (Issues disabled).
- Source: repo-surveyor debt-radar scan `docs/repo-surveyor/debt-radar-findings.md` @ 4535695, findings **D-12**, **D-24**.
  Both re-verified on main-dev @ a053b0e and both reproduce in code. None excluded.
- Severity: SEV-2 (group; D-24 is latent security, D-12 alone was rated lower). Impact type: cross-tenant-data-exposure.
  Environment: dev (main-dev) @ a053b0e. Config-only: no.
- Operator decisions (2026-10-21): grouped by service+theme from the debt-radar scan; Track C for all SEV-2 (precedent #1264); batch launched via /sdd-batch with designGate halt.
- Routed to SDD path (Track C).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..4), context.md; report sidecar `.status` (`triaged`).
- Affected services: xstockstrat-portfolio. xstockstrat-config is affected only if D-12 retires the key.
- Root cause hypothesis: the subscriber map has no owner, and filtering was deferred to a never-built consumer (D-24).
  The writer was scaffolded per user and never wired; per-fill broadcast masked it (D-12).
- Line drift (scan @ 4535695 → a053b0e):
  - The scan cites `portfolio_service.go:937`, `portfolio_handler.go:129`, `:292-302`, `:894`.
  - Current: the broadcast loop is at `:936-942`, the `StartSnapshotWriter` definition at `:893-906`, the Connect
    handler at `:114-138` (TradingMode filter `:129`) and the gRPC adapter at `:291-311`.
- **Nuance vs the scan:** the scan calls D-24 latent because there is "no client caller". That is true of the consumer
  side only. The producer is live: `processOrderFill` calls `broadcastSnapshot` after every fill
  (`portfolio_service.go:376`), so snapshots are produced and fanned out today and are dropped only because nobody subscribes.
  For D-12, per-fill snapshots also mean `GetSnapshot` has data, but only at fill times.
- Prior record: `docs/reports/2026-09-16-trading-system-security-audit.md:177` already noted "`StreamPortfolioUpdates`
  broadcasts every user's snapshot". It was never triaged into a feature.
- Overlaps:
  - None of features 240–253 touch `StartSnapshotWriter`, `broadcastSnapshot` or `portfolio_handler.go`.
  - **251-fix-getpnl-source-service**, **256-fix-offline-book-consistency** and **257-fix-ledger-query-pagination** edit
    other functions in `portfolio_service.go`. Same file, so rebase/merge-order only.
- Design fork for D-12: wire vs delete.
  - Wiring needs a multi-user loop (the current signature is per user) and adds periodic `InsertSnapshot` writes. Portfolio
    is on PgBouncer `:25061`, so the pool impact is small but must be stated.
  - Deleting needs a new config migration to retire the seeded rows, plus a governance log entry.
- Recommended design depth: quick → `/sdd-design fix-portfolio-snapshot-surface quick` (rationale: SEV-2 and a single service
  with no proto, which is the C-0 quick trigger). **Escalate to full** (`/sdd-design fix-portfolio-snapshot-surface`) if
  design picks the delete-the-key path, because that adds a config-service migration and a second service.
- Development branch: feature/fix-portfolio-snapshot-surface

## Session 2026-10-21 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Criteria verdict: PASS WITH WARNINGS (no fails, no floor breaches).
- Warnings (and how each was handled):
  1. C-15: `@AC-6` (Connect empty caller) passes on the buggy code, because `portfolio_handler.go:115-118` already
     rejects an empty caller. Only the gRPC adapter (`:292-295`) lacks the check. **Resolved:** AC-6 is relabelled
     `@non-regression` (no longer `@regression`). The Problem Statement and FR-3 now say the empty-caller defect is
     gRPC-only and the owner-filter gap is on both paths (Connect loop `:125-134`).
  2. Criterion 1: no persona named. **Resolved:** the Problem Statement now names the tenant/trader whose equity would leak.
  3. Criterion 9: AC-4 and AC-5 are mutually exclusive until design picks the FR-4 branch. **Carried to /sdd-design:**
     design must delete the losing scenario before impl-spec review.
  4. Criterion 8: AC-5's doc-table `Then` was not a runtime outcome, and AC-4 depended on timing. **Resolved:** the
     doc-table check moved to the product-spec Fix Scope, and AC-4 is pinned to a fake service clock.
  5. Branch (b) hygiene: **Resolved:** `services/xstockstrat-portfolio/docs/context-constitution-findings.md:29` is
     added to the update list. Under branch (a) the pooled pool budget (default 2) is already stated.
- Overlap findings (WARN only, no FAIL):
  - Same-file, disjoint-region rebase overlap in `services/xstockstrat-portfolio/internal/service/portfolio_service.go`
    with 242 fix-push-untargeted-broadcast, 256 fix-offline-book-consistency, 257 fix-ledger-query-pagination and
    251 fix-getpnl-source-service.
  - No live peer names `portfolio_handler.go`.
  - No collision on the `portfolio.snapshot.interval_minutes` key.
  - Branch (b) migration NNN: trunk tip is `030`, and `031`/`032` are claimed by 243/244/248, so this feature uses
    `033` or higher (re-derive at spec time). Out of scope for this feature, to be routed separately: 244 and 248
    both claim `032_*`.
  - No merge-order row is recommended.
- OPERATOR DECISIONS (binding, recorded 2026-10-21):
  - Grouped by service+theme from the 2026-10-20 debt-radar scan; Track C.
  - Scope is D-12, D-24.
- Next: `/sdd-design fix-portfolio-snapshot-surface`.
