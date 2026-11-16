# Context Log: fix-replace-tif-before-intent

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-16 (/sdd-triage)

- Bug reported via defect report `docs/reports/2026-11-16-replace-order-tif-validation-after-intent-claim-defect.md` (Issues disabled; `--from-report`). Sidecar stamped `triaged` / `ref: feature:349-fix-replace-tif-before-intent`.
- Severity: SEV-3, environment dev, not config-fixable → Track C.
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..AC-3), context.md.
- Affected services: xstockstrat-trading.
- Root cause: confirmed by reading `ReplaceOrder` on `main-dev@f61f76c` (`InsertIntent` ≈ `trading.go:1569`, PENDING mark ≈ 1604, `validateTIF` ≈ 1614). The report's line numbers predate feature 347 and are stale.
- Design depth: the rubric (`docs/sdd/design-depth-rubric.md`) gives `skip` for this bug; the operator chose `quick` in the task handover → `/sdd-design fix-replace-tif-before-intent quick`.
- Operator decisions carried in the task handover (2026-11-16): design `quick`; execute `sequential` (mode entry confirmed); single integration PR `feature/fix-replace-tif-before-intent` → `main-dev`; C-16 promotion approved in advance for durable-guarantee scenarios; do not merge; do not use `ReleasePendingIntent` for this fix (TRADING-8).
- Assumptions made by this session:
  - Slug `fix-replace-tif-before-intent` instead of the literal first-three-title-words form (`fix-replaceorder-validates-timeinforce`); basis: prior bug features use descriptive slugs (328–346).
  - Already-stranded rows in a deployed database are out of scope; basis: the task forbids changes to intent-table semantics and the report asks only for the ordering fix.
- Development branch: feature/fix-replace-tif-before-intent

## Session 2026-11-16 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Tree: `feature/fix-replace-tif-before-intent` == origin, `main-dev@f61f76c` merged.
- A1b: not a re-attempt of any demoted feature (session's own judgement — none of the 22 concerns replace or time-in-force).
- Warnings (all addressed in the spec in this session): no `## Consumer Surface(s)` section (C-14) → added; broker / trading-mode / fill-status scope not stated → `## Scope Notes` added; "no reclaim event" not asserted → added to @AC-1. The rate-limited replace path (FR-2) stays covered by the existing 347 test, not a new scenario.
- Overlap findings: WARN only — same function as 347 (`prevIntent` capture and the `ErrRateLimited` branch in `ReplaceOrder`), already on `main-dev`; keep both intact. No config/proto/migration overlap; no merge-order entry needed.
- Recommended design depth: quick (single service, no proto, no migration, no FAIL/warning-level blocking overlap).

## Session 2026-11-16 — sdd-design

- Phase 0 Recon: wrote recon.md (services: xstockstrat-trading; key reuse patterns: `PlaceOrder`'s validate-before-claim order, `newRLFakeHarness` + `memIntentRepo`). No escalation signal; no CHANGE verdict; stayed `quick`.
- Phase 1 Grilling: 1 round (quick). Chosen approach: move the `brokerReq` literal + TIF block in `ReplaceOrder` to right after `resolveAccount`, before `deriveReplaceCancelIntentID` (D-1, D-2). Rejected: releasing or REJECTED-finalizing the intent on the TIF path; validating from `order.BrokerType`; moving `resolveAccount`; a `tifWire` local.
- Adversary verdict SOUND; 7 non-blocking objections, all closed in the round (debate.md O-1..O-7). `@AC-4` appended for the precedence rule (D-3).
- Constitution rules touched: C-08, C-13, C-14, C-15, C-16, C-18, P-06, F-04; TRADING-6/7/8. Floor breaches: none.
- Gate (P-04) deviation, recorded: no live `AskUserQuestion` approval was held. The operator's handover asked for minimal intervention, fixed the depth (`quick`) and named this fix approach; the round produced no Floor breach, no blocking objection and no behavioral fork beyond what "validate before any intent is claimed, as `PlaceOrder` does" implies. Approval is therefore taken as delegated by the handover. D-3 (a disallowed TIF beats an existing intent row) is the one decision the handover did not spell out; it follows from the ordering and matches `PlaceOrder` — flagged in the PR for the operator.
- Assumption (session's own): the `replaceOrderFn` hook on the shared `fakeBroker` helper is preferred over a fourth single-use broker double (DRY guard rail, O-5).
- Ledger: read (fails 2026-10-07 ×2, 2026-11-16 ×2; insights 2026-10-07, 2026-11-16). No design-phase write — the trap is already recorded (fails 2026-10-07).
- Open thread: pre-fix stranded intent rows are not repaired (design.md § Open Risks) — report at the integration PR.
- Status: spec-ready → design-approved.

## Session 2026-11-16T08:40Z — sdd-spec

- Tree: `feature/fix-replace-tif-before-intent@747bcdb ≡ origin/feature/fix-replace-tif-before-intent (merged origin/main-dev@7eeab3d)`. The preflight found `origin/main-dev` ahead (`f61f76c..7eeab3d`: feature 345 docs, one fails.md entry and `.gitleaks.toml`; no service code); it was merged and the merge pushed, as `docs/sdd/tree-freshness.md` prescribes. No `trading.go` anchor moved.
- Generated implementation-spec.md with 3 steps. Status → implementation-ready.
- Steps 1+2 (test, then service) are one atomic unit: the tests are RED until the move lands, so Step 1 cannot pass its own Verification alone (step-constraints.md §C, F-05). The test step is numbered first (fails.md 2026-11-04, 2026-11-10). Step 3 is docs.
- Key codebase findings:
  - The block to move is `trading.go:1606-1618` (comment, `brokerReq` literal, TIF block); it reads only `req` and `entry`, both available after `resolveAccount` (`:1558-1561`). Target: above the `// Dedup insert:` comment (`:1563`).
  - `fakeBroker` has no replace hook (`trading_bracket_test.go:26-34`, panic at `:53-55`); five `ReplaceOrder` methods exist on test doubles and the count stays five.
  - `trading.go` is in the agent job's paths-filter (`.github/workflows/ci.yml:59`); the agent test reads only the offline `Unavailable` string at `trading.go:1008`, which the move does not touch.
- Prototype (fails.md 2026-11-16 rule; scratch worktree of `747bcdb`, discarded, nothing committed): tests alone are RED for `@AC-1` (4 rows, `replace intent rows = 1`), `@AC-2` ("still pending") and `@AC-4` ("outcome is unknown"), and `@AC-3` passes; with the move, `go test ./... -race -count=1` is green service-wide with no existing test edited, coverage total 84.8%, `golangci-lint` v2.14.0 0 issues; the Step 3 edits pass `check-context-map.py` and markdownlint.
- Governance read: constitution, reviewer registry, phase4-deviations, ledger (fails 2026-10-07 `order-time-in-force-enum` ×3, 2026-11-04 `enforce-config-key-wiring`, 2026-11-10 `fix-marketdata-dead-symbol-ingest`, 2026-11-16 ×2; insights 2026-10-07, 2026-11-16). No approval-flow, config-rollout or proto-versioning read: no proto, migration or config change.
- Discovery was done inline (single service, recon.md present); no `codebase-discovery` subagent was spawned.
- Assumptions made by this session:
  - `@AC-1`'s table adds an Alpaca + explicit-UNSPECIFIED row to the three IBKR rows of D-5; basis: step-constraints.md §A broker coverage, and UNSPECIFIED is the only TIF Alpaca refuses.
  - TRADING-7's Why cell gains one clause on the failure mode; basis: D-6 amends the row and every rule row states its failure mode.
  - The executor needs `golangci-lint` v2.14.0 built with go1.27; the v2.5.0 binary on the session image refuses the module. Basis: observed in this session; 347's execute sessions did the same install.
  - No PARTIALLY_FILLED test case; basis: the status gate is above the moved block and unchanged, and the scenarios name a NEW order.
- Open threads (unchanged from design): stranded pre-fix intent rows are not repaired; D-3 is to be flagged to the operator in the integration PR.
