# Context Log: fix-fundamentals-signal-producer

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-08-25 (/sdd-triage)

- Bug reported via defect report `docs/reports/2026-08-25-fundsignal-first-cycle-resets-on-redeploy-defect.md`
  (GitHub Issues disabled on this repo — filed as a report, no issue number to close).
- Severity: SEV-2. Config-only fix possible: no. Impact type: behavior-correctness.
  Environment: dev / staging (and production under promotion-driven redeploys).
- Routed to SDD path (Track C): SEV-2 with environment dev/staging → Track C.
- Created: status.md (`draft`), feature.md, product-spec.md, acceptance.feature (2 regression
  scenarios), context.md.
- Affected services (from report): xstockstrat-analysis (fundamentals signal producer, feature 062 / 154).
- Root cause hypothesis: `fundsignal_loop.py:98-100` sleeps before the first `run_once` and keeps no
  persisted schedule; `deploy-dev.yml` redeploys the whole app on every `main-dev` push, so each
  restart resets the sleep and the first cycle is deferred indefinitely.
- Recommended design depth: **quick** → `/sdd-design fix-fundamentals-signal-producer quick`
  (rationale: SEV-2, single service, no proto/migration/config-key change; too small to debate in
  full, too risky — a scheduling change to a live producer — to skip design entirely).
- Development branch: feature/fix-fundamentals-signal-producer.
- Feature number: 155 (max existing NNN = 154 + 1; note 153 is a duplicated prefix in the tree
  — `153-fix-ohlcv-chunk-lock-oom` and `153-ui-auth-improvements` — but max is still 154).

### Related operational state (carried from the discovery session, not part of the fix code)

- Stopgap already applied in **staging**: `analysis.fundsignal.run_interval_hours` set to `1`
  (config version `1787692710368`, 2026-08-25) so each fresh process fires within ~1h of startup
  despite deploy churn. This is a mitigation, not the fix. **Revert to `24` once the fix lands**
  (a config action, tracked here — out of scope for the code change).

## Session 2026-08-25 (/sdd-design quick — round 1 + operator steer)

- Phase 0 Recon written (recon.md): single service (xstockstrat-analysis), boot-timing bug in
  `fundsignal_loop.run_forever`. Key reuse: persisted-column + boot-hydration precedent
  (`hydrate_cooldowns`/`hydrate_scores`); existing `fundsignal_emitted` PK idempotency guard makes an
  eager boot run a no-op.
- Round 1 debate: proposer chose Option B (persisted `MAX(finished_at)` catch-up + `_tick()` seam);
  adversary returned NEEDS WORK — no Floor breach, but flagged (a) dry_run/manual-scan contamination of
  `finished_at` (schedule can't tell a real emitting cycle from a dry-run), (b) an unsafe "return 0 on
  any exception → hot-loop" branch, (c) transient-failure defers a full interval (no short retry),
  (d) preferred Option A (run-then-sleep) as the minimal fix since the idempotency guard already
  prevents duplicate emission. C-16 gap noted: analysis has no acceptance suite (no regression net).
- **OPERATOR STEER (expands scope beyond the bug fix — recorded per C-11/principle #2):** the user
  directed adding, on top of the boot-timing fix:
  1. a **DB-backed distributed lock layer** (`process_name`, `blocked_until_ms`) — a lease/lock row so
     only one instance runs a cycle and the schedule is durable + contamination-free (the scheduler
     owns next-due, independent of `run_once`'s `finished_at`);
  2. **startup jitter** to stagger concurrent boots;
  3. **manual override/trigger of runs via UI and MCP**.
  This turns the change from a single-service bug fix into a multi-surface feature (new migration for
  the lock table; likely a new `analysis.fundsignal.*` config key for jitter; consumer surfaces on
  `xstockstrat-agent` (MCP tool) and `xstockstrat-ui` (trigger control), C-14). Running targeted recon
  on the manual-trigger surfaces + a distributed-lock precedent scan, then round 2 on the expanded design.

## Session 2026-08-25 (/sdd-design — round 2 + approval)

- Targeted recon (2 subagents): manual-trigger surfaces + distributed-lock precedent.
  - `RunFundamentalsScan` RPC **already exists** (admin-scoped, `force`/`dry_run`/`symbols`) → MCP/UI
    are wrapper-only, **no proto change**. No MCP tool / UI control exists yet (both greenfield).
  - **No lock/lease pattern exists anywhere** in the platform (greenfield). Analysis is
    `instance_count: 1` (both `.do` specs, single compose container) → a *distributed* lock is not
    required for correctness; in-process `asyncio.Lock` already prevents overlap. Closest durable
    precedent: `analysis.ledger_stream_cursor` self-seed upsert. New migration = `019`.
- Round 2 debate on the expanded design (proposer: CAS lease + `LEASE_HOLD` + polling; adversary:
  NEEDS WORK — no Floor breach, but the lease is YAGNI at instance-count-1 AND *worsens* crash
  recovery (~1h wedge because it leases before running), plus undefined poll floor = write-churn).
- **Gate decisions (operator, via AskUserQuestion):**
  1. **Lock scope → "Durable schedule, crash-safe"**: keep the requested `blocked_until_ms` +
     `process_name` columns (migration `019 analysis.fundsignal_schedule`), but write next-due
     **only after a run completes** (crash leaves it due → restart re-runs immediately), compute-
     sleep-until-due (no polling), drop the CAS/`LEASE_HOLD`. In-process `_lock` retained;
     `process_name` kept as a diagnostic / forward fence field, not relied on.
  2. **Retry cadence → config key**: `analysis.fundsignal.retry_seconds` (default 300), `get_int_present`.
- Chosen approach (design.md): durable crash-safe schedule row + startup jitter
  (`analysis.fundsignal.startup_jitter_seconds`, default 30) + retry config key; surface the existing
  `RunFundamentalsScan` via a new agent MCP tool (`run_fundamentals_scan`, forwards derived caller
  scope, backend admin gate) and a new **/config-ui** admin card (register only that one RPC on
  `configUiBff.ts` via `forwardAdmin`; nav-reachable, C-10(a)).
- Rejected: full CAS lease (crash-worsening, unused fencing); `MAX(finished_at)` catch-up
  (dry-run/manual contamination); no-table run-then-sleep (sufficient for the bug but the operator
  wanted a durable row); UI in /insights (owner-scoped surface, wrong trust boundary).
- Constitution: C-05/C-07/C-08/C-13/C-14/F-01/F-06/F-07/P-03 touched, all honored. **No Floor breach.**
- Business rules (C-16): analysis has no acceptance suite → net-new `@AC-1..9`, no regression; promote
  into a new `services/xstockstrat-analysis/acceptance/fundsignal.feature` at launch.
- Open risks carried: disabled-window re-check latency; `_finish`→`RunFundamentalsScanResponse` field
  mapping; clock-source consistency (all → `/sdd-spec`).
- **Scope note:** this is now a multi-service *feature* (analysis migration + 2 config keys + agent
  MCP + config-ui), well beyond the original Track-C bug fix, on explicit operator direction.
- Status: draft → design-approved.
