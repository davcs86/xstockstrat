# Product Spec: fix-config-keys-drift

**Type**: bug
**GitHub Issue**: n/a — defect report `docs/reports/2026-11-04-config-key-drift-and-subscription-gaps-defect.md`
**Severity**: SEV-2
**Created**: 2026-11-04

---

## Problem Statement

Config fails silently in three ways. In each case a reader quietly falls back to its code default.

1. **Naming drift.** The stored `key` column sometimes embeds the namespace
   (`marketdata` / `marketdata.backfill.batch_size`) and sometimes does not (`marketdata` /
   `alpaca.api_key`). A reader resolves a value only when its getter string equals the raw stored
   key (CONFIG-9). The bare seeds in `analysis`, `ingest` and `ledger` are therefore read by no
   code. For example, staging `fundsignal.enabled=true` is ignored and the producer stays OFF.
2. **Not live.**
   - The agent never subscribes; it does a one-shot `GetConfig` on a fresh channel per call.
   - The UI's `GetConfig` omits `environment`, so production shows staging values.
   - marketdata (vendor clients, provider), analysis (semaphores, executor, provider read), ingest,
     indicators and trading (broker HTTP timeout) cache values at startup.
   - The Python and Go watchers have no keepalive or stall detection. A half-open stream freezes
     the last snapshot, which is what the operator saw in indicators.
3. **Missing seed rows.** About 60 keys read by code have no row, so config-ui cannot show or tune
   them. Conversely, orphan rows that no code reads are still seeded.

Adjacent defects, in scope:
- trading's Go getters do not check the stored type, so a mismatch returns `0`/`""` instead of the
  default. `trading.broker.timeout_ms` is read both as int and as float.
- The Python watchers retry on a fixed 2s delay and reconnect with no delay after a clean EOF (a
  tight loop).

Process root cause:
- C-05 / `config-governance.md` (`<service>.<category>.<key>`) and CONFIG-9 ("NO fixed convention")
  contradict each other.
- The SDD skills only regex-check the format of keys written in spec prose. Nothing gates:
  - seed↔getter key parity,
  - seed `value_type` ↔ getter type,
  - existence of a seed row,
  - live-vs-restart semantics.

## Reproduction Steps

1. Staging config-ui: set `analysis` / `fundsignal.enabled=true`. The fundamentals producer never
   runs, because `fundsignal_loop.py` reads `analysis.fundsignal.enabled`.
2. Set production `platform.trading_state=HALTED` while staging is `ACTIVE`. Production
   `/trader/positions` shows no halt banner.
3. Set `indicators.sandbox.max_concurrent` (once it exists) or any marketdata vendor-client knob.
   Nothing changes until restart.

## Root Cause Hypothesis

There is no single enforced key convention and no gate ties readers to seeds. Readers may cache
config at startup, and watchers lack liveness detection. See the defect report for `path:line`
evidence per service.

## Affected Services

xstockstrat-config, xstockstrat-trading, xstockstrat-portfolio, xstockstrat-marketdata,
xstockstrat-indicators, xstockstrat-ingest, xstockstrat-analysis, xstockstrat-ledger,
xstockstrat-identity, xstockstrat-notify, xstockstrat-agent, xstockstrat-ui.

## Fix Scope

Operator decisions of 2026-11-04 are recorded in `context.md`.

- **Canonical key form: namespace-relative.** The stored `key` never repeats its namespace. The
  fully-qualified name `<namespace>.<key>` is used only in docs, UI display and logs. Enforcement:
  - a DB `CHECK (key NOT LIKE namespace || '.%')`;
  - write-side validation in `SetConfig` / `GetSecret`;
  - every getter literal in every service rewritten to the relative form.

  Rollout must be zero-downtime against old pods that still read full-dotted keys (a transitional
  compatibility mechanism, removed in a named follow-up).
- **Heal: keep current effective behavior.**
  - Where a dead row has a live twin, the row the code actually reads wins.
  - Dead rows with no live twin are dropped and the canonical key is seeded with the code default.
  - Every dropped row is snapshotted to a `premigration` table.
  - The PR lists every discarded stored value that differed from the effective value, so operators
    can re-apply it on purpose.
- **Seed parity.** Every key read by any service gets a seed row in both environments, with a
  `value_type` matching the reader's getter arm and `consuming_service` / `description` filled in.
- **Delete orphans.** Rows that no code reads are deleted, with a snapshot.
- **Everything live.** Every config value takes effect without restart, including:
  - concurrency primitives (semaphores and thread-pool executors resizable at runtime),
  - marketdata vendor clients and `fundamentals.provider`,
  - trading's broker HTTP timeout,
  - analysis's cross-namespace provider read.
- **Agent gets a real `WatchConfig` subscription.**
- **UI `GetConfig` sends the deployment's native `environment`.**
- **Watcher resilience** in all three languages:
  - keepalive,
  - exponential backoff with jitter that resets after a healthy stream,
  - backoff on a clean EOF,
  - detection of a stream that has gone silent.
- **Go getter type-safety** in trading, matching portfolio and marketdata.
- **Guard rails:**
  - a CI gate that fails when a reader's key, its type, or the presence of its seed row diverges
    from the migration-seeded set;
  - C-05, CONFIG-9 and `config-governance.md` collapsed into one convention;
  - SDD skills (`sdd-story`, `sdd-spec`, `sdd-review`, `sdd-execute`, the spec-reviewer and
    codebase-discovery agents) require a full config-key contract for every new key: namespace,
    relative key, type, default, reader site, seed migration.

- Proto changes: possible (e.g. a heartbeat update type or a metadata field). Decided in design.
- Database migrations: yes (`xstockstrat-config`).
- Config key changes: yes (rename/seed/delete across all namespaces).

## Acceptance Criteria

See `acceptance.feature`. Every scenario must fail on the current code (red) and pass after the fix
(Constitution **C-15**). In addition, existing tests pass and the affected services are
smoke-tested on dev.

## Out of Scope

- Changing any config value's *effective* runtime behavior. Exception: the restart→live semantics,
  and the defects listed above.
- Re-applying operator intents stored on dead rows. That is an operator action after deploy, using
  the PR's discarded-values list.
- Removing the transitional key-compatibility mechanism. That is a named follow-up feature, decided
  in design.
