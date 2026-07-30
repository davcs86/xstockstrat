# Design: fix-fmp-config-boot-only

**Created**: 2026-07-30
**Rounds**: 2 (quick; mandated minimum was 1; termination: approved)
**Approved by**: user @ 2026-07-30
**Grounded in**: recon.md

---

## Chosen Approach

`xstockstrat-marketdata`'s FMP fundamentals client stops being gated at construction time and is
instead **always constructed at boot**, with the existing live per-RPC flag read as the sole gate.

1. **`cmd/server/main.go`** — extract the FMP-client construction out of the
   `if cfgWatcher.GetBool("marketdata.fmp.enabled", false) { fundamentalsSrc = fmp.NewClient(...) }`
   wrapper (`main.go:111-121`, recon.md Codebase Map) into a new unexported function
   `newFundamentalsSource(cfgWatcher *config.Watcher, apiKey string) source.FundamentalsSource`,
   placed in the same file next to the existing `looksLikePlaceholderCred` boot-helper
   (`main.go:173-186`) — this file's established pattern for pulling boot logic into a
   unit-testable, unexported function (verified via `main_test.go`'s existing
   `TestLooksLikePlaceholderCred`). The function keeps reading the non-secret knobs
   `marketdata.fmp.base_url` / `marketdata.fmp.metrics` (`main.go:113,118`) but drops the
   `GetBool("marketdata.fmp.enabled", ...)` read entirely — there is no `enabled` parameter, so
   there is structurally no gate left to bypass. Called **unconditionally** from `main()`,
   replacing the `if`-wrapper; `fundamentalsSrc` is always non-nil by the time it's passed into
   `service.NewMarketDataService(...)` (`main.go:123`, unchanged call site/signature).
2. **Boot-log preserved, reframed** — the deleted `slog.Info("FMP fundamentals source enabled")`
   (`main.go:120`) is replaced with a neutral, always-emitted line (e.g.
   `slog.Info("FMP fundamentals client constructed", "base_url", ..., "metrics", ...)`) so an
   operator debugging boot wiring doesn't lose the one signal that `FMP_API_KEY`/`base_url`/
   `metrics` were read at all — a distinct question from "is it enabled," which is now answered
   only per-RPC.
3. **`internal/service/marketdata_service.go`'s `fundamentalsEnabled()` (`:957-964`) is
   byte-for-byte unchanged** — its live `s.fundCfg.GetBool("marketdata.fmp.enabled", false)` read
   (`:960`) was already correct (recon.md Codebase Map: "the correct, already-live half"); recon
   confirmed `config.Watcher` exposes no push/callback mechanism (recon.md Risks), so poll-on-every-
   call — the pattern already used here and by the warm-quote/bar-ingest pollers
   (`xstockstrat-marketdata/CLAUDE.md:59-60`, recon.md Patterns to REUSE) — is the only
   reuse-consistent option, not a new mechanism to invent.
4. **`s.fundamentals == nil` guard kept, re-documented as defensive-only.** After this fix it is
   unreachable via the current sole call path (`main.go`'s only call to
   `NewMarketDataService` always supplies a non-nil source) — the comment states this explicitly so
   it is never miscounted as acceptance-criteria coverage, resolving the "guard that cannot fail"
   ambiguity (fails.md 2026-07-26/071, cited in recon.md Risks) instead of leaving it open.
5. **Test proof — composed from three parts, not one integration test:**
   - `cmd/server/main_test.go` — new `TestNewFundamentalsSource_AlwaysNonNil`: a **regression
     canary** proving the extracted function returns non-nil regardless of `apiKey`/config state
     (there is no `enabled` axis left to vary — this guards against someone re-adding a
     conditional at this call site, not the primary acceptance proof).
   - `internal/service/marketdata_service_test.go` — new `TestGetFundamentals_LiveToggle_NoRestart`,
     reusing the existing `fakeCfg`/`fakeFundSource` doubles (`marketdata_service_test.go:229-269`)
     and the call-count-assertion shape from `TestGetFundamentals_DisabledFailedPrecondition`
     (`:326-339`): start disabled (assert `FailedPrecondition`, zero FMP calls) → flip
     `cfg.bools["marketdata.fmp.enabled"] = true` on the *same* service/cfg object, no restart →
     assert the next call attempts a fetch (exactly 1 call) → flip back to false → assert
     `FailedPrecondition` again with no additional call. This proves `fundamentalsEnabled()`'s live
     gate is correct **given** a non-nil source.
   - **The missing link is a written argument, not a new test**: `s.fundamentals = fundamentals`
     (`marketdata_service.go:101`) is a one-line, unconditional, branch-free passthrough at
     construction. Composed: (always-non-nil, proven by the canary) + (unconditional passthrough,
     trivially correct by inspection) + (live-gate-correct-given-non-nil, proven by the toggle
     test) together cover the full acceptance criteria end-to-end. A network-level integration test
     through `NewMarketDataService` is explicitly **out of scope**: that constructor dials real
     ledger/notify gRPC endpoints, and no existing test in this service calls it directly for
     exactly that reason (confirmed by grep — only the definition and the one `main.go:123` call
     site exist). Standing up fake gRPC servers to close this gap is disproportionate to a SEV-2
     config-read fix.
   - `TestGetFundamentals_NilSourceFailedPrecondition` (`marketdata_service_test.go:379-385`) — kept
     as-is (test body unchanged), comment updated to state it now exercises only the defensive
     nil-guard, unreachable via the current sole construction path.
6. **Docs corrected in the same PR, both clauses/both files:**
   - `services/xstockstrat-marketdata/CLAUDE.md`'s `marketdata.fmp.enabled` config-key row — remove
     "no FMP client is built" (client is now always built); clarify the flag is a live per-RPC gate,
     re-read on every call, taking effect on the next call with no restart.
   - `services/xstockstrat-marketdata/docs/context-constitution.md:46` — its invariant row
     currently cites `cmd/server/main.go:110` as "the gate" for FMP construction; after this fix
     that line no longer gates anything (construction is unconditional). Update the citation to
     `marketdata_service.go:960` and reword to reflect the gate is purely per-RPC, not
     construction-time. Caught by the round-2 adversary — the first proposal's doc-edit list only
     covered the service `CLAUDE.md`, missing this file.

## Rejected Alternatives

- **Lazy-construct-on-first-live-flip** (inject a factory into `NewMarketDataService`,
  construct-and-cache the client on first live-true read) — rejected: keeps the nil-guard
  "meaningful" but requires a `sync.Once`/mutex-style guard against a concurrent first-call race,
  for no additional test-coverage benefit over the extraction approach; more total complexity for a
  config-only bug fix (violates "write the minimum").
- **Plain always-construct-at-boot with no extraction** (round 1's original proposal) — rejected:
  its proposed test bypassed `main.go` entirely via the `newFundSvc` test helper, so it would pass
  identically whether or not the fix was applied — failed C-08/P-06 (a demonstration, not a
  regression proof for this bug).
- **Thread the real `fmp.Client` (from `newFundamentalsSource`) into the live-toggle test** (round
  2 adversary's literal suggested fix) — rejected: would make a unit test perform real outbound
  HTTP calls to FMP's API (or require adding fake-transport injection plumbing that doesn't exist
  today), disproportionate to a SEV-2 fix. Resolved instead via the composed written argument
  (canary + passthrough + toggle test) rather than a network-dependent integration test.
- **Give `newFundamentalsSource` a small config interface instead of the concrete `*config.Watcher`**
  (to avoid the zero-value-struct test trick) — considered but not required: the zero-value
  `*config.Watcher{}` construction was verified safe by direct read of `internal/config/config.go`
  (`GetString`/`GetBool` touch only `w.mu` — zero-value `sync.RWMutex` is usable — and `w.snapshot`
  — nil map read returns `ok=false`; neither touches `w.ready`/`w.once`, so no deadlock risk). Kept
  as the simpler option with a one-line test comment citing this evidence, rather than adding an
  extra interface type for a two-key read.

## Open Risks

- [ ] The zero-value `*config.Watcher{}` construction in `TestNewFundamentalsSource_AlwaysNonNil`
  relies on an undocumented "safe zero value" contract of that type — true today (verified) but not
  a documented guarantee. If `Watcher` later gains a required field, this test could fail in a way
  that looks unrelated to FMP. Mitigated with an explicit test comment citing `config.go:100-153`;
  no further action needed unless `Watcher`'s zero-value contract changes — to be watched at the
  test-writing step, not a blocker.
- [ ] No test exercises `main.go:123`'s wiring of `fundamentalsSrc` into
  `service.NewMarketDataService(...)` end-to-end (would require dialing real ledger/notify gRPC
  endpoints) — accepted as out of scope per the composed-proof argument above; named explicitly so
  it is a reviewed limitation, not a silent gap (P-03). To be surfaced again only if a future defect
  in this exact wiring recurs.

## Constitution Rules Touched

- **C-08** (test-step pairing) — honored: the service step (main.go + marketdata_service.go
  changes) is paired with a test step covering both the extracted-function canary and the
  live-toggle acceptance test, reaching this service's CI coverage threshold.
- **P-06** (red-before-green) — honored: `TestGetFundamentals_LiveToggle_NoRestart` is a genuinely
  new test (not merely bypassing existing code) that will fail if the toggle behavior regresses;
  the round-1 proposal's original test design would have violated this (passed unchanged pre- and
  post-fix) — corrected in round 2's synthesis via the composed-proof argument.
- **C-05** (config key naming/scope) — honored: no change to `marketdata.fmp.enabled`'s name,
  shape, or `<service>.<category>.<key>` format; this fix changes only how the key is read.
- **F-07** (never hardcode config values) — honored: the fix reads `marketdata.fmp.enabled` via the
  live `WatchConfig`-backed `cfgWatcher.GetBool` call, same as before; no value is hardcoded.
- **C-10** (integration completeness across shared/duplicated surfaces) — honored: both doc
  surfaces describing this invariant (`xstockstrat-marketdata/CLAUDE.md` config-key table and
  `docs/context-constitution.md`'s invariant row) are corrected in the same PR, not just one —
  caught by the round-2 adversary as a gap in the round-1 proposal's doc-edit list.
- **P-03** (no silent deviation) — honored: the out-of-scope network-integration-test gap and the
  zero-value-`Watcher` fragility are both named explicitly in Open Risks rather than left implicit.
