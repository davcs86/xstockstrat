# Design: fix-agent-trading-mode-otel-attr (fleet-wide)

**Created**: 2026-09-04
**Rounds**: 3 (full-equivalent; termination: approved) — 1 (de-scope-vs-fleet-vs-agent) + 2 (fleet structure) + 3 (test correctness)
**Approved by**: user @ 2026-09-04
**Grounded in**: recon.md

---

## Chosen Approach

**Fleet-wide removal** of the `trading_mode` OpenTelemetry resource attribute (and its now-dead local
`TRADING_MODE` read) from **all 12 telemetry modules**, plus the `packages/otel/dashboards/README.md`
line documenting it. The `TRADING_MODE` **env var itself stays** — it remains a live paper/live routing
axis (portfolio/trading/indicators/ingest). Internal/platform-only (C-14); recon confirmed nothing
in-repo queries the attribute (`recon.md`), and `OTEL_ENABLED=false` in both `.do` specs.

**Why fleet-wide** (user decision at the R1 gate): recon proved `trading_mode` is not an agent-local
defect but a fleet convention emitted identically by every module, redundant with `deployment.environment`
1:1 in both deploy targets (`.do/app.yaml:31` prod=live, `.do/app.dev.yaml:31` dev=paper). Agent-only
would make the agent the lone divergent service; de-scope would leave a redundant label. Fleet-wide is
the only internally-consistent fix.

**Per-module edit** (grep-confirmed byte-identical within each language; exact non-rep lines pinned at
`/sdd-spec`, not invented — F-04/C-01):
- **Go (3)** `trading/portfolio/marketdata/internal/telemetry/otel.go` — delete the inline
  `attribute.String("trading_mode", os.Getenv("TRADING_MODE"))` (`trading otel.go:46`). Keep the
  `attribute` import + `os` (both still used).
- **Python (4)** `agent/ingest/indicators/analysis/app/telemetry.py` — delete the local
  `trading_mode = os.getenv("TRADING_MODE", "paper")` (`agent:33`) and the `"trading_mode": trading_mode,`
  attribute line (`agent:39`).
- **Node backend (4)** `ledger/identity/config/notify/src/telemetry.ts` — delete
  `trading_mode: process.env.TRADING_MODE ?? 'paper',` (`ledger:27`).
- **Node frontend (1)** `xstockstrat-ui/src/telemetry.ts` — delete only the `trading_mode` attribute line
  (`:21`), matching the fleet (NOT a whole-file removal — minimal, and consistent with "init intact").
- **Docs** `packages/otel/dashboards/README.md:40` — drop `trading_mode` from the documented list.

**Testing — every backend module (no C-08 waiver; user rejected the representative waiver).** Each of
the 11 backend modules extracts its Resource construction into a **builder that is the sole input to
init**, and gets a paired test asserting `trading_mode` is absent (and `service.name`/
`deployment.environment`/`platform` present) on the **actually-built SDK Resource** — RED against
current code (attribute present), GREEN after the delete. This is not a proxy map (averts fails-1648/1653
vacuous-green). **Guardrail (`/sdd-spec` must enforce):** init must *call* the extracted builder, never
retain an inlined copy of the attribute dict, or the test goes vacuous.
- **Go**: `newResource(ctx) (*resource.Resource, error)`; internal `otel_test.go` per module asserts
  `res.Attributes()`. Run `GOWORK=off go test ./internal/telemetry/`.
- **Python**: `_build_resource() -> Resource` with a deferred `from opentelemetry.sdk.resources import
  Resource` inside it, returning `Resource.create({trio})` (does NOT set the global provider); per-module
  `tests/test_telemetry.py` asserts `res.attributes`. Run `uv run pytest --cov=app`.
- **Node**: `buildResource(): Resource`; per-module `src/__tests__/telemetry.test.ts` (ledger runner
  confirmed: `node --experimental-strip-types --test src/__tests__/*.test.ts` + c8 ≥40).
- **`@AC-2` non-blocking** lives in the **agent** test (only its init has process-wide side effects:
  `set_tracer_provider` `:46` + `GrpcAioInstrumentorClient().instrument()` `:48`). Mechanism: monkeypatch
  `OTLPSpanExporter` (constructed at `:43`, before `:46`/`:48`) to raise → routes to `except` `:52` with
  **no global provider set and grpc.aio never patched** — real init, enters the guard, zero global
  mutation, no teardown needed.
- **UI (12th module)**: frontend — its `trading_mode` line removal is verified by the UI's `tsc` +
  vitest/Playwright pipeline, not a backend-style attribute test (outside C-08 backend pairing).

**Ordering**: single PR. Nothing queries the attribute, so removal is technically incremental-safe, but
one PR keeps the README (which claims "every service attaches it") from ever describing a zero-to-partial
state.

## Rejected Alternatives

- **De-scope / demote 171** — rejected by the user in favor of fixing the redundancy fleet-wide; the
  label duplicates `deployment.environment` and is worth removing for consistency.
- **Agent-only drop/rename** — rejected: makes the agent the lone divergent service; "rename" also
  rejected (the label is redundant, not mislabeled — removal is the honest fix).
- **Representative-per-language tests (C-08 waiver)** — proposed in R3, **rejected by the user**: every
  backend module gets its own test instead. (More tests, but no Commandment waiver and full per-module
  behavioral coverage.)
- **Plain-map builder test (no SDK types)** — rejected: asserts a proxy, not the built Resource →
  vacuous-green (fails-1648/1653). Assert the real SDK Resource via the sole-input builder.
- **Whole-file deletion of `ui/src/telemetry.ts`** — rejected: expands scope beyond the one-line fleet
  change and contradicts "init intact"; one-line deletion is minimal.

## Open Risks

- [ ] **Call-site refactor guardrail** — each module's init must *call* the extracted builder as the sole
  Resource source; a surviving inlined attribute dict makes the test vacuous. Enforce at `/sdd-spec`/execute.
- [ ] **Out-of-repo Grafana residual** — the real consumers of an OTel resource attribute are out-of-repo
  Grafana Cloud dashboards/alerts, invisible to grep (fails-1638 analog). Removal degrades any such panel
  dimension to "no data" (not an error). **Accepted** known residual — low severity, and `OTEL_ENABLED=false`
  in both deploy targets means neither env emits telemetry today. Recorded, not silent.
- [ ] **UI exact line + dead-module question** — `ui/src/telemetry.ts` exact `trading_mode` line resolved
  by grep at `/sdd-spec`; keep to the one-line deletion unless a separate dead-module cleanup is signed off.
- [ ] **Coverage** — deleting a line cannot drop any service's ≥40% gate; the new per-module telemetry test
  only adds coverage. Confirm each new test file is picked up by its service's runner at execute.

## Constitution Rules Touched

- `C-08` / `P-06` — honored **without a waiver**: every backend `service` edit has a paired per-module
  `test` step with a real-Resource RED-before-green assertion; the UI frontend module is verified by its
  own pipeline.
- `C-15` — honored: `@AC-1` (outline over all 11 backend modules) → the per-module tests; `@AC-2` → the
  agent forced-except test; `@AC-3` → the README docs step. Every FR covered.
- `C-16` — **inert** (recon + adversary confirmed): no `@AC-*` governs OTel resource attributes.
- `C-14` — internal/platform-only, stated with reason (resource attribute; no UI/MCP surface).
- `C-05`/`F-07` — no config values hardcoded/changed; `TRADING_MODE` env var retained.
- `F-04`/`C-01` — no invented paths: all 12 modules grep-confirmed to contain `trading_mode`; exact
  non-representative lines pinned at `/sdd-spec`.
- How-to-Act #2/#3 — UI kept to a one-line deletion; per-module tests are the user's chosen thoroughness
  over the waiver, not speculative scaffolding.
- No Floor (`F-*`) breach in any round.

## Business Rules Touched (C-16)

None — no existing `@AC-*` guarantee governs telemetry resource attributes (net-new observability change).
On launch, `@AC-1`/`@AC-2`/`@AC-3` seed new durable scenarios (scenario-promoter), amending nothing.
