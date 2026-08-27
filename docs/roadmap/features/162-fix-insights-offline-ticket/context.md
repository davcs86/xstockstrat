# Context Log: fix-insights-offline-ticket

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-08-27 (/sdd-triage)

- Bug reported via defect report `docs/reports/2026-08-27-insights-signal-ticket-offline-account-flake-defect.md` (GitHub Issues disabled → --from-report path).
- Severity: SEV-3. Config-only: no. Impact: flaky-e2e-test / possible-ui-misrender.
- Routed to SDD path (Track C).
- Created: status.md (draft), feature.md (Type=bug), product-spec.md, acceptance.feature (regression @AC-1), context.md.
- Affected services (from report): xstockstrat-ui (insights Signal-detail order ticket; feature 159/083/155).
- Root cause hypothesis: correct direct wiring (SignalOrderTicket allowOfflineRecord={false}); suspect the mobile SectionRenderer `form` mount omits the prop, and/or an AccountContext auto-select hydration race. Under investigation.
- **Not caused by feature 161** — reproduces on origin/main-dev fixtures; the offline-accounts spec reads no config. Surfaced while driving feature 161 PR #1032 to green.
- Recommended design depth: **quick** → `/sdd-design fix-insights-offline-ticket quick` (rationale: SEV-3 single service, no proto/migration/config, but root cause not yet pinned — one adversarial round).
- Development branch: feature/fix-insights-offline-ticket.
