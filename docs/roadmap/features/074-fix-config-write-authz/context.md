# Context: fix-config-write-authz  (archived 2026-08-06)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-06 — /sdd-archiver

**What**: Shipped a fail-closed `ADMIN`-scope gate on `SetConfig` only (not `GetConfig`/`ListKeys`/`WatchConfig`), plus a BFF-side `requireAdminScope` check, plus an unplanned repair of `xstockstrat-config`'s unit-test runner that had been silently executing zero assertions.
**Why (irrecoverable rationale)**: Reads were left ungated because every service boots by dialing `WatchConfig` with no metadata (`configWatcher.ts:29,42-48`), and `WatchConfig`'s first message is a full-namespace snapshot that is a strict superset of `GetConfig` — gating reads while `WatchConfig` stays open is incoherent and gating `WatchConfig` bricks platform startup (design.md:56-63,172-173). "Fail-closed" was scoped explicitly to the `x-access-scope` value, not the network — in-network self-elevation was deliberately left open and unowned (design.md:108-124,186-188). Triage-time: the user was explicitly asked (AskUserQuestion) whether to also lock `platform.maintenance_mode` as an emergency stopgap and chose **skip** — halting all trading over a latent, unconfirmed-exploited gap (found via recon, no evidence of misuse) was judged disproportionate (context.md:27-33). Also asked and answered: branch routing. Per `bug-triage.md` a confirmed SEV-1 on production `main` normally routes to Track A (hotfix off `main`, PR to `main`, platform-lead approval, immediate back-merge); the user chose to route through `main-dev` instead because this session was scoped to a harness-designated branch — severity stayed SEV-1, only the merge path was adapted (context.md:24-38,110-116; feature.md:22 points here).
**Rejected alternatives**:
- grpc-js server interceptor — lost, only 1 RPC needed gating vs 3 that must stay open (design.md:154-162).
- Private static `_hasAdminScope` (mirroring Python) — not independently unit-testable (design.md:163-164).
- Requiring `x-user-id` for `author` — exceeds precedent, breaks AGENT-4, pre-breaks feature 073 (design.md:165-168).
- Hand-built `grpc.Metadata` literal — "consumer-contract theater" (design.md:175-176).

**Scars & gotchas**: `xstockstrat-config`'s unit runner reported "7 pass" asserting nothing [DUP:fails.md:86]. **AC #4/#5 (dev smoke test) was explicitly flagged OUTSTANDING at code-completion** (context.md:230-235; feature.md:59-62) yet CI auto-promoted to `launched` the same day with no session ever recording it ran (context.md:247-251).

**Permanent deviations**: design said `header-propagation.md` documents `x-user-id`-wins -> code (`servicer.py:207-220`) does the opposite -> doc drift, corrected to match code (design.md:44-52).
**Scars & gotchas**: none
**Permanent deviations**: none
**Cross-feature signal**: CI's promotion gate ignores a feature's own outstanding manual ACs. Also: **live unresolved obligation** — this session planned that feature 073's FR-7 (which independently scoped the same gap) be edited at 073's next design/spec session to say "already implemented by 074, verify don't reimplement" instead of duplicating the check; no later session confirms that edit was made to 073's files (context.md:54-63).
**Deferred follow-ons**: dead `propagation.ts` in 4 Node services; stale `integration-test.sh` assertions; non-admin config-ui Edit/Save affordance still live; dev smoke test (AC#4/#5) unverified; **073's FR-7 cross-reference edit unconfirmed**.
**Ledger entries written**: insights.md (1), fails.md (1) — see the 2026-08-06 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none new (self-elevation already owned by `context-constitution-findings.md:37`).
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at f871138.
