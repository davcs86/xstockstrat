# Hotfix Incident Register

Append-only operational log of all Track A hotfixes (SEV-1 and production bugs).
**Never edit or delete existing entries.** Each entry is appended by `/sdd-triage` or manually
following the format in `docs/runbooks/bug-triage.md#hotfix-log-format`.

---

<!-- New entries are prepended below this line, most-recent first -->

## 2026-10-02T14:01:50Z — hotfix/fix-portfolio-fill-db-errors

- **GitHub issue**: docs/reports/2026-10-02-portfolio-fill-db-errors-defect.md (GitHub Issues disabled on this repo)
- **Severity**: SEV-1
- **Affected service(s)**: xstockstrat-portfolio
- **Root cause**: processOrderFill discards GetPosition/UpsertPosition/ClosePosition errors but still emits ledger position events and advances the stream cursor, so a DB error corrupts or loses position state.
- **Fix summary**: _pending_
- **PR**: _pending_
- **Platform-lead approver**: _pending_
- **Back-merge commit**: _pending_
- **Maintenance mode applied**: no
- **Status**: in-progress


## 2026-10-02T14:01:50Z — hotfix/fix-flatten-rejection-skips-halt

- **GitHub issue**: docs/reports/2026-10-02-flatten-rejection-skips-halt-defect.md (GitHub Issues disabled on this repo)
- **Severity**: SEV-1
- **Affected service(s)**: xstockstrat-trading
- **Root cause**: flattenAndHalt reuses one client_order_id across retries; a broker-REJECTED intent is replayed by submitOrder as a stored response with nil error, so the loop reports success and never halts. Agreed fix: status-aware retry.
- **Fix summary**: _pending_
- **PR**: _pending_
- **Platform-lead approver**: _pending_
- **Back-merge commit**: _pending_
- **Maintenance mode applied**: no
- **Status**: in-progress


## 2026-10-02T14:01:50Z — hotfix/fix-oauth-login-unvalidated-redirect

- **GitHub issue**: docs/reports/2026-10-02-oauth-login-unvalidated-redirect-defect.md (GitHub Issues disabled on this repo)
- **Severity**: SEV-1
- **Affected service(s)**: xstockstrat-ui
- **Root cause**: /auth/oauth-login assigns the client-supplied agent_cb query value to window.location.href with no validation (open redirect / javascript: execution on the session origin).
- **Fix summary**: _pending_
- **PR**: _pending_
- **Platform-lead approver**: _pending_
- **Back-merge commit**: _pending_
- **Maintenance mode applied**: no
- **Status**: in-progress


## 2026-08-07T06:53:51Z — hotfix/fix-watchconfig-clients-omit

- **GitHub issue**: docs/reports/2026-08-07-watchconfig-scope-omission-defect.md (GitHub Issues disabled on this repo)
- **Severity**: SEV-1
- **Affected service(s)**: xstockstrat-trading, xstockstrat-portfolio, xstockstrat-marketdata, xstockstrat-indicators, xstockstrat-ingest, xstockstrat-analysis, xstockstrat-config
- **Root cause**: All six backend WatchConfig clients omit `environment`/`trading_mode` on their subscription request, so every deployment resolves to the `dev`/`all` scope regardless of its own `APPLICATION_ENV`/`TRADING_MODE` — production never reads the more-conservative `production`-tagged risk config seeded by migration 002.
- **Fix summary**: Each of the six services' `WatchConfig` client now resolves its own deployment's `APPLICATION_ENV`/`TRADING_MODE` into the proto `Environment`/`TradingMode` enums and passes them on the subscription request (Go: new `resolveEnvironment`/`resolveTradingMode` helpers in `internal/config/config.go`; Python: new `resolve_environment`/`resolve_trading_mode` helpers in `app/config/watcher.py`, mirroring the existing `xstockstrat-agent` `_config_scope` pattern). `xstockstrat-config` itself needed no change — it already resolves an explicitly-sent scope correctly; only the omission on the client side was the bug.
- **PR**: https://github.com/davcs86/xstockstrat/pull/891
- **Platform-lead approver**: davcs86 (merged PR)
- **Back-merge commit**: 474d9ee0e9f429cc632b38a9f1b6c1b0475e53af
- **Maintenance mode applied**: no
- **Status**: deployed
