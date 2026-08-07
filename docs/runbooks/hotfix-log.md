# Hotfix Incident Register

Append-only operational log of all Track A hotfixes (SEV-1 and production bugs).
**Never edit or delete existing entries.** Each entry is appended by `/sdd-triage` or manually
following the format in `docs/runbooks/bug-triage.md#hotfix-log-format`.

---

<!-- New entries are prepended below this line, most-recent first -->

## 2026-08-07T06:53:51Z — hotfix/fix-watchconfig-clients-omit

- **GitHub issue**: docs/reports/2026-08-07-watchconfig-scope-omission-defect.md (GitHub Issues disabled on this repo)
- **Severity**: SEV-1
- **Affected service(s)**: xstockstrat-trading, xstockstrat-portfolio, xstockstrat-marketdata, xstockstrat-indicators, xstockstrat-ingest, xstockstrat-analysis, xstockstrat-config
- **Root cause**: All six backend WatchConfig clients omit `environment`/`trading_mode` on their subscription request, so every deployment resolves to the `dev`/`all` scope regardless of its own `APPLICATION_ENV`/`TRADING_MODE` — production never reads the more-conservative `production`-tagged risk config seeded by migration 002.
- **Fix summary**: _pending_
- **PR**: _pending_
- **Platform-lead approver**: _pending_
- **Back-merge commit**: _pending_
- **Maintenance mode applied**: no
- **Status**: in-progress
