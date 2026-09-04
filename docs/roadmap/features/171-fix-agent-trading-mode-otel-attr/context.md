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

---

## Session 2026-09-04 — sdd-spec

- Generated implementation-spec.md with **8 steps**. Status: design-approved → implementation-ready.
- Structure: language-grouped (Go / Python / Node backend each a paired `service`+`test` step) +
  UI one-line deletion (frontend, no paired backend test, C-08 exempt) + README `docs` step. Grouping
  by language (not 24 per-module steps) because the edit is grep-confirmed byte-identical within each
  language; per-module **test files** still land for every backend module (design's no-C-08-waiver
  thoroughness = per-module coverage, satisfied by test files, not step count).
- Builder-extraction guardrail encoded in every service step (design Open Risk): init must **call** the
  extracted builder as the sole Resource input — Go `newResource(ctx)`, Python `_build_resource()`,
  Node `buildResource()` — no inlined attribute list/dict/object left behind (else the paired test is
  vacuous). Tests assert the **real SDK Resource** `.Attributes()`/`.attributes`, never a proxy map
  (design R2/R3, fails-1648/1653).
- Key codebase findings (all grep/Read-confirmed):
  - 12 modules, exact `trading_mode` lines: Go `trading|portfolio|marketdata/internal/telemetry/otel.go:46`;
    Python `agent/app/telemetry.py:33,39`, `ingest|indicators|analysis/app/telemetry.py:29,35`;
    Node backend `ledger:27`, `identity:27`, `config:26`, `notify:28` (`src/telemetry.ts`);
    Node frontend `ui/src/telemetry.ts:21`. README `packages/otel/dashboards/README.md:40`.
  - Node runner split (matters for the Node test step): ledger/identity run `.ts` directly
    (`node --experimental-strip-types --test src/__tests__/*.test.ts`); config/notify compile-first
    (`tsc && node --test dist/__tests__/*.test.js`). All test source lives in `src/__tests__/*.test.ts`
    regardless; `pnpm run test:coverage` (c8 ≥40) is the per-service verification either way.
  - UI telemetry uses `resourceFromAttributes` (not `new Resource` like the 4 Node backends) → kept as a
    one-line deletion, not extracted (design).
  - Go telemetry lands in the `telemetry/` package, which CI's Go `-coverpkg` **excludes** — noted in the
    Go test step: no coverage threshold applies, direct `go test ./internal/telemetry/` is the C-08 gate.
  - indicators pytest threshold is **50** (not 40); agent/ingest/analysis are 40.
  - AC-2 (non-blocking) covered by the agent forced-`except` test only (sole module with process-wide
    init side effects: `set_tracer_provider` + `GrpcAioInstrumentorClient().instrument()`); exact
    monkeypatch seam for `OTLPSpanExporter` (module-local vs source-module) resolved at execute.
  - AC-3 (README) covered by the docs step's `grep -rn 'trading_mode' packages/otel/` verification (the
    one non-test-step coverage — pure-docs scenario, justified in Execution Summary).
- No proto/migration/config changes. `TRADING_MODE` env var + its docker-compose/.do values are
  explicitly NOT touched (live routing axis) — each service step says so.

### Open Threads (→ /sdd-review impl-spec / execute)

- Python test import `from opentelemetry.sdk.resources import Resource` needs `opentelemetry-sdk`
  importable in each service's dev/test env — if a service's dev extras lack it, add + `uv lock` in the
  same step (flagged in Step 4).
- Exact `buildResource` import extension (`../telemetry.ts` vs dist-resolved `../telemetry`) per Node
  runner — resolve at execute to match each service's harness.
- Findings reconciliation carried from design: close the open `trading_mode` OTel entries in
  `docs/context-constitution-findings.md` / `context-scrubber-findings.md` when 171 lands (P-03), so the
  next comment audit doesn't re-file.
