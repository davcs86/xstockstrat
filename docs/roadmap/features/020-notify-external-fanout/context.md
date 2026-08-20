# Context: notify-external-fanout

**Feature**: `docs/roadmap/features/020-notify-external-fanout/feature.md`
**Product Spec**: `docs/roadmap/features/020-notify-external-fanout/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/020-notify-external-fanout/implementation-spec.md`

---

## Session 2026-05-26T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Feature number assigned: 020.
- No proto changes required; config-only + notify service HTTP client additions.
- Dedup window and secret key storage noted as open questions for /sdd-spec phase.

## Session 2026-08-19 — sdd-review product-spec (+ owner-approved scope reduction)

- Review verdict was FAIL (3 blockers). Status: draft → spec-ready after fixes.
- **Scope reduction — explicitly surfaced to and approved by the feature owner (2026-08-19), per the
  CLAUDE.md "don't reduce scope without letting me know" rule:**
  - Blocker C-05: the spec stored the SendGrid API key and Slack webhook URL as config keys (one even
    used the retired `secret.*` prefix). Config governance forbids a vendor credential as a config key
    (the `secret.*`/`is_secret` mechanism was reversed by feature 076 — migration
    `009_drop_fmp_api_key_config`); credentials are `type: SECRET` env vars wired through deploy.
  - The only compliant fix moves both credentials to env vars (`SENDGRID_API_KEY`, `SLACK_WEBHOOK_URL`),
    which removes the "runtime credential rotation, no redeploy" capability FR-4/AC-1–3 promised.
  - Owner decision (AskUserQuestion): **Accept the scope reduction.** Credential rotation now requires
    a redeploy; only the two credentials moved — all non-credential knobs (threshold, dedup window,
    from/to email, per-channel enable-via-credential-presence) remain runtime config-driven.
  - Spec edits: rewrote FR-4; moved the two credentials out of Config Key Changes into a new Env Var
    Changes section (`type: SECRET`, wired per add-data-source.md); reworded AC-1–3; kept "No schema
    changes" valid via the in-memory dedup resolution.
- Other blockers fixed (scope-preserving):
  - C-14: added the `## Consumer Surface(s)` section (UI = none; the `notify.fanout.*` non-credential
    keys surface via the existing `/config-ui` segment; fanout targets are external Slack/SendGrid).
  - P-03 open questions: both resolved — credential storage → env var (above); dedup store → in-memory
    map for V1 (low alert volume), keeping the no-migration claim intact.
- Overlap: CLEAN (no duplicate config key / proto field / migration NNN). Soft/rebase-only overlap on
  `xstockstrat-notify`'s `emitAlert` with already-`code-completed` feature 094 (input-validation guard
  at the top of the same method) — semantically disjoint from the post-emit fanout side-channel; 020
  simply rebases onto 094's landed guard. No merge-order row required.

## Session 2026-08-19 — sdd-design (Phase 0 + Phase 1 round 1)

- Phase 0 Recon: wrote recon.md. Services: xstockstrat-notify, xstockstrat-config. Key facts:
  hook point = `NotifyServiceImpl.emitAlert` post-subscriber-loop (`notifyServiceImpl.ts:82-93`);
  no outbound HTTP client and no dedup logic today (both net-new); config read via
  `ConfigWatcher.getFloat/getInt`; config seed migration next = **017**; SECRET env vars
  `SLACK_WEBHOOK_URL`/`SENDGRID_API_KEY` confirmed absent from all 3 deploy files.
- **DECISIVE FINDING (Phase 1 round 1) — the central fork is grounded, not hypothetical.** The
  alert proto has no first-class `symbol`/`confidence`/`action` field, and a survey of **all five**
  `EmitAlert` producers shows **no producer writes `context.confidence`**:
  - analysis `live_loop._emit_alert` (`live_loop.py:567-575`): context = `{strategy_id, symbol,
    trigger_type, conviction}` — key is `conviction`, NOT `confidence`; no `action`.
  - trading (`trading.go` fill/approval/bracket/reconciliation/halt alerts): **no context set at all**.
  - ingest (`servicer.py:295`): context = `{job_id, failed_symbols, error}`.
  - marketdata / portfolio alerts: no context.
  So FR-1/FR-2's confidence gate + FR-5's payload fields are unsatisfiable against today's
  producers — a fail-closed `context.confidence` gate ships an inert feature (C-01/P-03; ledger
  080 absence-claim / 023 & 081 "demonstration is not a producer contract" / 08-02 F-10 context
  builder drift). Even `conviction` is an ordinal-not-probability per ledger 023.
- Other round-1 objections (addressable in round 2 regardless of the fork; no user input needed):
  O4 fire-and-forget needs a `.catch()` + full-body try/catch or an unhandled rejection can crash
  the notify process (defeats AC-4/FR-6); O5 dedup key should exclude volatile title/body
  (trading titles embed price/qty) and the Map needs bounded eviction; O6 the 3-file SECRET parity
  needs an explicit verification step (C-10); O7 the 3000ms timeout is a defensible constant (or a
  waive-or-add knob). Config side is sound (value_type↔getter match, C-05 ok).
- **Open fork surfaced to user at the round-1 gate (P-04/P-03 — not guessed):** what does the
  fanout gate actually read? (A) first-class `severity` [works on all producers today; reword
  FR-1/FR-2 off literal "confidence score"]; (B) add a first-class `confidence` (+symbol/action)
  proto field and make every fanout-eligible producer populate it, parity-tested [satisfies
  FR-1/FR-2/FR-5 literally; proto change C-09 + touches every emitter — larger scope]; (C) hybrid —
  gate on `severity`, refine with `context.conviction` where present, payload from available fields.
- Round 1 complete; full mode mandates ≥2 rounds. Awaiting user steer on the fork before round 2.

## Session 2026-08-19 — sdd-design (Phase 1 round 2 + approval)

- Round 2 (proposer+adversary) on the HYBRID gate. Adversary verdict REVISE, no Floor breach.
  Verified: `alertSeverityToNumber` exists (`notifyServiceImpl.ts:3,53` — not F-04); AlertSeverity
  enum INFO=1/WARNING=2/ERROR=3/CRITICAL=4 (`notify.proto:43-47`); all 5 config value_type↔getter
  pairs match. Fixes baked into design.md:
  - **Dedup key → content hash** `sha256(category|source_service|title|body [+symbol/trigger_type/
    strategy_id when present])`. Round-1's exclude-title/body steer was WRONG: it collapsed distinct
    context-less trading alerts (CRITICAL reconciliation/approval/fill — `trading.go:1357/3059/3073`)
    to one key; gate-passing producers embed no wall-clock in title/body, so a content hash dedups a
    byte-identical re-fire without dropping distinct alerts.
  - **Hook after the success callback** (`queueMicrotask`) so dispatch's synchronous prefix can't
    throw an RPC error onto an already-succeeded emit; full-body try/catch + `.catch` on the floating
    promise (FR-6/AC-4).
  - **NaN conviction → severity-only fallback**; `min_confidence_threshold` reworded to a readiness-
    ordinal floor (ledger 023, not a probability); `min_severity` registered + range-clamped + 0-4↔
    severity map documented (C-05/C-14).
- **User decision at the round-2 approval gate: `min_severity` default = WARNING (2).** Trade-off
  accepted: INFO fill confirmations do NOT fan out by default (despite the user story headline);
  operator lowers `notify.fanout.min_severity` to 1 to capture fills. Recorded as an Open Risk.
- Chosen approach: hybrid severity-primary + conviction-floor-when-present gate; fire-and-forget
  content-hash-deduped fanout via Node `fetch`; 5 config keys seeded by config migration 017; 2
  SECRET env vars across 3 deploy files. Rejected: context.confidence fail-closed (inert),
  proto-field addition (scope), alertId dedup, exclude-title/body dedup. Constitution touched:
  C-01/P-03, C-04, C-05, C-07, C-10, C-14, F-04, F-07, C-08/P-06 (all honored; no Floor breach).
- Status: spec-ready → design-approved. Rounds: 2 (full). 4 open risks carried to /sdd-spec.
- **Note for /sdd-spec:** the product-spec's FR-1/FR-2/FR-5 still say "confidence score" and list 4
  config keys — reword to the hybrid model and register `notify.fanout.min_severity` (the 5th key).

### Open Threads
- [ ] min_severity=WARNING default excludes INFO fills — document prominently → config-seed/docs step.
- [ ] Struct-key pinning (`conviction`/`symbol`/`trigger_type`/`strategy_id`) — red-before-green test → fanout-wiring test step.
- [ ] SECRET env parity across docker-compose + 2 DO specs → deploy-wiring step (C-10 verification).
- [ ] Reword FR-1/FR-2/FR-5 + register 5th config key → before/at /sdd-spec.
