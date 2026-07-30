# Context Log: fix-fmp-config-boot-only

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-07-30 (/sdd-triage)

- Bug surfaced live, not from a report: while resuming the staging paper-trading setup, flipped
  `marketdata.fmp.enabled=true` and `analysis.fundsignal.enabled=true` via the new `set_config` MCP
  tool (feature 073, confirmed working — real per-user role auth). A real `FMP_API_KEY` DO secret
  was already present on `xstockstrat-marketdata` (feature 076). Despite both prerequisites met,
  `screen_symbols` kept returning flat neutral scores for a `SCREEN_KIND_FUNDAMENTAL` criterion on
  AAPL/MSFT — identical to the pre-flip state.
- Delegated a codebase-discovery agent to explain the discrepancy; confirmed root cause:
  `cmd/server/main.go:111-121` reads `marketdata.fmp.enabled` once at boot to decide whether to
  construct the FMP client at all — a live config flip afterward is invisible to the running
  process. `xstockstrat-analysis`'s `screener.py` swallows the resulting `FailedPrecondition` into a
  silent neutral score (`_fetch_fundamentals` → `{}, False` → weight_total 0 → score 0.5), which is
  why the symptom looked identical to "not yet enabled" rather than an obvious error.
- Severity: **SEV-2** — matches the bug-triage indicator "Config value propagation is delayed or
  missing for a non-critical key" exactly. Not SEV-1: no trading impact, no financial risk, no
  approval-flow bypass — purely a staging/dev operability gap (a flag flip silently requires a
  restart nobody is told about).
- Environment: observed on `dev`/staging (`xstockstrat-staging`). The same code is presumably
  shared with production, but not independently confirmed broken there this session — per
  `docs/runbooks/bug-triage.md` routing table, SEV-2 + dev/local environment → **Track C** (no
  Track A hotfix branch needed).
- Routed to SDD path (Track C), same adaptation as features 067/074: **no GitHub issue** (Issues
  disabled on this repo), captured directly from live observation + code recon.
- Created: feature.md, product-spec.md, context.md.
- Affected services: `xstockstrat-marketdata` (primary — the boot-only read).
  `xstockstrat-analysis`'s silent-degrade behavior is noted for reviewer awareness but explicitly
  out of scope (a separate, seemingly deliberate graceful-degradation pattern, not part of this
  bug).
- Recommended design depth: **quick** → `/sdd-design fix-fmp-config-boot-only quick` (SEV-2, single
  primary service, root cause already fully confirmed by recon — not "under investigation" — no
  proto/migration/config-key change anticipated. Below the "full" threshold per
  `docs/runbooks/bug-triage.md` § C-0, above "skip" since a live-toggle test needs a small design
  decision: poll the watcher on every call vs. register a callback that rebuilds the client).
- Development branch: `feature/fix-fmp-config-boot-only` (not yet created — triage stops here per
  the skill's own gate, awaiting the human to trigger `/sdd-design`).
- **Immediate operational workaround** (not a code fix, just unblocks staging right now): the
  in-flight PR wiring `FMP_API_KEY` through the deploy workflows
  (`docs/roadmap/features/073-mcp-config-management/` follow-on work, same session) will, once
  merged, trigger a real `xstockstrat-marketdata` redeploy on the next `main-dev` push — which
  incidentally restarts the process and picks up `marketdata.fmp.enabled=true` at boot, unblocking
  fundamentals without needing this bug's fix first. That merge still requires
  `DEV_FMP_API_KEY`/`PROD_FMP_API_KEY` to be added as real GitHub Actions secrets beforehand (see
  that PR's notes) — otherwise the deploy would overwrite the already-live real FMP key with an
  empty string.

## Session 2026-07-30 (/sdd-review product-spec)

- Product spec approved. Status: draft → spec-ready.
- Verdict: PASS WITH WARNINGS (spec-reviewer) + CLEAN (feature-overlap, no shared config
  key/proto field/migration NNN collision with any in-flight feature; 076/080 share
  `xstockstrat-marketdata` but touch disjoint lines, already landed).
- Warnings: 1 — "xstockstrat-staging" read as a third deploy tier by a reader relying only on
  product-spec.md (context.md already clarified dev=staging, but the spec itself didn't). Fixed
  in the same session: product-spec.md Problem Statement now states explicitly this is the
  `main-dev`/dev DO app, no separate staging tier (root CLAUDE.md § CI/CD has only main-dev/main).
- Overlap findings: none blocking.

## Session 2026-07-30 (/sdd-design)

- Phase 0 Recon: wrote recon.md (service: xstockstrat-marketdata). Key finding: `config.Watcher`
  has no push/callback mechanism (poll-only getters) — this settled the "poll vs callback" design
  question flagged at triage in favor of poll-on-every-call, matching the existing pattern already
  used by `fundamentalsEnabled()`. FMP client confirmed stateless/cheap (safe to always-construct).
- Phase 1 Grilling: 2 rounds (quick mode mandated 1; user asked for a second). Round 1's adversary
  caught that the originally proposed test bypassed `main.go` entirely (would pass whether or not
  the fix was applied — C-08/P-06 gap, matching this feature's own recon-cited fails.md traps).
  Round 2 made the design concrete (extracted `newFundamentalsSource` function in main.go) but its
  adversary caught the same class of gap recurring in the concrete test plan (the live-toggle test
  still didn't connect to the real extracted function) plus a doc-drift miss
  (`docs/context-constitution.md:46` citing the line that stops gating anything post-fix).
- Chosen approach: always-construct-at-boot via an extracted, unconditionally-called
  `newFundamentalsSource` function; `fundamentalsEnabled()`'s live per-RPC gate unchanged; test
  proof composed from three parts (non-nil canary + one-line passthrough at
  `marketdata_service.go:101`, verified by inspection + live-toggle test proving the gate given a
  non-nil source) rather than a single network-dependent integration test. Both `CLAUDE.md` and
  `docs/context-constitution.md` corrected in the same PR.
- Rejected: lazy-construct-on-first-live-flip (needless concurrency guard); plain always-construct
  with no extraction (untestable at the actual bug site); threading the real `fmp.Client` into the
  live-toggle test (would make a unit test hit real FMP HTTP).
- Constitution rules touched: C-08, P-06, C-05, F-07, C-10, P-03. Floor breaches: none across
  either round.
- Open risks carried forward to /sdd-spec: (1) zero-value `*config.Watcher{}` test trick relies on
  an unwritten "safe zero value" contract — mitigate with a citing comment, watch if `Watcher`
  changes; (2) no test covers `main.go:123`'s wiring into `NewMarketDataService` end-to-end
  (requires real gRPC dials) — accepted as out of scope, named explicitly.
- Status: spec-ready → design-approved.

## Session 2026-07-30 (/sdd-spec)

- Generated implementation-spec.md with 4 steps. Status → implementation-ready.
- Key codebase findings (all re-confirmed by direct Read against recon.md, no drift found):
  - `main.go:104-123` boot-only gate confirmed byte-for-byte as recon described; extraction target
    is the `if cfgWatcher.GetBool("marketdata.fmp.enabled", false) { fundamentalsSrc =
    fmp.NewClient(...) }` block, replaced by an unconditional `newFundamentalsSource(cfgWatcher,
    cfg.FMPAPIKey)` call placed next to `looksLikePlaceholderCred` (`main.go:173-184`), matching
    that function's existing extracted-boot-helper pattern.
  - `fundamentalsEnabled()` (`marketdata_service.go:957-964`) is genuinely unchanged in logic — the
    step only rewords its doc comment to mark the `s.fundamentals == nil` half as defensive-only.
  - Zero-value `*config.Watcher{}` safety for the canary test re-verified directly against
    `internal/config/config.go:56-68,100-153`: `GetString`/`GetBool` touch only `w.mu` (safe
    zero-value `sync.RWMutex`) and `w.snapshot` (nil-map read → `ok=false`); `w.ready`/`w.once` are
    untouched — matches design.md's Open Risk note, not contradicted.
  - `docs/context-constitution.md`'s citation to update is exactly line 46 (confirmed via grep):
    `"FMP gated by marketdata.fmp.enabled... | cmd/server/main.go:110, internal/source/source.go:57
    |"` — `internal/source/source.go:57` (the `FundamentalsSource` interface) is untouched by this
    fix and stays in the citation; only the `cmd/server/main.go:110` half is replaced with
    `internal/service/marketdata_service.go:960`.
  - Both `cmd/` and `internal/service/` are excluded from the Go `COVERPKGS` coverage measurement
    (`.claude/skills/sdd-spec/reference/spec-template.md` coverage table) — the test step notes no
    coverage-percentage threshold applies; test-pass verification is the gate instead.
  - Reviewers table finalized to the two step categories that actually exist in this spec
    (`service`/`test` → xstockstrat-marketdata owner, `docs` → none); the design-phase
    `xstockstrat-analysis` awareness note (screener's silent-degrade behavior, out of scope) was
    preserved as a non-step "Awareness note" in `feature.md` rather than dropped, since it isn't
    tied to any step in this spec but is still institutionally useful.

## Session 2026-07-30 (/sdd-review impl-spec)

- Advisory review (Mode B, never blocks): criteria PASS WITH WARNINGS (0 blockers, 3 warnings),
  overlap CLEAN (no other feature at implementation-ready/in-progress; 076/080 already merged to
  trunk, confirmed not an open collision).
- Warnings fixed in the same session (spec edited before /sdd-execute dispatch, per F-09 — step
  bodies are only frozen once execution starts):
  1. Step 1 extended with instruction 4 — two more stale comments in
     `marketdata_service.go:49,75` (both claim `fundamentals` is nil when the flag is false)
     updated alongside the already-planned `fundamentalsEnabled()` comment change, since the file
     was already in Step 1's `**Files**` list. Added a matching grep to Step 1's Verification.
  2. Step 2's Codebase Evidence corrected: `marketdata_service.go:101` is a struct-literal field
     (`fundamentals: fundamentals,`) not an assignment statement — line/semantics were already
     correct, only the quoted syntax was off.
- Third warning (Step 2 verification has no literal numeric coverage threshold) left as-is — the
  cited `COVERPKGS` exclusion is a substantive justification, not a real gap.
- Next: `/sdd-execute fix-fmp-config-boot-only`.

## Session 2026-07-30 (/sdd-execute sequential)

- Branch-topology fix before execution began: the feature's actual `**Development Branch**`
  (`feature/fix-fmp-config-boot-only`, created by `/sdd-triage`) only carried the original triage
  commit — none of this session's product-spec review, recon, design, or impl-spec work, which had
  all landed on the harness-assigned `claude/082-design-implement-7638at` instead. Confirmed the two
  branches' feature-dir content was byte-identical at the point they diverged (a squash-merge gave
  the triage commit two different hashes on `main-dev` vs. the feature branch); resolved with a
  non-destructive merge (conflicts on `context.md`/`feature.md`/`product-spec.md`, resolved by
  keeping the fully-progressed HEAD side) then fast-forwarded `feature/fix-fmp-config-boot-only` to
  match — no history rewritten, no force-push.

### Step 1 — service: always construct the FMP fundamentals client at boot [done]
- Phase 1 discovery: all 7 cited symbols/lines re-confirmed exact via codebase-discovery agent, no
  drift from implementation-spec.md.
- TDD (red→green): temporarily added `TestNewFundamentalsSource_AlwaysNonNil` to `main_test.go` to
  capture RED — `cmd/server/main_test.go:41:10: undefined: newFundamentalsSource` (compile error,
  correct reason). Implemented Step 1 (extracted `newFundamentalsSource` in `main.go`, replaced the
  boot-time `if` gate with an unconditional call; updated the 3 doc comments in
  `marketdata_service.go` — the two stale ones caught by `/sdd-review impl-spec` plus
  `fundamentalsEnabled()`'s). Re-ran the same test — GREEN (PASS). Then discarded the temporary test
  file edit (`git checkout --`) since `main_test.go` is Step 2's file, not Step 1's (F-08) — the
  real canary test lands for real in Step 2's own commit.
- Verification: `go build ./...` OK; `golangci-lint run` 0 issues; `GetBool("marketdata.fmp.enabled"...)`
  grep in `main.go` → zero hits; stale-comment grep → zero hits; full
  `grep -rn "marketdata.fmp.enabled"` confirms the only remaining `.go` gate is
  `marketdata_service.go:966` (`fundamentalsEnabled()`), as designed.
- Files modified: `services/xstockstrat-marketdata/cmd/server/main.go`,
  `services/xstockstrat-marketdata/internal/service/marketdata_service.go`.
- Deviations: none.
