# Context: notify-external-fanout  (archived 2026-08-26)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-26 — /sdd-archiver

**What**: Shipped a best-effort Slack-webhook + SendGrid-email fanout side-channel bolted onto `emitAlert`, gated by a hybrid **severity-primary + conviction-floor-when-present** rule — *not* the `context.confidence` gate the original spec described (no producer writes that key). Credentials are redeploy-only `type: SECRET` env vars (no runtime rotation); by default it does **not** fan out the INFO fill-confirmations the story headlined (`notify.fanout.min_severity` default = WARNING/2).

**Why (irrecoverable rationale)**: The gate was re-grounded because a survey of all five `EmitAlert` producers showed none write `context.confidence`; only analysis writes a flat `conviction` (an ordinal readiness fraction, not a probability), and trading/marketdata/portfolio write no context at all — gating literally would have shipped a 100%-inert feature. The hybrid deliberately does **not** fail-closed when conviction is absent: severity alone decides, so context-less trading alerts still fan out.

**Rejected alternatives**:
- First-class `confidence`/`symbol`/`action` proto fields + populate every emitter — lost: proto change (C-09, 2-owner) + all-five-emitter edits was far larger than a hybrid gate.
- Dedup on `alertId` — lost: it's a fresh uuid per call, so a genuine re-fire never collides.
- Dedup key excluding title/body (a round-1 steer, later reversed) — lost: context-less CRITICAL trading alerts (reconciliation/approval/fill) carry no other identity, so excluding title/body collapsed genuinely distinct alerts.
- Credentials as config keys (original spec, one using the retired `secret.*` prefix) — lost *at the time* because feature 076 had reversed the `is_secret` config-secret mechanism, so env vars were the only compliant path. **This reason later expired** (see cross-feature).

**Scars & gotchas**:
- Isolation depends on dispatching **after** the success callback via `queueMicrotask`, not merely on a try/catch — `dispatch`'s synchronous prefix (gate read, Map sweep, dedup insert, payload build) could throw onto an already-succeeded emit (`notifyServiceImpl.ts:95`).
- Conviction is read as a **flat** Struct key pinned to `live_loop.py`'s exact key name; a future emitter writing conviction under a different key would silently never trip the floor (covered by a red-before-green test).
- `/context-scrubber` teardown could NOT run — the context-forge plugin was absent from the session; noted in the PR body rather than skipped silently.

**Permanent deviations**:
- Story "never miss a fill confirmation" → shipped `min_severity` default = WARNING(2), which excludes INFO fills → operator accepted at the round-2 gate that fills flood the channel; capturing them is explicit opt-in (`min_severity` → 1). Without this note the default reads as a bug.
- Design/spec said config migration **017**, env `dev`, `trading_mode` column → shipped migration **018**, env `staging`, no `trading_mode`, `ON CONFLICT (namespace,key,environment,COALESCE(user_id,''))` → feature 147 landed first, took 017, renamed the env, and dropped `trading_mode` from `config_values`.
- FR-4 "runtime credential rotation, no redeploy" → shipped redeploy-only env-var credentials → config-key credentials were forbidden at spec time (owner-approved scope reduction).

**Cross-feature signal**: Credential-storage whiplash across 076 → 020 → 147: feature 020 gave up runtime credential rotation and moved Slack/SendGrid to env vars **because feature 076 had reversed** the config-secret (`is_secret`) mechanism. Feature 147 then **rebuilt** that exact mechanism (AES-256-GCM encrypted config rows + `GetSecret` RPC) and moved Alpaca/FMP/Finnhub back into config. Net: `SLACK_WEBHOOK_URL`/`SENDGRID_API_KEY` are now the only vendor credentials in the platform still living as plain env vars — the reason 020 declined config storage no longer holds.

**Deferred follow-ons**: (1) Migrate `SLACK_WEBHOOK_URL`/`SENDGRID_API_KEY` into feature 147's `is_secret`/`GetSecret` encrypted-config path to restore the FR-4 runtime-rotation capability 020 traded away. (2) A Redis/DB-backed dedup store — the in-memory `Map` dedup was a deliberate V1 choice; a persistent store is an explicit follow-on if dedup must survive restarts. (No tickets; forward pointers only.)

**Ledger entries written**: insights.md (2), fails.md (1) — see the 2026-08-26 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: none (the credential arc and the `min_severity` default are feature-decision memory, not platform invariants).
**Scenario promotion (C-16)**: all 9 `@AC-*` promoted to `services/xstockstrat-notify/acceptance/notify-external-fanout.feature` (new suite).
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 996210e4.
