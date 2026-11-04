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
