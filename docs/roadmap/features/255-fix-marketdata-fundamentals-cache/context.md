# Context Log: fix-marketdata-fundamentals-cache

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-21 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-21-marketdata-fundamentals-cache-defect.md` (Issues disabled).
- Source: repo-surveyor debt-radar scan `docs/repo-surveyor/debt-radar-findings.md` @ 4535695, findings **D-19**, **D-50**,
  **D-51**, **D-52**, **D-53**. All five re-verified on main-dev @ a053b0e and all reproduce in code. None excluded.
  D-19 is latent: no in-repo consumer of `StreamBars`/`StreamQuotes`.
- Severity: SEV-3. Impact type: stale-or-missing-fundamentals. Environment: dev (main-dev) @ a053b0e. Config-only: no.
- Operator decisions (2026-10-21): grouped by service+theme from the debt-radar scan; Track C for all SEV-2 (precedent #1264); batch launched via /sdd-batch with designGate halt.
  This group is SEV-3 but was routed Track C by the same grouping decision.
- Routed to SDD path (Track C).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..8), context.md; report sidecar `.status` (`triaged`).
- Affected services: xstockstrat-marketdata only.
- Root cause hypothesis:
  - D-50: the `cap > 0` short-circuit is missing.
  - D-51/D-52: the `source` column is read only on the edgar axis.
  - D-53: ignored errors, with no partial marker.
  - D-19: the lifetime-scoped counter, plus `time.Sleep` with no ctx.
- Line drift (scan @ 4535695 → a053b0e):
  - Unchanged: `stream.go:147-172`, `fmp_client.go:97`, `:127`, `:195`, `:198`, `marketdata_service.go:1676`, `:1688`,
    `:1734`, `:1742`, `:1850`, `:1958`, `marketdata_repo.go:548`, `:582`, `:836`, `:889`, `cmd/server/main.go:129-130`.
  - Minor drift: the D-51 SQL sits at `marketdata_repo.go:656-659` / `:669-670` (cited `:656-660` / `:669-672`), and the
    Finnhub window call at `marketdata_service.go:1935`.
- Test-design notes for /sdd-spec:
  - AC-6's "hex-garbled" input is illustrative of the `:582` hazard; refine it to whatever `extra` value actually fails the decode.
  - AC-5's "partial marker" mechanism is a design choice: a shortened TTL, a flag, or no upsert of the partial row.
- Overlaps:
  - **246-fix-fundsignal-neutral-score** (implementation-ready) reads `fmp_client.go`, `finnhub_client.go` and
    `marketdata_repo.go:537-562` only as evidence. Its fix is analysis-only. No code conflict. Its residual risk on cache rows
    with missing metrics (`246/implementation-spec.md:308`) is adjacent to D-53: a D-53 partial marker would help 246's
    absence detection. Note this in design.
  - **253-fix-edgar-companyfacts-decode** (code-completed) edits `internal/edgar/edgar_client.go` only. No conflict, but
    `marketdata_service.go` edgar-path anchors may shift if 253 merges first.
  - **254-fix-marketdata-secret-exposure** edits `fmp_client.go:243` and `finnhub_client.go:118`, the transport-error wrap.
    It is the same file as D-50/D-53 but different functions. Rebase onto whichever lands first.
  - **240-offline-account-full-pnl** (launched) touched `marketdata_service.go` (BatchGetBars), not the fundamentals path.
- Recommended design depth: quick → `/sdd-design fix-marketdata-fundamentals-cache quick` (rationale: SEV-3 and a single
  service with no proto or migration, but D-50 changes the observable semantics of config key
  `marketdata.fmp.daily_request_cap`, which is the C-0 quick trigger, and there are five D-ids with a partial-marker design fork).
- Development branch: feature/fix-marketdata-fundamentals-cache

## Session 2026-10-22 — sdd-review product-spec

- Product spec approved (PASS WITH WARNINGS). Status: draft → spec-ready.
- OPERATOR DECISIONS (binding, recorded 2026-10-22):
  - Grouped by service+theme from the 2026-10-20 debt-radar scan; Track C (precedent #1264).
  - Scope is D-19, D-50, D-51, D-52, D-53.
  - Operator 2026-10-21 (standing, all features): x-trace-id must be propagated as much as possible; no C-03 waiver — request-derived emits/writes use context.WithoutCancel(ctx) (Go) / the inbound metadata (Python/Node), never a fresh background context; only work with no originating request (background sweepers/loops) may mint its own context, and it should still carry a trace id when one is available.
  - Operator 2026-10-22 resolves OQ-1: marketdata.fmp.daily_request_cap <= 0 means ZERO BUDGET (FMP disabled), matching reserve(), enrichmentUnderCap(), TestBackfillFundamentals_CapDegrade_AC5, marketdata CLAUDE.md and feature 215. D-50 is fixed by correcting the misleading 'cap <= 0 = uncapped' comments (fmp_client.go:97, marketdata_service.go:1958) and any doc saying otherwise — no behaviour change; a large cap means effectively uncapped. Mark OQ-1 [x] and rewrite FR-1 and its @AC accordingly.
- Warnings (6):
  1. C-15, AC-1: the final Then (doc comments describe cap <= 0 as zero budget) was a source-text check. **Resolved
     this session:** that Then is dropped from AC-1, and FR-1 now says the comment/doc corrections
     (`fmp_client.go:97`, `marketdata_service.go:1958`, marketdata `CLAUDE.md:82`, config-governance) are verified by a
     `/sdd-spec` checklist step. AC-1/AC-9 stay behavioural.
  2. AC-3 (boot seed) and AC-8 (ERROR log) include startup/log wiring. Design must name the test seam (for example the
     repo count stub behind `cmd/server/main.go:129`). Open for /sdd-design.
  3. C-14: consumer surfaces (agent `tools.py:402`/`:812`, `traderBff.ts`, `insightsBff.ts`) are named; their
     verification steps are deferred to /sdd-spec.
  4. Scope: FR-5 (D-19, Alpaca stream manager) is unrelated to the fundamentals cache. Kept in scope per the binding
     operator decision (scope D-19, D-50..D-53); design may sequence it as an isolated last step to limit rebase risk
     against 215/254.
  5. C-11: the merge-order rows for 215 and 254 are deferred to /sdd-design — they must actually be added (on user yes).
  6. The optional `(source, fetched_at)` index (marketdata `010_*`) is conditional; design must record the decision.
- Overlap findings (WARN, no FAIL):
  - 215-block-fundamentals-strategy-on-etf (in-progress): same files — `internal/fmp/fmp_client.go` (fetchProfile/IsEtf,
    `reserve()`), `internal/service/marketdata_service.go` (quota gates; 215 Step 7 extracts `atQuotaAlertThreshold`, the
    FR-1 comment site), `cmd/server/main.go` (Limits/boot-seed wiring), `marketdata_service_test.go` (215 Step 10(c) adds a
    `{0,0}` case). Rebase risk only; cap-0 semantics now agree (OQ-1). Recommended order: 255 after 215.
  - 254-fix-marketdata-secret-exposure (draft): error-wrap/key sites in `fmp_client.go` (`:222`, `:243`, `:254`) and
    `marketdata_service.go` (`:1704`, `:1760`). Rebase risk only; 254 has no implementation-spec yet.
  - `internal/alpaca/stream.go` (FR-5): no in-flight feature touches it.
  - 253-fix-edgar-companyfacts-decode (code-completed): edits `edgar_client.go` only; not a collision.
  - Migration: none committed; the optional index would be marketdata `010_*` (re-derive at /sdd-spec). Proto: none.
    Config: none (FR-1 corrects docs for the existing `marketdata.fmp.daily_request_cap`).
  - merge-order.md has no rows for 255/215/254; propose WARN rows at /sdd-design only on user yes.
- Next: `/sdd-design fix-marketdata-fundamentals-cache` (recommended depth quick).
