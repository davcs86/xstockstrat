# Triage: defects surfaced during the inline-comment reduction audit

**Recorded**: 2026-09-04
**Source**: the monorepo-wide inline-comment reduction pass (branch `claude/audit-code-comments-docs-yos15q`, PR #1088)
**Scope**: bugs/defects noticed while *reading* code to trim comments. No service behavior was changed by the comment pass itself; the fixes below are proposed here for routing via `/sdd-triage --from-report`, not applied in that PR.

GitHub Issues are disabled on this repo (`POST /issues` → `410`), so this dated report is the routable artifact (root `docs/CLAUDE.md` § `reports/`).

---

## How to read this

Each row is classified by severity (SEV-1 outage/data-loss · SEV-2 silent-wrong-behavior · SEV-3 latent/cleanup) and routed to a fix track per `docs/runbooks/bug-triage.md`:
- **Track A** — hotfix off `main` (SEV-1/2 in production)
- **Track B** — config-key change through the config service
- **Track C** — SDD path (feature dir, bug Type)
- **Cleanup** — low-risk dead-code/doc removal, batchable into any nearby PR

Items marked **(already logged)** re-confirm an existing entry in `docs/context-constitution-findings.md` (or a module findings file) — listed here so the comment audit's re-surfacing is not lost, with a routing recommendation attached.

---

## New / needs-verification (surfaced by this audit)

### 1. Agent sets a `trading_mode` OTel resource attribute from `TRADING_MODE` — SEV-3, verify then Track C **(now logged — agent module findings, open questions)**
- **Where**: `services/xstockstrat-agent/app/telemetry.py:33`
- **Observed**: reads the `TRADING_MODE` env var into a `trading_mode` OpenTelemetry resource attribute. Feature 147 removed `trading_mode` as a **config/scope** axis (config scope is derived from `APPLICATION_ENV`). `TRADING_MODE` may still be a live env var for `xstockstrat-trading`'s paper/live **routing** (its `CLAUDE.md` still lists it), so this is a *verify*, not a confirmed defect.
- **Impact**: if the attribute is meant to reflect the retired config axis it is misleading; if it mirrors trading's routing mode it may be intentional. Confirm intent — drop the attribute, or rename to `environment` for parity with the post-147 model.
- **Config-only fix**: no.

---

## Re-confirmed open findings (already logged; routing attached)

### 2. `portfolio.risk.max_drawdown_pct` is read then discarded — SEV-3, Track C **(already logged — portfolio module findings, Dead/orphaned code)**
- **Where**: `services/xstockstrat-portfolio/internal/service/portfolio_service.go` (`GetFloat` then `_ = maxDrawdownPct`).
- **Observed**: the config key is fetched but never used — drawdown tracking was never built; only `concentration_limit_pct` is enforced (same class as `trading.risk.daily_loss_limit`, also documented-not-implemented).
- **Impact**: an operator setting `max_drawdown_pct` gets no protection and no error. Either implement the drawdown halt or mark the key **Documented, not yet implemented** in the service `CLAUDE.md` (as `daily_loss_limit` is).
- **Config-only fix**: no.

### 3. Python config zero-trap in indicators + ingest — SEV-2, Track C **(already logged — CF-N10)**
- **Where**: `services/xstockstrat-indicators/app/config/watcher.py:93,101,117`; `services/xstockstrat-ingest/app/config/watcher.py` (same shape). `get_int/get_str/get_float` use `v.int_val or default`, so a stored `0`/`""`/`0.0` silently reverts to the coded default. `xstockstrat-analysis` added a per-key `get_int_present` (`HasField`) escape hatch; indicators and ingest have **no** equivalent, so every numeric/string key there is trapped.
- **Impact**: setting any indicators/ingest int/float/str key to a legitimate `0`/`""` silently reverts to the default. Proto `ConfigValue` is a `oneof` that distinguishes 0-from-unset, so this is a consumer defect, not a contract limit.
- **Fix**: port analysis's `get_int_present` (`HasField`) accessor to the indicators/ingest watchers and use it for 0-meaningful keys.

### 4. `client_id="indicators-…"` copy-paste in analysis + ingest config watchers — SEV-3, Track C **(already logged — open question)**
- **Where**: `services/xstockstrat-analysis/app/config/watcher.py:61`, `services/xstockstrat-ingest/app/config/watcher.py:61` — both build `client_id=f"indicators-{id(self)}"` (copied from the indicators template).
- **Impact**: unknown — needs a maintainer decision on whether `client_id` is significant to the config service's subscriber identification/dedup, or a harmless label to correct to `analysis-`/`ingest-`.
- **Fix**: confirm significance; if cosmetic, correct the prefix per service.

### 5. Dead `getEnvBool` in all three Go services — SEV-3, Cleanup **(already logged)**
- **Where**: `trading/internal/config/config.go`, `portfolio/.../config.go`, `marketdata/internal/config/config.go` — referenced only by a `var _ = getEnvBool` suppressor or a test.
- **Fix**: remove the function + suppressor (a real code change; out of scope for a comment-only pass).

### 6. Dead `middleware/propagation.ts` in ledger/notify/config — SEV-3, Cleanup **(already logged)**
- **Where**: `services/xstockstrat-{ledger,notify,config}/src/middleware/propagation.ts` — zero importers (the Connect-RPC HTTP path they served was removed; identity's copy is now live via `ledgerAudit`, so it is **not** dead there).
- **Fix**: delete the three dead copies.

### 7. `@types/node ^20` pin vs Node 24 runtime — SEV-3, Cleanup **(already logged)**
- **Where**: Node services' `package.json` (e.g. `services/xstockstrat-ledger/package.json`).
- **Fix**: bump `@types/node` to `^24` in the same PR as any Node dependency touch.

---

## Doc-drift corrected in-pass (no follow-up needed — listed for the record)

These were stale *comments* fixed during the comment reduction itself (comment-only, already in PR #1088):
- `marketdata` `newFundamentalsSource` + `finnhub_client.go` `APIKey` — "secret env var" → encrypted config secret (feature 147).
- `marketdata` `StartBarStream` — stale default `"15m,1d"` → `"1d"` (feature 143).
- `portfolio` `resolveEnvironment` godoc — "resolves to dev" → staging; two mis-homed godoc blocks re-homed.
- `agent` `client.py` config banner — stale `get_config_value` description (feature 093 made namespace/environment required + re-raising) removed.

---

_Generated during the inline-comment reduction audit. Route actionable items with `/sdd-triage --from-report docs/reports/2026-09-04-comment-audit-triage.md`._
