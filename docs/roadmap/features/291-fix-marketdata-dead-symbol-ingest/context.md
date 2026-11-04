# Context Log: fix-marketdata-dead-symbol-ingest

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-04 (/sdd-triage)

- Bug reported via defect report `docs/reports/2026-11-04-marketdata-bar-ingest-dead-symbols-refetched-defect.md` (Issues disabled): marketdata re-ingests symbols that never return bars, every cycle, indefinitely
- Severity: SEV-3
- Routed to SDD path (Track C); environment recorded as dev (main-dev), Grafana label `staging`
- Created: feature.md, product-spec.md, acceptance.feature (regression scenario), status.md, context.md
- Affected services (from report): xstockstrat-marketdata
- Root cause hypothesis: Under investigation. The warm set has no eviction for symbols without data and the feature 282 OTC filter does not cover these. LXP and PSKY look like live listings, so the vendor/feed cause (IEX coverage, renamed tickers) must be established in recon. May also feed analysis live_loop 'had no 1d bars' WARNs.
- Recommended design depth: quick -> `/sdd-design fix-marketdata-dead-symbol-ingest quick` (rationale: SEV-3 single service, but root cause is under investigation (rubric: quick))
- Development branch: feature/fix-marketdata-dead-symbol-ingest
- Number 291 reserved via scripts/sdd-allocate-feature-number.sh (triage authorized by the operator, 2026-11-04)

---

## Session 2026-11-04 — sdd-design (Phase 0 + round 1)

- Status: `draft` (design not yet approved). `/sdd-review` skipped on the operator's instruction to work on 290/291 right away.
- Phase 0 recon written (`recon.md`): marketdata warm set is add-only (no eviction) and `GetBars` re-warms on every call, so back-off state must live in the ingester. Feature 282 (OTC filter) is `implementation-ready` and not implemented; it touches the same warm-set region.
- Round 1 (quick mode): the proposed per-symbol back-off was BLOCKED by the adversary — F-07 (hardcoded 1h/6h data-age windows; ledger fails.md:2931-2933 rules these must be config keys; "operator-approved F-07 exception" is not a valid framing under F-11), YAGNI (on the multi-symbol path dead and healthy symbols share ONE `GetBarsMulti` request at `marketdata_service.go:1293`, so back-off saves no vendor call there), false positives freezing thin IEX names on Mondays/post-holidays (fails.md:2718-2721), and an override of 282's rejected design (`282 design.md:42,48`).
- **Operator decision at the gate (P-04):** continue with the FULL back-off design (round 2), not report-once-only (the adversary's recommendation). Risk accepted knowingly: more mechanism than the logs-only harm strictly needs. Round 2 must: use a config key for the back-off max (<=0 = off), a wall-clock/session-aware threshold, a proportional peer rule, drop entries for symbols leaving the warm set, state honestly where calls are actually saved, and record 282 sign-off in both features' context.md.
- Open: round 2 in progress.

## Open Threads

- [ ] 282 coordination: narrowing 282's "warm-set readers never filtered" invariant needs recorded sign-off in 282's and 291's context.md; add a merge-order row (291 ↔ 282 independent, rebase-only).
- [ ] Name the GetBars miss-path refetch burst (BOSSY/CRTD/DNB/FORL) as a follow-up defect report/feature, not free text.
- [ ] Add FR-N definitions to product-spec so new @AC-* carry @FR tags (C-15).

---

## Session 2026-11-04 — sdd-design (round 2 + approval)

- Round 2: proposer (config key, wall-clock streak, strict-majority informative rule, reconcile) → adversary NEEDS WORK, no Floor breach. Gate (P-04): operator chose **"Approve full back-off on both paths"** (over the adversary's narrowed hold) and **"Seed via config migration"** (over a seeding waiver). design.md written; status `draft` → `design-approved` (/sdd-review skipped on operator instruction).
- Adopted from the adversary: strict `>` majority (exactly-half outage is non-informative); streak gap = `end.Sub(start)`; read `D` before taking `warmMu`; pointer-check and `markWarm` new-add delete dropped (YAGNI; warm set is add-only, reconcile bounds a stale entry to one cycle); positive-control RED tests; recording store (the no-op `fakeBarsStore` cannot prove "bars stored"); config service in scope: `SCALAR_BOUNDS_REGISTRY` entry `[0, 86400000]` + test, snapshot-built reader test (`@AC-11 @feature-278`), config migration (next number after `034`, grounded at /sdd-spec; DBA + service owner + config team approvals); honest-value and freshness (consumer, series) table written into design.md.
- **Accepted risk, operator informed:** on the production multi-symbol path (`GetBarsMulti` `:1293`) a held symbol saves zero vendor calls, and a false-positive hold lags that symbol's stored daily bar up to `D` (6 h default) for the live loop, screener, `BatchGetBars` consumers and offline marks. Report-once-only would give the same noise reduction without the lag.
- **282 sign-off recorded (also in 282's context.md):** 282's invariant "the gate applies at warm-add sites only; warm-set readers are never filtered" (`282 design.md:24,42`) is narrowed to: "No reader filters the warm set by servability. The bar ingester may leave a symbol out of a cycle's vendor request because of feature-291 no-bars hold state, and never removes it from the warm set. Quote/price readers are never filtered." `merge-order.md` row added (291 ↔ 282 independent, rebase-only).
- **Operator-approved fixed invariants** (documented in marketdata `CLAUDE.md` at teardown): strict-majority informative-cycle rule; streak-continuity gap = window width.
- Follow-up artifact created: `docs/reports/2026-11-04-marketdata-getbars-miss-path-refetch-every-call-defect.md` (+ `.status` open).
- Product-spec and acceptance.feature revised (FR-1..5, `@AC-1` kept with FR tags, `@AC-2..11` appended; config key + migration now in Fix Scope; services: marketdata + config).
- Status: draft → design-approved.

## Open Threads (supersedes the earlier list)

- [ ] Config migration number, seed-without-overwrite SQL and rollback — ground at /sdd-spec (C-07, F-01); approvals DBA + owner + config team.
- [ ] Register: `scripts/config-wiring.json`, `CLAUDE.md` row, config-governance log, snapshot-built reader test.
- [ ] CHANGELOG note: the existing no-bars WARN's `missing`/`total` are now over non-held symbols.
- [ ] Teardown: marketdata `CLAUDE.md` ingester bullet + invariants; `docs/context-constitution.md` MARKETDATA-5 note on the `<=0` resolver asymmetry.
- [ ] RED tests need inline fakes (`recordingBarsSource`, recording bars store) — list in the step Files.
- [ ] Re-check Loki for the dead symbols after 282 lands; AC-1's "not re-requested" is literally true but means zero saved calls on the multi path.
