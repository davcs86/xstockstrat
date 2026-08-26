# Context Log: fix-fundamentals-signal-producer  (archived 2026-08-26)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-26 — /sdd-archiver

**What**: A SEV-2 Track-C bug — the fundamentals producer slept *before* its first `run_once` and kept no persisted schedule, so every `main-dev` redeploy (deploy-dev rebuilds the whole app) reset the sleep and deferred the first cycle indefinitely. On explicit operator steer the fix was expanded far past the bug into a multi-service feature: a durable crash-safe schedule row (`019_fundsignal_schedule`), two config keys (startup jitter, retry cadence), plus an MCP tool + config-ui admin card wrapping the *pre-existing* `RunFundamentalsScan` RPC. Shipped as PR #1014; the scope expansion is recorded per C-11/principle #2.

**Why (irrecoverable rationale)**: The load-bearing choice was **write next-due only AFTER a cycle completes**, not a CAS pre-run lease. At `instance_count:1` the lease's only benefit (cross-process fencing) is unreachable (the in-process `asyncio.Lock` already prevents overlap) while its cost is real and backwards: leasing before the run wedges a crashed schedule for the full `LEASE_HOLD` (~1h) — the exact failure a scheduler must recover from. Write-on-completion leaves a crashed schedule in the past → restart is immediately due. `process_name`/`blocked_until_ms` columns were kept only as diagnostics/forward-fence per operator request.

**Rejected alternatives**:
- Full CAS distributed lease + `LEASE_HOLD` + polling — lost: unused fencing at instance-count-1, *worsens* crash recovery, poll turns a zero-DB sleep into write-churn.
- `MAX(finished_at)` catch-up — lost: `_finish` writes `finished_at` identically for scheduled, manual, and dry-run cycles, so cadence is contaminated with no inline predicate to separate them.
- No-table pure run-then-sleep — genuinely sufficient for the *bug* (the `fundsignal_emitted` PK already makes a restart a zero-emit no-op), lost only because the operator wanted a durable row.
- `retry` as a code constant — lost: promoted to `analysis.fundsignal.retry_seconds` so it's operator-tunable mid-incident.
- UI control in /insights — lost: /insights AnalysisService is owner-scoped (`forward`, feature-133); an admin mutation belongs in /config-ui.

**Scars & gotchas**:
- **`PLATFORM_SUBNAV` is dead code** — the spec and prior ledger cited it as THE config-ui nav surface, but `PlatformHeader` renders `NAV_GROUPS`; registering there produced an unreachable page that passed lint+tsc locally and failed ONLY the CI nav-reachability e2e shard. Fix moved the entry to the Settings group in `navGroups.tsx` and reverted the inert `PLATFORM_SUBNAV` edit (D-3).
- **config-ui e2e mock port trap**: the config-ui BFF `analysisClient` dials `ANALYSIS_ENDPOINT` which in e2e resolves to **9092** (the insights mock), so the `runFundamentalsScan` mock handler had to go on the port-9092 `AnalysisService` block in `mock-backend.ts`, NOT the 9093 config-ui block.
- Playwright never ran locally (pinned browser absent) — verified via lint+tsc+structural only, e2e deferred to CI; the nav bug above is exactly what that gap let through.

**Permanent deviations**:
- spec said register nav via `PLATFORM_SUBNAV` → shipped via `NAV_GROUPS` (Settings group, `navGroups.tsx`) → because `PLATFORM_SUBNAV` is legacy/ignored and only the CI e2e caught it (D-3).
- design/spec said clock math would use SQL `now()` → shipped a single Python `datetime.now(UTC)` clock → because it's a spec-permitted alternative and safe at `instance_count:1`.

**Cross-feature signal**: This feature's `DurableSchedule` seams (`seed`/`next_sleep_seconds`/`advance`) and its no-lease reasoning became the seed for **158-durable-loop-scheduler**, which generalized the mechanism across loops and explicitly "builds on the 156 no-lease insight" (insights.md:2143). 158's added lesson: NOT every loop earns a durable row (a ~60s `live_loop` gains nothing) — pressure-test the actual interval first. The nav-registration failure mode recurs across UI features (058/060, fails.md:69-71 C-10(a)); 156 applied the reachability *test* but tripped on the surface having since moved PLATFORM_SUBNAV→NAV_GROUPS.

**Deferred follow-ons**: **Post-merge action still pending**: revert staging `analysis.fundsignal.run_interval_hours` from the `1` stopgap back to `24` now the fix has landed. The **144 neutral-fallback twin** at `fundsignal_loop.py:294` (`_builtin_score`, the `x/n if n else 0.5` magic default, fails.md:1829-1833) is STILL unfixed — 156 rewrote `run_forever` in the same file but the twin was out of scope; a future toucher of this file should sweep it.

**Ledger entries written**: insights.md (0), fails.md (1) — see the 2026-08-26 entry. (The single-instance durable "next-due after completion" scheduler design was already recorded at insights.md:2101; the /sdd-spec-on-harness-branch fail at fails.md:255.)
**Runtime-invariant recommendations (→ /context-constitution)**: none (the `PLATFORM_SUBNAV`-is-dead / `NAV_GROUPS`-is-live fact is a UI-nav routing fact worth a doc-drift fix, not a runtime contract).
**Scenario promotion (C-16)**: all 9 `@AC-*` were already promoted at launch to the analysis/agent/ui suites — nothing new to write (idempotent).
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 996210e4.
