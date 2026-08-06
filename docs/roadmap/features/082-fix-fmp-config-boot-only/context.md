# Context: fix-fmp-config-boot-only  (archived 2026-08-06)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-06 — /sdd-archiver

**What**: `xstockstrat-marketdata` built its FMP fundamentals client once at boot, gated by a one-shot `GetBool` read, while the actual per-RPC enable check (`fundamentalsEnabled()`) was already live-correct — the bug was in client *construction*, not the flag read. Shipped fix: always construct the client at boot (extracted `newFundamentalsSource`), let the pre-existing live gate do all the enabling/disabling.
**Why (irrecoverable rationale)**: Design settled the triage-flagged "poll vs. callback" question by confirming `config.Watcher` exposes no push/Subscribe mechanism at all (recon.md Risks) — poll-on-every-call wasn't a preference, it was the only option that existed. Acceptance proof was deliberately composed from three narrower facts (non-nil canary + inspection-verified one-line passthrough + toggle test) rather than one true end-to-end test, because the faithful integration test would require either real outbound HTTP to FMP or new fake-gRPC-server plumbing — judged disproportionate for a SEV-2 config-read fix (design.md § Chosen Approach point 5, § Rejected Alternatives).
**Rejected alternatives**:
- Lazy-construct-on-first-live-flip — needed a `sync.Once`/mutex race guard for no extra test coverage (design.md:85-89).
- Plain always-construct with no extraction (round-1 proposal) — its test bypassed `main.go` entirely, so it'd pass identically whether the fix was applied or not, failing C-08/P-06 (design.md:90-93).
- Threading the real `fmp.Client` into the live-toggle test — would make a unit test hit real FMP HTTP or need new fake-transport plumbing (design.md:94-98).
- Giving `newFundamentalsSource` a small config interface instead of the concrete `*config.Watcher`, to sidestep the zero-value-struct test trick — considered but not required: the zero-value `*config.Watcher{}` was directly verified safe (GetString/GetBool touch only `w.mu`, a usable zero-value `sync.RWMutex`, and `w.snapshot`, a nil-map read returning `ok=false`), so the simpler concrete-type signature won with a one-line test-comment citation rather than adding an extra interface type for a two-key read (design.md:99-105).
**Scars & gotchas**:
- Harness session branch silently diverged from the feature's actual SDD dev branch for four full skill phases, caught only when `/sdd-execute` tried `git show origin/feature/...:implementation-spec.md` and got a not-found (context.md § Session 2026-07-30 /sdd-execute sequential). [DUP: fails.md:224]
- Sequential-mode stacked step-PRs never auto-retargeted because step branches were never deleted post-merge — two of three steps' PRs merged into the wrong intermediate branch, invisible until `/promote`'s state validation caught `main-dev` missing tests+docs despite the feature reading `code-completed` (context.md § Session 2026-07-30 /promote). [DUP: fails.md:248]
**Permanent deviations**: none — implementation matched design.md; only trivial line-citation drift (960→966) from Step 1's own comment insertion (implementation-spec.md Deviation Log).
**Cross-feature signal**: none beyond the two already-ledgered branch/PR-topology fails.
**Deferred follow-ons**:
- product-spec.md Out of Scope: other `cfgWatcher.GetBool`-at-boot reads elsewhere in the codebase were never audited for the same shape — file separately if found.
- `xstockstrat-analysis`'s `screener.py:132-149` silently degrades any RPC failure (including this bug's symptom) to a neutral score with no coverage-gap signal — flagged for the analysis owner's awareness, intentionally not fixed here.
**Ledger entries written**: insights.md (0), fails.md (0) — see the 2026-08-06 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none — the `config.Watcher` poll-only/no-Subscribe fact is already captured in `services/xstockstrat-marketdata/docs/context-constitution.md:46` (updated by Step 3) and recon.md (to be deleted, but the invariant lives on in the constitution doc).
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at f871138.
