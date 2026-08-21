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
- [x] min_severity=WARNING default excludes INFO fills — documented in Step 1 key description + Step 7 notify CLAUDE.md (prominent caveat in the `min_severity` row).
- [x] Struct-key pinning (`conviction`/`symbol`/`trigger_type`/`strategy_id`) — red-before-green test → Step 5 "flat-Struct conviction read" case (0.82 fans out, 0.55 does not).
- [x] SECRET env parity → Step 6, expanded to the FULL add-data-source 8-file credential pipeline (not just the 3 files design.md named), with a cross-file parity grep in Verification (C-10).
- [x] Reword FR-1/FR-2/FR-5 + register 5th config key → verified already reflected in product-spec.md (hybrid gate wording + all 5 keys, incl. `notify.fanout.min_severity`); Step 7 adds only a one-line cross-ref to the completed full-pipeline wiring.

## Session 2026-08-20 — sdd-spec

- Generated implementation-spec.md with 7 steps. Status → implementation-ready.
- Steps: 1 config migration 017 (5 `notify.fanout.*` keys, dev+prod rows, value_type↔getter matched);
  2 `src/fanout/fanout.ts` FanoutDispatcher (gate + content-hash dedup + Slack/SendGrid senders,
  AbortController 3000ms); 3 module unit test (AC-2/3/5/6/7/8/9); 4 wire into emitAlert via
  `queueMicrotask` AFTER the success callback (notifyServiceImpl.ts:95); 5 wiring/isolation test
  (AC-1/3/4/5/6 + flat-Struct conviction pin); 6 full credential deploy pipeline; 7 docs + context-scrubber.
- Key codebase findings (grounded, not from recon alone):
  - Hook point confirmed: `emitAlert` success callback at `notifyServiceImpl.ts:95-98`; fan-out `alert`
    object built `:67-80`; F-10 title/body guard `:35-37`; `alertSeverityToNumber` imported `:3`, used `:53`.
  - Analysis is the sole `conviction` producer — flat Struct key in `live_loop.py` `_emit_alert`
    (`ctx.update({strategy_id, symbol, trigger_type, conviction})`). Verified directly.
  - Config seed: last migration 016 → next 017; copy `015_marketdata_finnhub.up.sql:24-30` shape
    (dev+prod rows, `trading_mode='all'`, `is_secret=FALSE`, `ON CONFLICT ... DO NOTHING`).
  - **Deploy-wiring scope decision (surfaced, not silently guessed):** design.md § Credentials named
    only 3 deploy files; the product spec's Env Var Changes binds the credentials to the FULL
    `add-data-source.md` § "Wiring a New Vendor Credential Through Deploy" checklist, and
    `config-governance.md:60` records feature 129 shipping a credential into "only 3 of 8 required
    files" as a defect needing a follow-up PR. Step 6 therefore wires all 8 applicable pipeline files
    (`config.go` row is Go-only, N/A here — Node reads `process.env` in the Step 2 module). This
    completes design.md's wording without changing its architecture; flagged in the Execution Summary
    and this log for the impl-spec reviewer.
  - Test harness: notify runs compile-first (`tsc && node --test dist/__tests__/*.test.js`), coverage
    via `pnpm run test:coverage` (c8 `--lines 40`), lint `eslint src --ext .ts`; single-consumer inline
    fakes are C-13-compliant (no `src/__tests__/fixtures/` home needed).

### Decisions
- Deploy credential wiring expanded to the full 8-file add-data-source pipeline (C-10) — the load-bearing
  deviation from design.md's 3-file wording; both credentials are OPTIONAL (empty = disabled channel).
- HTTP timeout `FANOUT_HTTP_TIMEOUT_MS = 3000` stays a code constant, not a 6th config key (F-07 —
  not a tunable in disguise; inside AC-1's 5 s).

## Session 2026-08-20T06:16:48Z — sdd-review impl-spec (advisory)

- Result: 0 failures, 2 warnings, 1 note (advisory — did not block). Verdict PASS WITH WARNINGS.
- Overlap: no FAIL-level collision. WARN-only shared-file overlaps — the three deploy specs
  (`docker-compose.yml`, `.do/app.yaml`, `.do/app.dev.yaml`) vs 127 (notify block vs agent block —
  disjoint) and `docs/patterns/config-governance.md` Per-Feature Registered Keys log vs 042
  (both append). Reconcile on whichever branch merges second. merge-order.md needs no new hard row.
- Unresolved ⚠ / ⓘ carried into execution:
  - Step 6: touches 8 files (>5, B2 advisory) — one atomic credential-wiring surface; splitting
    would break the C-10 compose↔DO parity guarantee, so keep together. — [x] no action needed (accepted)
  - Step 2: reads SLACK_WEBHOOK_URL/SENDGRID_API_KEY but lists no deploy specs in its own Files —
    intentionally deferred to Step 6 (lists all three). — [x] no action needed (by design)
  - Note: `makeImpl` cited at notifyServiceImpl.test.ts:55/:56 but actually lives at :47
    (makePool:38 correct) — line drift only, symbol/behavior accurate. — [x] FIXED in the 2026-08-20
    spec-fix pass: both cites corrected to `:47` (verified against the test file).

## Session 2026-08-20 — sdd-execute (steps 1–5)

Executed on harness branch `claude/execute-020-042-127-pfa5cw` (single integration PR model, same
as 127). Node/TS notify service — no proto/codegen.

### Step 1 — config migration 017 [done]
- `017_notify_fanout.{up,down}.sql`: 5 keys × 2 envs (min_severity int 2, min_confidence_threshold
  float 0.7, dedup_window_seconds int 300, sendgrid_from_email/to_email string ''). No credential
  rows. Offline up/down parity verified; value_types match getInt/getFloat/getString.

### Step 2 — FanoutDispatcher module [done]
- `src/fanout/fanout.ts`: severity+conviction gate (live config read), content-hash dedup with
  sweep, Slack + SendGrid v3 senders (AbortController 3s timeout), enable-iff-credential-set, full
  best-effort try/catch. Node global fetch (first outbound HTTP; no new dep). Build clean.

### Step 3 — fanout unit tests [done]
- `src/__tests__/fanout.test.ts`: AC-2/3/5/6/7/8/9 + sendgrid-disabled-when-to-empty. fetch stubbed.
  31 tests pass, fanout.js coverage 96%.

### Step 4 — wire into emitAlert [done]
- `src/index.ts`: construct + inject FanoutDispatcher. `notifyServiceImpl.ts`: 3rd ctor param;
  `queueMicrotask(() => void fanout.dispatch(alert).catch(...))` AFTER the success callback so
  fanout never affects the RPC result or primary stream latency (FR-6/AC-4).

### Step 5 — emitAlert wiring tests [done]
- Extended `notifyServiceImpl.test.ts`: AC-1/3/4/5/6 + flat-Struct conviction read. Fixed existing
  makeImpl + 4 direct constructors for the new 3rd arg. 37 tests pass, lint 0 errors.

**Next:** Step 6 (deploy pipeline secrets), Step 7 (docs + context-scrubber).

### Step 6 — deploy pipeline credentials [done]
- SLACK_WEBHOOK_URL / SENDGRID_API_KEY (`type: SECRET`) wired through the full 8-file surface:
  docker-compose.yml, .do/app.yaml (prod), .do/app.dev.yaml (dev), deploy.yml (workflow_call
  secrets + substitute env + 4 content.replace lines), deploy-dev.yml, deploy-prod.yml, prod-up.yml,
  scripts/do-inject-prod-secrets.py (OPTIONAL_PLACEHOLDER_KEYS). Both optional. Parity greps + yaml
  + python syntax verified.

### Step 7 — docs [done]
- notify CLAUDE.md (5 config keys + 2 SECRET env vars + fanout narrative; min_severity WARNING
  caveat), config-governance.md (feature-020 registered-keys block), digitalocean.md (Slack/SendGrid
  secrets subsection + 4 GitHub Actions table rows), product-spec.md (full-pipeline note under Env
  Var Changes).
- **context-scrubber:** the context-forge plugin is NOT available in this session (not in the
  SessionStart skills list), so `/context-scrubber scan` could not be run — noted here and in the PR
  body per the root CLAUDE.md Teardown rule (say so rather than skip silently).

## Session 2026-08-20 — sdd-execute — feature 020 COMPLETE
All 7 steps done. status.md → code-completed.

## Session 2026-08-21 — rebase onto main-dev (feature 147 collision) — DEVIATION
Rebasing the integration branch onto the advanced `main-dev` collided with feature 147
(`config-secrets-and-scoping`), which re-modelled `config.config_values`. Two forced changes to the
feature-020 config seed (design-time artifacts still say `017`/`dev`/`trading_mode`; the code now
reflects post-147 reality):
- **Migration renumbered `017_notify_fanout` → `018_notify_fanout`** (`.up`/`.down`) — 147 took `017`
  (`017_config_secrets_and_scoping`). 018 is the next free number.
- **INSERT rewritten for the post-147 schema**: `trading_mode` column dropped (removed by 147, both
  from the column list and the `ON CONFLICT` target); environment seeds changed `dev` → `staging`
  (147 renamed the env); `ON CONFLICT (namespace, key, environment, trading_mode)` →
  `ON CONFLICT (namespace, key, environment, COALESCE(user_id, ''))`; rows are global (`user_id NULL`).
- config-governance.md feature-020 block updated to reference migration `018` and `staging`+`production`.
- Deploy-pipeline conflicts resolved by keeping 147's side (which retired the Alpaca/FMP/Finnhub deploy
  secrets into encrypted config) plus the feature-020 Slack/SendGrid `type: SECRET` additions.
