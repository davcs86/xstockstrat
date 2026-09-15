# Context Log: fix-trading-config-key-mismatch

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-09-15 (/sdd-triage)

- Bug reported via defect report `docs/reports/2026-09-15-trading-config-namespace-key-mismatch-defect.md`
  (GitHub Issues disabled on this repo → from-report path; the report is the audit trail).
- Origin: user reported the trader UI rejecting orders with
  `trading halted: platform.trading_state=HALTED` ("Fix halted account", screenshot on a PAPER/Alpaca-test
  account → staging).
- Severity: **SEV-1** (runbook indicator "orders not executing on the live Alpaca API"). Failure mode is
  **fail-safe** (orders blocked, never wrongly executed) → no financial-integrity bleed, only an outage.
- Routed to **Track C (SDD path)** by explicit user decision, over the mechanical SEV-1 → Track A routing.
  Rationale (user-approved): fail-safe failure mode removes the hotfix urgency, and the chosen fix is
  **systemic/cross-service** (shared Go config-watcher contract), which warrants a full design debate; also
  honors the harness branch mandate (`claude/halted-account-94ldka` → main-dev) that Track A (off `main`)
  would violate.
- Created: feature.md, product-spec.md, acceptance.feature (3 regression scenarios), context.md, status.md.
- Affected services: xstockstrat-trading (primary); xstockstrat-portfolio, xstockstrat-marketdata (same
  latent watcher pattern); xstockstrat-config only if the seed-key-migration approach (B) is chosen.
- Root cause (four independent confirmations — live get_config, config-server source, trading reader source,
  constitution CONFIG-9 / insights.md:905): trading subscribes to the single `trading` namespace and reads
  full-dotted getter strings against a snapshot keyed by the raw namespace-relative `key` column, so
  `platform.trading_state` never matches → fail-closed `HALTED`. The same verbatim-snapshot + dotted-read
  gap silently defaults all `trading.*` reads; it only surfaces on `platform.trading_state` because that is
  the one key whose code default (HALTED) diverges from its intended seed (ACTIVE).
- Recommended design depth: **full** → `/sdd-design fix-trading-config-key-mismatch`
  (rationale: ≥2 affected services + a likely seed-key migration + safety-critical contract).
- Candidate fix approaches recorded in product-spec.md (A watcher-prefix + multi-namespace [preferred
  hypothesis], B seed/writer migration, C reader alignment) — **not** pre-committed; the design phase decides
  under adversarial review.

### Interim operational action already taken (this session, before triage)
- Set `platform.trading_state = ACTIVE` in **staging** via `set_config` (author davcs86@gmail.com) to clear
  the incident-time `REDUCE_ONLY` value. This does **not** unblock trading (the reader never sees it) and is
  recorded only so the stored value is not left mid-incident. The code fix is required to actually resolve
  the halt. No code was changed on any branch by the triage.

### Development branch
- `claude/halted-account-94ldka` (harness-assigned; PR targets `main-dev`). SDD skills normally use
  `feature/<slug>`; the harness mandate governs here.

## Session 2026-09-15 — sdd-design

- **Phase 0 Recon:** wrote recon.md from 5 parallel discovery agents (trading/portfolio/marketdata/config
  + scenario-recon) grounded against staging config-service logs (platform broadcasts reach
  `subscribers=0`; my triage-time `platform.trading_state=ACTIVE` write at 07:39:19 reached 0 subscribers —
  runtime proof of the namespace fault). Key reuse patterns: CONFIG-9 seed↔reader match; the
  `lookupScalarBounds` two-operand probe; existing `newTestWatcher` harnesses.
- **Phase 1 Grilling:** 3 full rounds (proposer↔adversary, mediated).
  - R1 — proposer split the fix into Layer A (platform delivery) + Layer B (key format); adversary
    (NEEDS WORK) surfaced the migration deploy/collision/down hazards and the **behavior-flip blast
    radius** (bracket_orders_enabled prod false vs default true).
  - R2 — operator locked **Layer B = data migration 029** and **preserve prod bracket behavior**;
    adversary (NEEDS WORK) then found **finding #1**: the rename reactivates ALL dormant seeds, not just
    bracket — confirmed prod deltas `approval.require_above_qty` 500→100, `require_above_notional`
    50000→10000, `max_position_pct` 0.05→0.02 (migration 002 `live` rows); plus the SetConfig enum-guard,
    literal-bracket-bump, and non-vacuous-test must-fixes.
  - R3 — operator chose **HONOR the conservative prod seeds** (all tighten toward safety); adversary
    (NEEDS WORK→resolved) found the **new C-14 forward regression**: `/trader/positions` reads bare
    `values['trading_state']` (`page.tsx:120-121`), which the rename silently breaks (banner goes dark) —
    folded into the atomic edit set. Confirmed `page.tsx:120-121` is the only runtime bare-key reader in
    ui/agent.
- **Chosen approach (design.md):** (A) trading watcher variadic multi-namespace + namespace-scoped
  snapshot replace + per-namespace ready latch; (B) migration 029 heals `platform/trading/portfolio/marketdata`
  non-secret bare keys → full-dotted (guarded, `is_secret=false`, `NOT LIKE`) + deterministic prod
  bracket→true; (C) three-part atomic rename edit set (escalateSystemic writer + authz allowlist + SetConfig
  enum guard → `platform.trading_state`); (D) `/trader` frontend reader + e2e to the post-029 shape (C-14).
- **Rejected:** watcher-prefix (leaves storage mixed), reader→bare (@feature-184 CHANGE), server-side
  folding (widens contract), shared Go module (YAGNI).
- **Constitution:** F-01/F-06/F-07 honored; C-08/P-06 (sequenced non-vacuous RED); C-10/C-14 (UI consumer
  surface in scope); C-18 (minimum footprint). **Floor breaches: none.**
- **C-16 CHANGE — operator sign-off (this session):** production `trading.risk.bracket_orders_enabled`
  false→true reverses feature 030's deliberate "false pending feature 103" decision. **User explicitly
  approved** this reversal (preserve current runtime behavior; honoring the seed would turn bracket
  protection OFF). Recorded here per C-16. The honored conservative prod deltas (approval/max_position
  tightening) were likewise operator-approved as intended feature-002 production limits finally activating.
- **Affected services updated:** added `xstockstrat-ui` (C-14 consumer surface) to the original
  trading/portfolio/marketdata/config set.
- **Open Risks carried to /sdd-spec** (see design.md § Open Risks): DOWN reversibility (forward-only vs
  enumerated — needs the blocked DB audit), per-row DB audit, `daily_loss_limit` reader confirmation,
  deploy sequencing/window, concurrency invariants, full bare-key reader re-audit.
- Status: draft → design-approved. Next: `/sdd-spec fix-trading-config-key-mismatch`.

### Interim operational note (unchanged from triage session)
`platform.trading_state=ACTIVE` remains set in staging; it does not unblock trading (the reader never
receives it) and the code fix is required. No service code changed by the design phase.
