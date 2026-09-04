# Context Log: fix-agent-trading-mode-otel-attr

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-09-04 (/sdd-triage --from-report)

- Bug surfaced via `docs/reports/2026-09-04-comment-audit-triage.md` item 1 (comment-audit pass).
  No GitHub issue — Issues disabled on this repo (`POST /issues` → 410); the dated report is the
  routable artifact.
- Severity: SEV-3.
- Routed to SDD path (Track C).
- Created: feature.md, product-spec.md, acceptance.feature (regression scenario), context.md, status.md.
- Affected services: `xstockstrat-agent` (`app/telemetry.py:33,39`).
- Triage verification: **confirmed** the read at `telemetry.py:33` and the `trading_mode` attribute
  at `:39`. Also confirmed `TRADING_MODE` is **still a live env var** — a paper/live routing axis used
  by `xstockstrat-portfolio` (`commonv1.TradingMode` enum) and the indicators/ingest config watchers
  (`resolve_trading_mode`). So this is a naming/semantics mismatch vs the post-147 model, not a stale
  read of a dead variable. The report's "verify, not confirmed" framing is resolved: the axis lives,
  the attribute name is the question.
- Root cause hypothesis: the resource attribute predates feature 147's removal of the config/scope
  `trading_mode` axis and was never reconciled with `deployment.environment`.
- Recommended design depth: **quick** → `/sdd-design fix-agent-trading-mode-otel-attr quick`.
  Rationale: SEV-3, single service, no proto/migration/config would ordinarily be a `skip`, BUT there
  is a genuine open decision (drop the attribute vs rename it) with an observability blast radius
  (Grafana dashboards may query `trading_mode`). One adversarial round settles drop-vs-rename and the
  dashboard-dependency check before spec.
- Development branch: `feature/fix-agent-trading-mode-otel-attr`.

---

## Session 2026-09-04 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- First pass FAILED (2 blockers): C-15 (no numbered FR / no @FR tags), C-14 (no Consumer Surface).
  Fixed: added FR-1 (drop-or-rename the trading_mode OTel attr, decided at design) + FR-2 (non-blocking
  init), tagged @AC-1 @FR-1 / @AC-2 @FR-2, added `## Consumer Surface(s)` (None — internal/platform-only,
  a telemetry resource attribute). Re-review PASS (0 blockers, 0 warnings).
- All code claims verified against telemetry.py:33/38/39. Drop-vs-rename correctly deferred to design (OQ-1).
- Overlap: CLEAN. (Feature 084 references the `TRADING_MODE` compose env var — a different resource than
  the OTel attribute — no clash.)
- Warnings carried into design: none. Design depth: quick (SEV-3, single service, one open decision).

---

## Session 2026-09-04 — sdd-design (fleet-wide re-scope)

- Phase 0 Recon: wrote recon.md. PIVOTAL finding — `trading_mode` is a fleet-wide OTel attribute
  (12 telemetry modules emit it identically; documented `packages/otel/dashboards/README.md:40`),
  NOT an agent-local defect. No dashboard/alert queries it (grep of `packages/otel/**` → README only;
  `otel-collector-config.yaml` does not group on it). Mirrors `deployment.environment` 1:1 in both
  deploy targets (`.do/app.yaml:31` prod=live, `.do/app.dev.yaml:31` dev=paper). `OTEL_ENABLED=false`
  in both `.do` specs. C-16 inert (no @AC governs telemetry).
- Phase 1 Grilling: **3 rounds**, approved, no Floor breach.
  - R1: de-scope-vs-agent-only-vs-fleet. Proposer recommended de-scope; adversary proved the label is
    redundant-but-harmless (not "carries signal") and the docs-only variant would enshrine a false claim.
  - **User decision (R1 gate): fleet-wide removal** — the only internally-consistent fix.
  - R2: fleet structure. Adversary flagged the plain-map test as vacuous-green (fails-1648/1653) and
    @AC-2 needing real init.
  - R3: locked real-Resource assertions (builder = sole init input), agent @AC-2 via forced-except
    branch (monkeypatch OTLPSpanExporter to raise at telemetry.py:43, before set_tracer_provider:46 /
    instrument:48 → except:52, zero global mutation), ledger Node rep confirmed, out-of-repo Grafana
    accepted residual. Adversary R3: SOUND — APPROVE-READY.
  - **User decision (R3 gate): test ALL 12 modules — NO C-08 waiver.** Every backend module (Go×3,
    Python×4, Node×4) gets its own builder extraction + real-Resource absence test; UI (frontend)
    gets the one-line deletion verified by tsc/vitest. @AC-1 outline expanded to all 11 backend modules.
- Chosen approach: fleet-wide delete of the `trading_mode` attr + dead local TRADING_MODE read from all
  12 telemetry modules + README line; keep TRADING_MODE env var (live routing axis). UI = one-line
  deletion (not whole-file). Single PR.
- Constitution: C-08/P-06 honored WITHOUT waiver (per-module tests); C-14 internal-only; C-16 inert;
  F-04 (non-rep exact lines pinned at /sdd-spec); no Floor breach.
- Status: spec-ready → design-approved.
- Open Threads (→ /sdd-spec / execute): call-site builder guardrail (init must CALL the builder, no
  inlined copy); UI exact line + dead-module question; per-module test runner pickup; out-of-repo
  Grafana accepted residual.
- Findings reconciliation (do at execute/PR, with the teardown audit): the open finding entries
  `docs/context-constitution-findings.md`/`context-scrubber-findings.md` re: the `trading_mode` OTel
  label are being resolved by THIS feature (fleet-wide removal) — annotate/close them when 171 lands so
  the next comment audit doesn't re-file (P-03). The triage report already routes item 1 → feature 171.
