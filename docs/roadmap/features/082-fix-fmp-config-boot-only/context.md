# Context Log: fix-fmp-config-boot-only

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-07-30 (/sdd-triage)

- Bug surfaced live, not from a report: while resuming the staging paper-trading setup, flipped
  `marketdata.fmp.enabled=true` and `analysis.fundsignal.enabled=true` via the new `set_config` MCP
  tool (feature 073, confirmed working — real per-user role auth). A real `FMP_API_KEY` DO secret
  was already present on `xstockstrat-marketdata` (feature 076). Despite both prerequisites met,
  `screen_symbols` kept returning flat neutral scores for a `SCREEN_KIND_FUNDAMENTAL` criterion on
  AAPL/MSFT — identical to the pre-flip state.
- Delegated a codebase-discovery agent to explain the discrepancy; confirmed root cause:
  `cmd/server/main.go:111-121` reads `marketdata.fmp.enabled` once at boot to decide whether to
  construct the FMP client at all — a live config flip afterward is invisible to the running
  process. `xstockstrat-analysis`'s `screener.py` swallows the resulting `FailedPrecondition` into a
  silent neutral score (`_fetch_fundamentals` → `{}, False` → weight_total 0 → score 0.5), which is
  why the symptom looked identical to "not yet enabled" rather than an obvious error.
- Severity: **SEV-2** — matches the bug-triage indicator "Config value propagation is delayed or
  missing for a non-critical key" exactly. Not SEV-1: no trading impact, no financial risk, no
  approval-flow bypass — purely a staging/dev operability gap (a flag flip silently requires a
  restart nobody is told about).
- Environment: observed on `dev`/staging (`xstockstrat-staging`). The same code is presumably
  shared with production, but not independently confirmed broken there this session — per
  `docs/runbooks/bug-triage.md` routing table, SEV-2 + dev/local environment → **Track C** (no
  Track A hotfix branch needed).
- Routed to SDD path (Track C), same adaptation as features 067/074: **no GitHub issue** (Issues
  disabled on this repo), captured directly from live observation + code recon.
- Created: feature.md, product-spec.md, context.md.
- Affected services: `xstockstrat-marketdata` (primary — the boot-only read).
  `xstockstrat-analysis`'s silent-degrade behavior is noted for reviewer awareness but explicitly
  out of scope (a separate, seemingly deliberate graceful-degradation pattern, not part of this
  bug).
- Recommended design depth: **quick** → `/sdd-design fix-fmp-config-boot-only quick` (SEV-2, single
  primary service, root cause already fully confirmed by recon — not "under investigation" — no
  proto/migration/config-key change anticipated. Below the "full" threshold per
  `docs/runbooks/bug-triage.md` § C-0, above "skip" since a live-toggle test needs a small design
  decision: poll the watcher on every call vs. register a callback that rebuilds the client).
- Development branch: `feature/fix-fmp-config-boot-only` (not yet created — triage stops here per
  the skill's own gate, awaiting the human to trigger `/sdd-design`).
- **Immediate operational workaround** (not a code fix, just unblocks staging right now): the
  in-flight PR wiring `FMP_API_KEY` through the deploy workflows
  (`docs/roadmap/features/073-mcp-config-management/` follow-on work, same session) will, once
  merged, trigger a real `xstockstrat-marketdata` redeploy on the next `main-dev` push — which
  incidentally restarts the process and picks up `marketdata.fmp.enabled=true` at boot, unblocking
  fundamentals without needing this bug's fix first. That merge still requires
  `DEV_FMP_API_KEY`/`PROD_FMP_API_KEY` to be added as real GitHub Actions secrets beforehand (see
  that PR's notes) — otherwise the deploy would overwrite the already-live real FMP key with an
  empty string.
