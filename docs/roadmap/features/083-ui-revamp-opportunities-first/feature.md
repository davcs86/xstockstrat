# Feature: ui-revamp-opportunities-first

**Lifecycle Status**: `design-approved`
**Development Branch**: `feature/ui-revamp-opportunities-first`
**Created**: 2026-07-31
**Last Updated**: 2026-07-31

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-07-31 | `idea` → `draft` | /sdd-story | Product spec generated from Nocturne design handoff (12-screen UI revamp) |
| 2026-07-31 | `draft` → `spec-ready` | /sdd-review | Product spec approved (PASS with 5 advisory warnings; overlap CLEAN). Warnings C-3/C-4/C-5/C-10(b) folded into FR-20 + AC-8; six design-phase Open Questions accepted for routing to /sdd-design |
| 2026-07-31 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full) and approved; recon.md (+ Phase 0b producer recon) + design.md written. **User override:** all backend work in-scope for 083 (backend→frontend order, no phased split). No Floor breach (F-06 held via ledger-backed Copilot threads). Six Open Questions resolved. **Gate before /sdd-spec:** product-spec refresh + re-review (backend now in-scope) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance _(stale re backend scope — refresh + re-review before /sdd-execute; see design.md Open Risks)_
- [Recon](recon.md) — grounded codebase dossier (UI + Phase 0b producer services)
- [Design](design.md) — debated, approved architecture (analysis-owns-queue spine; backend→frontend ordering)
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec ui-revamp-opportunities-first`_
- [Context Log](context.md) — session history, decisions, deviations
- [Design Handoff](design-handoff/) — Nocturne design reference: `README.md` (token + screen grammar spec), `source-map.md` (screen → repo-module map), `xstockstrat UI.dc.html` (interactive prototype), `screenshots/01–12` (per-screen captures)

---

## Summary

Re-frame the `xstockstrat-ui` web app around a ranked **opportunity queue** — a Decide / Discover /
Engine / Book nav shell with an optional MCP-backed Copilot rail — that surfaces explained buy / trim /
exit signals the trader can act on with one confirmation, while the broker (Alpaca / IBKR) remains the
owner of the ledger and P&L. Reproduces the high-fidelity "Nocturne" dark design system across all 12
handoff screens plus the CRUD editors and a 1:1 mobile companion.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-ui` (service owner) | Trading UI correctness, analytics display accuracy, config mutation safety, Connect-RPC call safety, environment scope correctness, no secret values rendered in UI, no direct DB access (except audit log) |

_No proto, migration, config-key, or new-service change is anticipated (see product spec). If
`/sdd-design` / `/sdd-spec` surface a backend gap (a missing RPC to feed a screen, a Copilot/MCP
surface, or a `chrome` config key), add the corresponding service owner + Proto/Config/DBA reviewer
roles then._

## Next Action

**First:** refresh `product-spec.md` (scope / proto / DB / config / Reviewers now that backend is in-scope
per the user override) and re-run `/sdd-review ui-revamp-opportunities-first product-spec`.
**Then:** `/sdd-spec ui-revamp-opportunities-first` — generate the implementation spec from the approved
design (backend→frontend ordering; step PRs target the feature branch directly, not base-chained).
