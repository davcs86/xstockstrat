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

---

## Session 2026-09-04T18:52:00Z — sdd-review impl-spec (advisory)

- Result: **PASS** — 0 failures, 2 warnings (advisory — did not block). All 12 telemetry modules + line numbers verified; no Floor risk.
- Carried into execution:
  - Step 2: coverage threshold not stated — [x] no action (telemetry/ is coverage-EXCLUDED from Go -coverpkg; direct `go test` is the C-08 gate). Reviewer-verified exception.
  - Step 8: AC-3 covered by a grep in Verification rather than a test-step/RED (C-15 prefers a RED assertion) — [x] no action (pure-docs scenario, justified).
- Overlap findings: CLEAN — no migration/proto/config/file collision. Shared service dirs with 175 (config vs telemetry files) and 172/173/174 are different files; courtesy merge coordination only.

---

## Session 2026-09-04 — sdd-execute (sequential; stacked PR #4 of 5, base feature/fix-portfolio-max-drawdown-unenforced)

Fleet-wide removal of the redundant `trading_mode` OTel resource attribute + dead local read across 12 telemetry modules. TRADING_MODE env var kept (live routing axis). golangci-lint v2.13.1@go1.27 reused. Auto-proceed.

### Step 1 — Go telemetry: extract newResource, drop trading_mode (trading/portfolio/marketdata) [done]
- Each `internal/telemetry/otel.go`: extracted `newResource(ctx)` as the sole Resource input to `Init` (moved the svcName block in), deleted the `attribute.String("trading_mode", ...)` line. `attribute`/`os` imports still used. Comment trimmed to state the sole-input invariant (test guards the omission). No `.do`/compose env changes.
- Files: `services/xstockstrat-{trading,portfolio,marketdata}/internal/telemetry/otel.go`.

### Step 2 — Go telemetry per-module absence tests (AC-1) [done]
- New `otel_test.go` (package telemetry, calls unexported `newResource`) in all 3 services asserting the built SDK Resource omits `trading_mode` and keeps service.name/deployment.environment/platform.
- Red→green: compile-RED (`undefined: newResource`) → all 3 pass. golangci-lint 0 issues; grep `trading_mode` clean in Go telemetry. Coverage: telemetry/ is Go -coverpkg-excluded (direct `go test` is the C-08 gate).
- Files: `services/xstockstrat-{trading,portfolio,marketdata}/internal/telemetry/otel_test.go`. Deviations: none.

### Step 3 — Python telemetry: extract _build_resource, drop trading_mode (agent/ingest/indicators/analysis) [done]
- Each `app/telemetry.py`: extracted module-level `_build_resource()` (deferred SDK import) as the sole Resource input to `init_telemetry`; deleted the `trading_mode`/`environment` locals and the inline `Resource.create({...})` dict (dropping the `trading_mode` key). `svc_name`/`endpoint` kept (exporter + log). No `.do`/compose env changes.
- Files: `services/xstockstrat-{agent,ingest,indicators,analysis}/app/telemetry.py`.

### Step 4 — Python telemetry per-module tests (AC-1) + agent non-blocking init (AC-2) [done]
- New `tests/test_telemetry.py` in all 4 asserting the built Resource omits `trading_mode`, keeps the trio. Agent adds `test_init_telemetry_non_blocking_on_error`: patches the source-module `OTLPSpanExporter` to raise (the name is locally imported inside init's try) → `init_telemetry()` swallows it and sets no global provider (AC-2).
- Red→green: ImportError (`_build_resource` absent) → all pass. Coverage: agent 81.18%, ingest 76.69%, indicators 81.10% (≥50), analysis 85.19% (all ≥ threshold). ruff clean (fixed a docstring line length). grep `trading_mode` clean.
- Files: `services/xstockstrat-{agent,ingest,indicators,analysis}/tests/test_telemetry.py`. Deviations: none (agent env needed `uv sync --extra dev` first — no dep/lock change).

### Step 5 — Node telemetry: extract buildResource, drop trading_mode (ledger/identity/config/notify) [done]
- Each `src/telemetry.ts`: extracted exported `buildResource()` as the sole Resource input to `initTelemetry`, removed the inline `new Resource({...})` + the `trading_mode` line, and dropped the now-unused inline Resource/SEMRESATTRS requires from init. **Deviation**: `buildResource` uses static top-level imports of `@opentelemetry/resources` + `@opentelemetry/semantic-conventions` (hard deps) instead of deferred `require`, so the design-mandated test is callable from ledger/identity's ESM strip-types runner (require undefined in ESM). Heavy SDK/exporter imports stay deferred. See Deviation Log.
- Files: `services/xstockstrat-{ledger,identity,config,notify}/src/telemetry.ts`.

### Step 6 — Node telemetry per-module absence tests (AC-1) [done]
- New `src/__tests__/telemetry.test.ts` in all 4 (node:test + node:assert/strict, static `buildResource` import) asserting the built Resource omits `trading_mode`, keeps the trio. ledger/identity import `../telemetry.ts` (ESM), config/notify `../telemetry` (CJS) — per-runner extension.
- Red→green: RED (require-undefined / buildResource missing) → all pass after the Step 5 static-import fix. Coverage: ledger 46%, identity 46%, config 80.16%, notify 88.57% (all ≥40). lint 0 errors. grep `trading_mode` clean.
- Files: `services/xstockstrat-{ledger,identity,config,notify}/src/__tests__/telemetry.test.ts`. Deviations: static-import + import-extension (Deviation Log).

### Step 7 — UI telemetry: one-line trading_mode deletion (frontend) [done]
- Deleted the `trading_mode: process.env.TRADING_MODE ?? 'paper',` line from `resourceFromAttributes({...})`; kept `resourceFromAttributes` + the trio. No builder extraction (frontend, C-08 backend pairing exempt). grep clean. `tsc --noEmit` shows telemetry.ts clean (the only tsc error is a PRE-EXISTING, unrelated `src/middleware.test.ts` MockInstance type issue — not introduced here; the UI runs vitest/next lint in CI).
- Files: `services/xstockstrat-ui/src/telemetry.ts`.

### Step 8 — docs: drop trading_mode from dashboards README (AC-3) [done]
- Dropped `trading_mode` from the Resource-attributes bullet; kept service.name/deployment.environment/platform. AC-3 grep `grep -rn 'trading_mode' packages/otel/` returns no matches.
- Files: `packages/otel/dashboards/README.md`.

### C-16 promotion + finalize
- Promoted AC-1 (outline, 11 backend modules) / AC-2 / AC-3 → `docs/sdd/business-rules/platform.feature` (`@feature-171`, cross-cutting telemetry guarantee). Findings reconciliation: grep found NO open `trading_mode` OTel entries in root findings / scrubber-findings (design thread was "close if present" — none exist; other doc `trading_mode` mentions are the config axis/env var, unchanged). Teardown: no CLAUDE.md/constitution context file touched (only telemetry code + dashboards README, not a scrubberExtraTarget) → no context-forge refresh owed.

## Session 2026-09-04 — sdd-execute summary (feature 171)
**Steps this session**: 1–8 (all)
**Progress**: 8 done / 8 total
**Stopped at**: all complete → code-completed
**Accountability**: out-of-scope changes: none (TRADING_MODE env var + .do/compose values untouched, as specced). Open questions: none. Unaddressed review warnings: none. **Deviation (surfaced)**: Node `buildResource` uses static top-level imports of two hard-dep OTel packages instead of deferred `require`, so the C-08 per-module test runs under both the CJS and ESM Node test runners — see Deviation Log.
**Next**: stacked integration PR #4 (base `feature/fix-portfolio-max-drawdown-unenforced`); then feature 175.
