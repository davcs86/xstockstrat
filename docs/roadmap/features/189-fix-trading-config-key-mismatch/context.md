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
