# Implementation Spec: fix-analysis-admin-formula-refusal

**Status**: `pending`
**Created**: 2026-11-05
**Feature**: `docs/roadmap/features/289-fix-analysis-admin-formula-refusal/feature.md`
**Total Steps**: 14 (Step 8 is delivered as sub-steps 8a + 8b; numbering unchanged)
**Feature Branch**: `feature/fix-analysis-admin-formula-refusal`
**Tree**: `origin/feature/fix-analysis-admin-formula-refusal@94908ce6 ≡ origin/main-dev` (re-spec 2026-11-05: the feature branch now exists on origin; `git merge origin/main-dev` → already up to date; `git rev-list --left-right --count HEAD...origin/main-dev` → `0 0`). Re-spec 2026-11-06 (steps 2, 4, 6, 9, 11): `git merge origin/main-dev` → already up to date (`origin/main-dev` still `94908ce6`; branch 6 SDD-doc commits ahead, 0 behind). Original spec tree: `ccr-e5badadb-vrersi@a75d1916`.

---

## Execution Summary

The fix makes an indicators refusal of a formula the caller cannot read (`NOT_FOUND` or `PERMISSION_DENIED` on `ExecuteFormula`) a first-class "formula not readable" state on every analysis surface that traces readiness, via a private per-call sink in the traced evaluator (`design.md` § Chosen Approach). Build order follows `design.md`: proto (Steps 1-2, the generated stubs and the two descriptor-parity carries land together so the existing parity guards never go red on a step PR) → analysis read side (3-4) → evaluator sink (5-6) → servicer producer wiring incl. the global `_formula_fundamentals` classification (7, 8a/8b) → agent (9-10) → UI (11-12) → docs (13) → the deferred C-16 durable-suite promotion (14, integration PR only).

**Consumer surfaces (C-14).** The product spec names two surfaces and each has its own step: **UI** = Step 11 (service) + Step 12 (tests/fixtures/Playwright), touching `services/xstockstrat-ui/` (`/insights/opportunities`, mobile sections, `/insights/watchlists` readiness panel, `/trader/positions/[symbol]` "Why this fired" panel and header); **Agent** = Step 9 (service) + Step 10 (tests), touching `services/xstockstrat-agent/` (`list_opportunities`; the agent has no readiness tool). No new page/route, so the C-10(a) `PLATFORM_SUBNAV` registration does not apply.

**Test pairing (C-08, P-06).** Every non-frontend `service` step (3, 5, 7, 9) is followed immediately by its `test` step (4, 6, 8a+8b, 10), authored to fail first on the pre-implementation tree. The UI service step (11) is paired with Step 12 the same way. Step 2 is a `proto-gen` step that also carries the two one-line descriptor-parity edits: the existing guards `TestOpportunityRowParity` (analysis) and `test_opportunity_projection_covers_every_proto_field` (agent) go red on regen and green on the carry, which is its red-before-green proof.

**Scenario Coverage (C-15)** — `@AC-14` is retired (superseded by `@AC-15`, never reused) and is not covered:

| Scenario | Covering step(s) |
|---|---|
| @AC-1 | 6 (evaluator unit: referenced PERMISSION_DENIED → 0/0 + marker), 8a (`_compute_opportunities` end to end, `s-2` unaffected, no "indicator RPC failed" log) |
| @AC-2 | 6 (`compute_readiness_row` → 0/0, `bar_epoch >= 0`), 8a (`EvaluateReadiness` SLOW returns OK, no `AioRpcError`) |
| @AC-3 | 4 (RESOLVED funnel from a seeded cache row), 8a (kick + `GetWatchlistReadiness`: `MYSZ` and `AAPL` both RESOLVED, no "readiness refresh kick failed") |
| @AC-4 | 8a (UNAVAILABLE → `data_unavailable`, no marker) |
| @AC-5 | 6 (`raise_unreadable` checked first, with and without a sink), 8a (backtest FORMULA_ERROR unchanged) |
| @AC-6 | 10 |
| @AC-7 | 12 (Playwright, four surfaces) |
| @AC-8 | 8a (materializer persists the verdict and continues) |
| @AC-9 | 8a (heal) |
| @AC-10 | 6 (evaluator: mixed unreadable + timeout raises), 8a (recompute fails, rows retained) |
| @AC-11 | 8a (live loop: PERMISSION_DENIED pair isolated, no sink; new test asserts the `live_loop: … — continuing` warning) |
| @AC-12 | 8a (heal on recovery) |
| @AC-13 | 6 (evaluator), 8a (`EvaluateReadiness` aborts on the timeout) |
| @AC-15 | 6 (evaluator: NOT_FOUND → marker, one log line), 8a (`_compute_opportunities`) |
| @AC-16 | 6, 8a (unreferenced refused component skipped, no marker, one log line) |
| @AC-17 | 4 (floor survival, not a source, not in `available_sources`), 8a (non-held rank/action) |
| @AC-18 | 8a (held rows, both Examples rows) |
| @AC-19 | 8a (daily refresh + materializer with owner-only metadata) |
| @AC-20 | 4 (FAST funnel), 8a (second call served without calling indicators) |
| @AC-21 | 4 (storage round-trip), 8a (sibling `fetch_failed` bleed, one log line) |
| @AC-22 | 8b (backtest, gate ON, both start branches) |
| @AC-23 | 8b (`ScoreStrategy`, gate ON; outage still aborts) |
| @AC-24 | 8b (opportunities + heal, gate ON) |
| @AC-25 | 8b (gate ON, `GetFormula` UNAVAILABLE stays data-unavailable) |
| @AC-26 | 8a (next recompute evaluates normally) |
| @AC-27 | 12 (Playwright, held REDUCE + cue) |

**Anchor re-verification (F-04).** Every `path:line` below was re-grepped in this tree (`a75d1916`). `design.md`/`recon.md` anchors for `evaluator.py`, `servicer.py` (opportunities, heal, `_formula_fundamentals`, `_declared_formula_warmup`, `recompute_unscored_pairs`, read-back), `opportunities.py`, the agent and the UI all still resolve. Corrections only: `test_fundamentals_pit_pager.py` — the servicer sibling is `:295-302` and the evaluator sibling `:304-311` (both use UNAVAILABLE today; the NOT_FOUND parameters are added in Step 8b); `test_grade_fundamentals_exclusion.py` — the boot-pass test is `:387-396` with the `GetFormula` count assertion at `:396` (`:395` is the `GetHistoricalFundamentals` count; design cited `:389-396`); `WatchlistReadiness.tsx` — the `readinessState` switches are at `:52` (`barVariant`) and `:74` (`stateLabel`), the rollup at `:235`, the cue at `:296` (design cited `:59,81`); the agent projection function starts at `client.py:839` and the tool docstring field list at `tools.py:1697-1704` (re-spec 2026-11-05 at `94908ce6`; was `:817` / `:1692-1704` at `a75d1916`).

**Operator action — pre-rollout blast-radius measurement (read-only, before the dev rollout; goes in the PR body, `design.md` § Pre-rollout).** Unifying `NOT_FOUND` turns today's quiet partial rows into marked rows for every owner of a deleted / legacy-author / hidden formula. Run on a connection that reaches both schemas (verify reachability on the DO cluster first — **unverified**), then run `uv run python -m app.maintenance.legacy_authors --users users.json --out plan.json` in report mode (`services/xstockstrat-indicators/CLAUDE.md:221-225`, `docs/runbooks/legacy-formula-authors.md`):

```sql
SELECT s.user_id, s.strategy_id, c->>'formula_id' AS formula_id, f.author
FROM analysis.strategies s
CROSS JOIN LATERAL jsonb_array_elements(s.definition_json::jsonb->'components') c
LEFT JOIN indicators.formulas f ON f.formula_id::text = c->>'formula_id'
WHERE coalesce(c->>'formula_id','') <> ''
  AND (f.formula_id IS NULL OR f.pending_intent_id IS NOT NULL
       OR (f.author <> s.user_id AND f.author <> 'system'));
```

No `deleted_at` filter: soft-deleted formulas still execute. The Loki log line carries no user id and is deduped per evaluator, so it cannot give a per-user count.

**Follow-up defect (not re-created here):** genuine-outage batch loss in the kick / materializer / heal and the symbol-wide `fetch_failed` bleed are filed as `docs/reports/2026-11-05-analysis-readiness-batch-loss-on-indicator-outage-defect.md` (status sidecar `open`); Out of Scope for this feature.

## Step Dependencies

- Step 2 requires Step 1: regen needs the `.proto` change; Step 2 also carries the `_row_to_opportunity` line and the agent whitelist line so the existing descriptor-parity guards stay green (Build order 1).
- Step 3 requires Step 2 (new proto fields). Step 4 [test] covers Step 3 [service]. Step 5 [service] is independent of Steps 3-4 at build time (pure evaluator change) and is ordered after them to keep each PR small. Step 6 [test] covers Step 5 [service]. Step 7 [service] requires Steps 3 and 5 (it consumes the evaluator marker and writes the provenance token the read side reads). Steps 8a and 8b [test] together cover Step 7 [service]: 8a covers the row / heal / readiness wiring (Step 7 Instructions 1-2), 8b covers the gate-ON fundamentals classification and per-owner cache (Instructions 3-6). 8b requires 8a only for authoring convenience (`test_unreadable_formula.py` helpers); both must be green before Step 7 merges.
- Step 9 [service] requires Step 2 (generated `Opportunity.formula_unreadable`); Step 10 [test] covers Step 9 [service].
- Step 11 [service] requires Step 2 (regenerated TS stubs `formulaUnreadable` on `Opportunity` and `SymbolReadiness`). Step 12 [test] covers Step 11 [service]. UI steps are independent of Steps 3-8 at build time (the Playwright mock backend serves the marker) but are only user-visible once Step 7 ships.
- Step 13 [docs] requires Steps 7, 9 and 11 (documents the shipped behaviour). **Same-PR rule (root `CLAUDE.md` Context Guide, last row; `docs/patterns/strat-lab-plugin.md:13-14`):** Step 13's strat-lab edits must ship in the same PR as Step 7's gate-ON backtest behaviour change. With per-step PRs into `feature/fix-analysis-admin-formula-refusal`, that means the integration PR to `main-dev` — **do not merge Step 7 (or 8b) to `main-dev` without Step 13**.
- Step 14 [docs] is **deferred to the `/sdd-execute` integration PR** (C-16: promotion of scenarios into the durable per-service suites on launch/integration; `/promote` is the backstop). It does not gate the per-step PRs.
- **Merge coordination with feature 294 (`signal-map-instrumentation`, `implementation-ready`) — rebase-only.** 294's Step 13 edits `services/xstockstrat-analysis/app/services/evaluator.py` in exactly one hunk (the `fundamentals formula=` `log.info` → `log.debug` at `evaluator.py:613-614`, inside `_fundamentals_formula_series`) and `servicer.py` only in the tick/`_kick_*` regions and the `PIT fundamentals loaded` log near `servicer.py:1894-1896` (`294/implementation-spec.md:559-575,585-590`). It does **not** edit `_execute_formula`, so per `design.md` Open Risks no `merge-order.md` row is added. Our hunks in the same function are at `evaluator.py:552` (signature) and `:590-599` (the `_execute_formula` call); the nearest 294 hunk is ≥ 14 lines away, so the overlap is textual at most. Whichever lands second rebases and re-greps every anchor in this spec before editing (294 and 291 also shift `servicer.py` lines).
- Feature 293 (`fix-analysis-live-loop-budget-seed`) edits analysis `live_loop.py` / `tests/test_live_loop.py` / `CLAUDE.md` config-key rows only (`293/implementation-spec.md:53,92,288`); no overlap with this spec except `services/xstockstrat-analysis/CLAUDE.md` (Step 13 edits different sections) — rebase only.
- Feature 275 / 215 / 224 / 225 behaviours are PRESERVE guards (`design.md` § Business Rules Touched); Steps 8a/8b re-assert them.

---

### Step 1 — proto: add `formula_unreadable` to `Opportunity` and `SymbolReadiness`

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/analysis/v1/analysis.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness per message, no breaking changes, `buf lint` + `buf breaking` against the dev trunk, BSR publication readiness; xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias; xstockstrat-ui owner — Connect-RPC call safety, analytics display accuracy; xstockstrat-agent owner — MCP tool contract stability and `mcp-tools.md` parity

**Codebase Evidence**:
- Confirmed via: `grep -n "fundamentals_gap = 24\|fundamentals_unavailable = 23\|data_unavailable = 20" packages/proto/analysis/v1/analysis.proto` → `:653`, `:651`, `:637`. `message Opportunity` spans `:603-654`; the highest field is `fundamentals_gap = 24`, so **25** is the next free number.
- Confirmed via: `grep -n "^message SymbolReadiness" ...` → `:673`; fields 1-5 (`conditions = 5` at `:678`), so **6** is the next free number. `SymbolReadiness` is shared by `EvaluateReadinessResponse.readiness = 1` and `WatchlistReadinessRow.readiness = 4` (`:737-761`).
- Confirmed via: `grep -n reserved packages/proto/analysis/v1/analysis.proto` → two comment hits, `:200` (`// reserved; not emitted this version`) and `:422` (the word "preserved"); **no `reserved` statement** exists, so additive is safe (re-spec 2026-11-05).
- Existing pattern: `bool data_unavailable = 20;` (`:637`) with a `// feature 185 — …derived at read from the "unavailable" provenance marker (no column)` comment; `bool fundamentals_unavailable = 23;` (`:651`).
- `packages/proto/buf.yaml` exists; CI runs `buf lint packages/proto/` and `buf breaking` (`.github/workflows/ci.yml:160-180`). CI's `buf breaking` also passes `--exclude-path trading/v1/trading.proto` (a temporary entry for feature order-time-in-force-enum, `ci.yml:179-180`); the Verification below omits it, which is harmless against `origin/main-dev` because `trading.proto` is identical on both sides.

**TDD**: N/A (`proto` category — non-code-bearing; `buf breaking` is the verification).

**Covers**: —

**Instructions**:
1. In `message Opportunity`, after `FundamentalsGap fundamentals_gap = 24;` (`:653`), add `bool formula_unreadable = 25;` with a ≤ 3-line comment: feature 289 — a component formula the traced rule references was refused by indicators (NOT_FOUND / PERMISSION_DENIED); derived at read from the `"formula_unreadable"` provenance marker (no column); mutually exclusive with `data_unavailable` / `fundamentals_unavailable`.
2. In `message SymbolReadiness`, after `repeated ConditionEval conditions = 5;` (`:678`), add `bool formula_unreadable = 6;` with a ≤ 2-line comment: rides `readiness_json["formula_unreadable"]` (no column); a RESOLVED 0-of-0 result with a real `bar_epoch >= 0`, never the `-1` UNKNOWN sentinel.
3. A bool, not an enum (C-04 targets closed value sets carried as strings; the sibling markers `muted = 12`, `data_unavailable = 20`, `fundamentals_unavailable = 23` are bools — trade-off recorded in `design.md`). Do not add a `reserved` statement and do not renumber anything.
4. Proto approval gate (C-09, `docs/runbooks/approval-flow.md`): additive field → Proto Reviewer + service owners; no breaking change.

**Verification**:
```bash
cd "$(git rev-parse --show-toplevel)" && buf lint packages/proto/ && (cd packages/proto && buf breaking . --against "../../.git#branch=origin/main-dev,subdir=packages/proto")
```
(The `../../.git#branch=origin/<base>,subdir=packages/proto` form is the CI form, `.github/workflows/ci.yml:163-180` (`origin/${{ github.base_ref }}`; in sequential mode the integration PR targets `main-dev`, so compare against `origin/main-dev` as written); run from `packages/proto` so the module root matches. Every Verification block runs from `$(git rev-parse --show-toplevel)`, i.e. the checkout being edited (a worktree), never the main checkout. Never compare against the branch being edited — that is vacuous. Expect: no output / exit 0.)

---

### Step 2 — proto-gen: regenerate stubs and carry the two descriptor-parity guards

**Status**: `done`
**Service**: `packages/proto` (generated), `xstockstrat-analysis` and `xstockstrat-agent` (one-line carries)
**Files**:
- `packages/proto/gen/go/analysis/v1/analysis.pb.go` — modify (generated)
- `packages/proto/gen/python/analysis/v1/analysis_pb2.py` — modify (generated)
- `packages/proto/gen/ts/analysis/v1/analysis_pb.ts` — modify (generated by protoc-gen-es)
- `packages/proto/gen/ts/analysis/v1/analysis.ts` — modify (generated by ts_proto; `analysis_connect.ts` is also checked in but changes only if the service block changes, which it does not; `ts/dist/analysis/v1/analysis{,_pb}.{js,d.ts}` are rebuilt by the script's `tsc` pass — stage whatever `git status --porcelain packages/proto/gen` shows)
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify (`_row_to_opportunity`, one keyword)
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify (`TestOpportunityRowParity._MAPPED`)
- `services/xstockstrat-agent/app/client.py` — modify (`_opportunity_to_dict`, one key)
- `services/xstockstrat-agent/tests/test_opportunity_projection.py` — modify (`_full_opportunity`)

**Reviewers**: (inherited from Step 1) Proto Reviewer — field number uniqueness, `buf lint`/`buf breaking`; xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias; xstockstrat-ui owner — Connect-RPC call safety; xstockstrat-agent owner — MCP tool contract stability and `mcp-tools.md` parity

**Codebase Evidence**:
- Generated stubs are checked in: `git ls-files packages/proto/gen | grep analysis/v1` → `go/analysis/v1/analysis.pb.go` (+ `_grpc.pb.go`, `analysisv1connect/analysis.connect.go`), `python/analysis/v1/analysis_pb2.py` (+ `_pb2_grpc.py`), `ts/analysis/v1/analysis_pb.ts`, `ts/analysis/v1/analysis.ts`, `ts/analysis/v1/analysis_connect.ts` (+ `ts/dist/analysis/v1/analysis{,_pb}.{js,d.ts}`). Never Read/Grep these; read the `.proto`.
- Codegen toolchain (re-spec 2026-11-05). `scripts/buf-gen.sh` runs on whatever host invokes it; it is **not** Docker-based. It needs `buf`, the Go plugins (`$HOME/go/bin`), the TS plugins `protoc-gen-ts_proto` / `protoc-gen-es` / `protoc-gen-connect-es` from `node_modules/.bin` (`buf-gen.sh:24-29`), host `python3 -m grpc_tools` (`:54-66`) and, for the `tsc` pass, the workspace's `typescript` devDependency via `pnpm --filter @xstockstrat/proto run build` (`:84-91`). On this host `python3 -c "import grpc_tools"` → `ModuleNotFoundError`, and no `node_modules` is installed. So a bare host run fails. The Docker path is `scripts/localenv-setup.sh`: it rebuilds the image (`:73-79`), runs `docker run --rm --platform linux/amd64 -v "$REPO_ROOT:/workspace" -w /workspace xstockstrat-codegen ./scripts/buf-gen.sh` (`:87-92`), then writes dev mTLS certs (`:104`). The `xstockstrat-codegen:latest` image is **probably** cached here (re-spec 2026-11-06: unverifiable while the Docker daemon is stopped — `docker images` cannot answer — but the containerd metadata DB under `/var/lib/docker` references `xstockstrat-codegen`); start the daemon first with `dockerd &` as root (`.claude/skills/sdd-execute/reference/tooling-setup.md:32`, `docs/runbooks/codegen-toolchain-host-setup.md:7,151`). It carries buf 1.72.0, `/go/bin/protoc-gen-{go,go-grpc,connect-go}`, global `/usr/local/bin/protoc-gen-{ts_proto,es,connect-es}` and `grpc_tools` (`Dockerfile.codegen:73-108`). It has no `tsc`, so the `tsc` pass needs the mounted workspace's `node_modules` (root `pnpm-lock.yaml` exists, so `buf-gen.sh:85-87` takes the `pnpm --filter` branch). Inside the container a worktree's `.git` file points at an unmounted path, so the guarded `buf breaking` block (`buf-gen.sh:38-42`) is skipped; Step 1's Verification already runs `buf breaking`. Host fallback: `docs/runbooks/codegen-toolchain-host-setup.md`.
- Confirmed via: `grep -n "def _row_to_opportunity" services/xstockstrat-analysis/app/handlers/servicer.py` → `:6803`; its docstring says "a newly-added proto field fails the parity test until it is carried here"; `data_unavailable=("unavailable" in provenance)` and `fundamentals_unavailable=("fundamentals_unavailable" in provenance)` at `:6826-6827` (`fundamentals_gap=` follows).
- Confirmed via: `grep -n "class TestOpportunityRowParity" services/xstockstrat-analysis/tests/test_analysis_servicer.py` → `:6379`; `_MAPPED` set `:6384-6411` ends with `"fundamentals_unavailable", "fundamentals_gap"`; `test_mapper_covers_every_proto_field` (`:6417`) asserts `_MAPPED | _INTENTIONALLY_UNSET == set(Opportunity.DESCRIPTOR.fields_by_name)` (`:6418-6420`).
- Confirmed via: `grep -n "def _opportunity_to_dict" services/xstockstrat-agent/app/client.py` → `:839` (`_opportunity_to_dict(o, analysis_pb2)`, ends `return d` `:902`); `"data_unavailable": o.data_unavailable` `:860`, `"fundamentals_unavailable"` `:862`, `"fundamentals_gap"` `:863`.
- Confirmed via: `tests/test_opportunity_projection.py` `_full_opportunity` (`:18`) builds the full message (`fundamentals_unavailable=True`, `fundamentals_gap=…ETF` at `:41-42`) and `test_opportunity_projection_covers_every_proto_field` asserts `emitted == set(Opportunity.DESCRIPTOR.fields_by_name)` (`:50-54`).

**TDD**: `N/A (generated stubs)` for the regen; the carries are proven red-then-green by the two existing parity guards: after regen and before the carries `TestOpportunityRowParity::test_mapper_covers_every_proto_field` and the agent `test_opportunity_projection_covers_every_proto_field` FAIL (new field unmapped); after the carries they pass.

**Covers**: —

**Instructions**:
1. If the Docker daemon is not running (`docker info` fails), start it as root: `dockerd >/tmp/dockerd.log 2>&1 &` (`docs/runbooks/codegen-toolchain-host-setup.md:151`), then confirm the image with `docker images xstockstrat-codegen`. From the checkout root, install the workspace once: `pnpm install --frozen-lockfile` (pnpm 9.15.9). It provides `tsc` for `buf-gen.sh`'s build pass and the husky pre-commit hook's `lint-staged`. Then regenerate in the cached pinned image with the exact invocation from `localenv-setup.sh:87-92`: `docker run --rm --platform linux/amd64 -v "$(git rev-parse --show-toplevel):/workspace" -w /workspace xstockstrat-codegen:latest ./scripts/buf-gen.sh`. Do not run `./scripts/localenv-setup.sh` itself unless the image is missing (`docker images xstockstrat-codegen` empty), because it also rebuilds the image and writes `./certs/`. If Docker is unavailable, provision the host per `docs/runbooks/codegen-toolchain-host-setup.md` and run `./scripts/buf-gen.sh`. Stage only what it rewrites under `packages/proto/gen/`. If anything outside `gen/*/analysis/v1/` changes (for example, well-known-type doc-comment noise), revert it with `git checkout -- <path>` (ledger `insights.md` 2026-08-26 fundsignal-watchlist-universe).
2. Run the two guards first to capture the RED run (analysis: `uv run pytest tests/test_analysis_servicer.py::TestOpportunityRowParity -q`; agent: `uv run pytest tests/test_opportunity_projection.py -q`).
3. Analysis: in `_row_to_opportunity` add `formula_unreadable=("formula_unreadable" in provenance),` next to `fundamentals_unavailable` (`:6827`), with a ≤ 1-line comment (derived from the provenance marker, no column). In `TestOpportunityRowParity._MAPPED` add `"formula_unreadable",  # feature 289 — derived from the "formula_unreadable" provenance marker at read`.
4. Agent: in `_opportunity_to_dict` add `"formula_unreadable": o.formula_unreadable,` after `"fundamentals_gap"` (`:863`). In `_full_opportunity` add `formula_unreadable=True,  # feature 289`. (Step 9 owns the tool docstring and runbook; this step only keeps the guards green.)
5. Do not touch `SymbolReadiness` mappers here — `_readiness_to_proto` is Step 3.

**Verification**:
```bash
docker info >/dev/null 2>&1 || { dockerd >/tmp/dockerd.log 2>&1 & sleep 2; }
docker images xstockstrat-codegen
cd "$(git rev-parse --show-toplevel)" && docker run --rm --platform linux/amd64 -v "$PWD:/workspace" -w /workspace xstockstrat-codegen:latest ./scripts/buf-gen.sh && git status --porcelain packages/proto/gen
cd "$(git rev-parse --show-toplevel)"/services/xstockstrat-analysis && uv run pytest tests/test_analysis_servicer.py::TestOpportunityRowParity -q && ruff check . && ruff format --check .
cd "$(git rev-parse --show-toplevel)"/services/xstockstrat-agent && uv run pytest tests/test_opportunity_projection.py -q && ruff check . && ruff format --check .
```
Also confirm the `proto-freshness` gate: a second run of the same `docker run … ./scripts/buf-gen.sh` produces no further change (`git status --porcelain packages/proto/gen` lists the same files and `git diff --stat packages/proto/gen` is unchanged). The pinned image matches CI's buf 1.72.0 and the Go-plugin pins (`Dockerfile.codegen:88,101-103`).

---

### Step 3 — service: analysis read side (SymbolReadiness funnel, floor clause, structural marker)

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify (`_readiness_to_proto`)
- `services/xstockstrat-analysis/app/repositories/opportunities.py` — modify (`_PROVENANCE_STRUCTURAL_MARKERS`, floor clause)

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Confirmed via: `grep -n "def _readiness_to_proto\|def _symbol_readiness_from_json" servicer.py` → `:6471`, `:6492`. `_readiness_to_proto(trace)` maps only symbol/conviction/passing/total/conditions (`:6471-6489`); `_symbol_readiness_from_json` routes through it (`:6492-6498`, "so a FAST-served row is byte-identical to a freshly computed one") — **one funnel** for `EvaluateReadiness` SLOW (`:4048`), FAST (`:4009`) and `GetWatchlistReadiness` RESOLVED (`_symbol_readiness_from_json` calls at `:4009` FAST and `:4201` RESOLVED; helper at `:6492`).
- Confirmed via: `grep -n "_PROVENANCE_STRUCTURAL_MARKERS" app/repositories/opportunities.py` → `:27`: `["watchlist", "position", "denied", "fundamentals_unavailable"]`, bound as `$6::text[]` in the `LATERAL` source derivation (`:238-241`) and iterated by `servicer._primary_source` (`:6713-6721`) — a token missing from the list would surface as `Opportunity.source` and a source chip.
- Confirmed via: floor clause `opportunities.py:256-257`: `AND (o.conviction >= $2 OR o.provenance ? 'denied' OR o.provenance ? 'unavailable' OR o.provenance ? 'fundamentals_unavailable')` with the "exempt at every layer" comment block `:246-255` (fails.md vanish trap).
- Existing pattern: `fundamentals_unavailable` marker (feature 215) added to all three places; test pins `tests/test_opportunities_repo.py:549-558`.

**TDD**: red-green required

**Covers**: —

**Instructions**:
1. `_readiness_to_proto`: add `formula_unreadable=bool(trace.get("formula_unreadable", False)),` to the `SymbolReadiness(...)` constructor (`:6473-6489`). `_symbol_readiness_from_json` needs no change (funnel).
2. `opportunities.py`: append `"formula_unreadable"` to `_PROVENANCE_STRUCTURAL_MARKERS` (`:27`) and extend the comment at `:22-26` by ≤ 1 line (feature 289: the marker is never a source/facet). Add `OR o.provenance ? 'formula_unreadable'` to the floor clause (`:256-257`) and one comment line "feature 289: likewise the formula-unreadable row".
3. Do not change `_SORT_ORDER_BY`, the count query, or `replace_symbols` (the heal's action-binding semantics are used unchanged in Step 7).

**Verification**: run Step 4's test command (this step's behaviour is verified there), plus lint:
```bash
cd "$(git rev-parse --show-toplevel)"/services/xstockstrat-analysis && ruff check . && ruff format --check .
```

---

### Step 4 — test: analysis read side (seeded-row, floor, structural marker, funnel)

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_opportunities_repo.py` — modify (floor + structural-marker tests + @AC-21 `_row_to_opportunity` round-trip)
- `services/xstockstrat-analysis/tests/test_watchlist_readiness.py` — modify (RESOLVED funnel via `GetWatchlistReadiness`)
- `services/xstockstrat-analysis/tests/test_unreadable_formula.py` — modify (FAST `EvaluateReadiness` funnel case; this file already imports `make_servicer`, `_materialized_svc`, `_row`, `_definition`, `ctx_with` and `_BOB`)

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Confirmed via: `tests/test_opportunities_repo.py:549-558` — `test_read_floor_exempts_fundamentals_unavailable` (`assert "o.provenance ? 'fundamentals_unavailable'" in sql`) and `test_fundamentals_unavailable_is_a_structural_marker` (`assert … in _PROVENANCE_STRUCTURAL_MARKERS`; `_primary_source([...,"uw"]) == "uw"`) — the exact templates.
- Confirmed via: `tests/test_analysis_servicer.py:4359` `class TestEvaluateReadiness` (helper `_svc(bars_by_symbol)` at `:4360` first assigns `svc._strategies_repo = AsyncMock()` (`:4362`) and stubs `ComputeIndicator` inline as `AsyncMock(side_effect=lambda req, metadata=None: SimpleNamespace(result=[…]))` (`:4369-4374`); `_readiness_cache_repo` available at `:4651` `_FakeReadinessCache`); `tests/test_watchlist_readiness.py:87-161` drive `GetWatchlistReadiness` with `svc._kick_readiness_refresh = MagicMock()` and seeded cache rows; `tests/test_readiness.py` holds the `is_readiness_row_fresh` tests (imported `:17`, section `:25`); `tests/test_readiness_cache.py` covers the FAST/SLOW cache behaviour and `_cache_svc` (`:27`).
- Confirmed via: `tests/test_opportunities_repo.py:15` already imports `_row_to_opportunity`; `:592` `test_row_to_opportunity_skip_row_round_trip` is the round-trip template (the @AC-21 round-trip lands there, not in `test_analysis_servicer.py`). `TestEvaluateReadiness._svc` (`:4360`) uses `_strategy_row_single_gt()` with no formula component, sets `svc._indicators = MagicMock()` with only `ComputeIndicator` awaitable, and `_FakeReadinessCache.read_many` (`:4658`) always returns `{}`; a custom-formula strategy makes `EvaluateReadiness` call `_formula_fundamentals` (`servicer.py:3973`) → `await self._indicators.GetFormula(...)`, which is `await MagicMock()` → `TypeError`. The FAST case therefore builds its own custom-formula row, cache stub and `GetFormula` stub, and lives in `tests/test_unreadable_formula.py` (importing `_row`/`_definition` from there into `test_analysis_servicer.py` would be circular — `test_unreadable_formula.py:20-28` imports from `test_analysis_servicer`; copying them would duplicate fixtures, C-13) (Instruction 2(b)).
- C-13 verdict: all new literals (a seeded `readiness_json` with `"formula_unreadable": True`, a `provenance` list) have **one consumer per file**; they stay inline in each file. No new fixture home is created.

**TDD**: red-green required — author these tests first; against the pre-Step-3 tree they FAIL for the right reason: `_readiness_to_proto` drops the key (`formula_unreadable` is False on a seeded `True` row), the floor SQL lacks the clause, and `"formula_unreadable"` is absent from `_PROVENANCE_STRUCTURAL_MARKERS` (`_primary_source(["formula_unreadable"])` returns `"formula_unreadable"`). Qualification: the @AC-21 round-trip test's `formula_unreadable True` / `data_unavailable False` assertions are already green after Step 2 (the `_row_to_opportunity` carry); only its `source == ""` assertion is red before Step 3's structural-marker edit.

**Covers**: `AC-3, AC-17, AC-20, AC-21` (read-side halves; the compute-side halves are in Step 8a)

**Instructions**:
1. `test_opportunities_repo.py`: add `test_read_floor_exempts_formula_unreadable` (`"o.provenance ? 'formula_unreadable'" in sql`, @AC-17 floor survival with `min_conviction=0.9`) and `test_formula_unreadable_is_a_structural_marker` (`"formula_unreadable" in _PROVENANCE_STRUCTURAL_MARKERS`; `_primary_source(["formula_unreadable","uw"]) == "uw"`; `["watchlist","formula_unreadable"]` → `""`, so no source, no facet / `available_sources` chip — @AC-17); and `test_row_to_opportunity_formula_unreadable_round_trip` beside `test_row_to_opportunity_skip_row_round_trip` (`:592`), same row shape with `provenance ["watchlist","formula_unreadable"]`: `opp.formula_unreadable is True`, `opp.data_unavailable is False`, `opp.fundamentals_unavailable is False`, `opp.source == ""` (@AC-21 round-trip).
2. `test_unreadable_formula.py` (not `test_analysis_servicer.py`): (a) the @AC-21 round-trip is NOT added here: put it in `test_opportunities_repo.py` beside `test_row_to_opportunity_skip_row_round_trip` (`:592`, which already imports `_row_to_opportunity`) — see Instruction 1; (b) a FAST `EvaluateReadiness` case (import `_empty_readiness` from `app.services.evaluator` and `_definition_fingerprint` from `app.handlers.servicer` (`:7209`); neither is imported in this file today). `TestEvaluateReadiness._svc` uses `_strategy_row_single_gt()` (no formula component) and `_FakeReadinessCache.read_many` (`:4658`) always returns `{}`, so a "`ExecuteFormula` never awaited" assertion would be vacuous with them. Instead build the service with `make_servicer()` and a **custom-formula** strategy (`_row(_definition())`, owner `bob`, `svc._strategies_repo = MagicMock(get_by_owner_and_id=AsyncMock(return_value=row_of_strategy))` (`make_servicer()` leaves `_strategies_repo = None` (`servicer.py:547`), so assigning an attribute on it raises `AttributeError`; `_write_svc` (`test_unreadable_formula.py:195`) assigns a fresh mock first), `ctx_with(_BOB)`), set `svc._marketdata = MagicMock()` (the `GetDataCoverage` probe is best-effort, `servicer.py:4055-4070`), `svc._indicators = MagicMock()` with `svc._indicators.GetFormula = AsyncMock(return_value=SimpleNamespace(fundamental_inputs=[]))` (the custom-formula component makes `EvaluateReadiness` call `_formula_fundamentals` at `servicer.py:3973`; a bare `MagicMock` attribute would raise `TypeError` on `await`) and `svc._indicators.ComputeIndicator = AsyncMock(side_effect=lambda req, **_kw: _sma_resp(req))` (the form already used in this file at `test_unreadable_formula.py:265`; behaviourally equivalent to `TestEvaluateReadiness._svc`'s inline `lambda req, metadata=None: SimpleNamespace(result=[…])` at `test_analysis_servicer.py:4369-4374`), `svc._indicators.ExecuteFormula = AsyncMock()` and `svc._readiness_cache_repo = MagicMock(read_many=AsyncMock(return_value={"MYSZ": row}))`, where `row` carries `readiness_json = {**_empty_readiness("MYSZ"), "formula_unreadable": True}`, `def_fingerprint == _definition_fingerprint(row_of_strategy["definition_json"])`, a future `valid_until`, `bar_epoch >= 0` and a `computed_at` (see the freshness predicate `is_readiness_row_fresh`, `app/services/readiness.py:16-28`, and the FAST branch `servicer.py:~3999-4010`) → `EvaluateReadiness` FAST returns `formula_unreadable True`, `total_conditions 0`, and `ExecuteFormula.assert_not_awaited()` (@AC-20 second-call half).
3. `test_watchlist_readiness.py`: seeded cache row with `bar_epoch >= 0` and the marker → the `MYSZ` row is `READINESS_STATE_RESOLVED` with `readiness.formula_unreadable True`, not UNKNOWN/PENDING; a sibling `AAPL` row also RESOLVED (@AC-3 read-side half).
4. Reuse `tests/conftest.py` helpers (`ctx_with`, `aio_rpc_error`, `RecordingStub`) rather than redefining them.

**Verification**:
```bash
cd "$(git rev-parse --show-toplevel)"/services/xstockstrat-analysis && uv run pytest tests/test_opportunities_repo.py tests/test_unreadable_formula.py tests/test_watchlist_readiness.py -q && uv run pytest --cov=app --cov-fail-under=40 && ruff check . && ruff format --check .
```
Confirm no second inline copy of the seeded-marker row: `grep -rn "formula_unreadable" tests/ | grep -c "readiness_json"` is one declaration per file.

---

### Step 5 — service: evaluator private sink and `UNREADABLE_FORMULA_CODES`

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/services/evaluator.py` — modify

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Confirmed via: `grep -n "def _execute_formula" evaluator.py` → `:256`. Today: `try: return await self._indicators.ExecuteFormula(request, metadata=self._meta)`; `except grpc.aio.AioRpcError as e:` — if `self._raise_unreadable and e.code() in (NOT_FOUND, PERMISSION_DENIED)` raise `FormulaExecutionError(comp.formula_id, "not readable by owner", e.code().name) from e` (`:262-269`, "Never e.details()"); `if e.code() != NOT_FOUND: raise` (`:270-271`); NOT_FOUND → add to `self.unreadable_formulas` and `log.warning("formula %s not readable by owner", …)` once, `return None` (`:272-275`). `unreadable_formulas: set[str]` initialised at `:244`; nothing outside the evaluator reads it.
- Call sites: `_compute_component` `:491` → `self._execute_formula(comp, …)` at `:518`, `if resp is None: return {"value": [None] * n}` `:526-527`; `_fundamentals_formula_series` `:552` → `:590`, `if resp is None: return {"value": [None] * n}` `:598-599`.
- `_assemble_component_series` `:686-695` (signature ends `formula_fundamentals_data: list | None = None,`); calls `_fundamentals_formula_series(...)` at `:739`, `_compute_component(comp, closes)` at `:745` and the benchmark `_compute_component(comp, bench_closes)` at `:752`. `_assemble_sector_resolved` (`:472`, used only by `evaluate_with_series` `:354`) and `servicer.py:4541-4567` (`GetIndicatorSeries`) call these without a sink — must stay byte-identical.
- `evaluate_conditions_traced` `:383-470`: no-bars early return `:413-416`; `_validate_definition(definition)` `:417`; serial loop `:425-441` and concurrent `_assemble` `:445-459` (`asyncio.gather` without `return_exceptions`); `parsed_rule = json.loads(rule_src) if rule_src else None` `:466`.
- `referenced_refs(rule)` `:958-964` (collapses dotted `<ref>.<series>` to the base); `_empty_readiness(symbol)` `:1134-1142`; `_validate_definition` rejects a term whose base is not a component `ref_name` (`:890-895`), so the bare `t in U` arm of the design is dead — use `referenced_refs` only.

**TDD**: red-green required

**Covers**: —

**Instructions**:
1. Add a module constant `UNREADABLE_FORMULA_CODES = (grpc.StatusCode.NOT_FOUND, grpc.StatusCode.PERMISSION_DENIED)` near `FormulaExecutionError` (`:102`), with a ≤ 2-line comment ("a refusal of a formula the caller cannot read; imported by the servicer's fundamentals classification"). Replace the inline tuple at `:262-265` with it. The servicer already imports from this module (`servicer.py:66-76`), so no cycle.
2. `_execute_formula(self, comp, request, unreadable_sink=None)`: keep the `raise_unreadable` branch first and byte-identical. Then `if unreadable_sink is not None and e.code() in UNREADABLE_FORMULA_CODES:` → `unreadable_sink.add(comp.ref_name)` **outside** the `unreadable_formulas` dedupe; the dedupe block (`if comp.formula_id not in self.unreadable_formulas: add; log.warning("formula %s not readable by owner", comp.formula_id)`) runs once; `return None`. The existing `!= NOT_FOUND` re-raise and NOT_FOUND skip arms (`:270-275`) stay as they are for the no-sink call (`GetIndicatorSeries`, `evaluate`, live loop).
3. Thread `unreadable_sink=None` (keyword-only, after the existing positional-with-default params, e.g. `…, formula_fundamentals_data=None, *, unreadable_sink=None`) through `_assemble_component_series` (`:686`), `_compute_component` (`:491`; pass to `_execute_formula` at `:518`) and `_fundamentals_formula_series` (`:552`; pass at `:590`). In `_assemble_component_series` forward it at all three sites: `:739`, `:745` and the benchmark `:752`. No constructor flag, no `for_owner` change, no `ValueError` guard (user decision).
4. `evaluate_conditions_traced`: after the no-bars return and `_validate_definition` create a local `unreadable: set[str] = set()` (per call — never instance state; one evaluator is shared across concurrently gathered candidates, `servicer.py:5572-5574`, `:5863`) and pass `unreadable_sink=unreadable` at **both** the serial (`:429`) and concurrent (`:447`) `_assemble_component_series` calls. After `parsed_rule` (`:466`): `if unreadable and referenced_refs(parsed_rule) & unreadable: return {**_empty_readiness(symbol), "formula_unreadable": True}`. Referenced-only: an unreferenced refused component stays skipped with one log line and no marker. The no-bars return stays first (data-unavailable outranks unreadable). A real `FormulaExecutionError` / `RpcError` from any component still propagates (concurrent `gather` propagates the first error; `async with self._component_sem` releases the permit).
5. Do not change `compute_readiness_row`'s signature (feature-215 parity — no `failures` argument); the marker flows through the returned trace.

**Verification**: Step 6's command plus lint:
```bash
cd "$(git rev-parse --show-toplevel)"/services/xstockstrat-analysis && ruff check . && ruff format --check .
```
**Step 5/6 boundary:** once `evaluate_conditions_traced` returns the 0/0 marker trace, the existing `tests/test_unreadable_formula.py:293-307` (`test_list_opportunities_unreadable_formula_is_not_unavailable`, pins `(passing, total) == (1, 2)`) goes red before Step 7 (`_compute_opportunities` stores the marker trace as `readiness_json`, so the row is `(0, 0)`). Step 6 Instruction 8 carries its interim re-pin; Step 5 and Step 6 must be green together (author Step 6, including that re-pin, first, per the red-before-green pairing).

---

### Step 6 — test: evaluator sink and `compute_readiness_row`

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_unreadable_formula.py` — modify (new evaluator section and `_traced_evaluator`/`_definition_two_formulas` helpers beside `_evaluator`/`_execute`; interim re-pin of `:293-307`)
- `services/xstockstrat-analysis/tests/test_readiness.py` — modify (`compute_readiness_row` cases next to `test_compute_readiness_row_exception_stamps_minus_one_sentinel`)

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Confirmed via: `tests/test_unreadable_formula.py:135-190` — `_ADMIN_REFUSAL`, `_evaluator(error, *, raise_unreadable)`, `_execute(ev)`, `test_backtest_permission_denied_maps_to_formula_error_with_code`, `test_live_path_permission_denied_still_reraises`, `test_live_path_not_found_still_skips`, `test_backtest_unavailable_still_reraises`; `_definition(z_ref="z")` `:38-66` builds `sma` + `z` (formula `f-zscore`) with a two-leaf AND entry rule — `_definition(z_ref="sma")` makes `z` **unreferenced**; `_FIRING_BARS` is imported from `tests/test_analysis_servicer.py`; `aio_rpc_error` / `ctx_with` / `RecordingStub` from `tests/conftest.py:132-149`.
- Confirmed via: `tests/test_readiness.py:86-113` — `_fake_evaluator`, `_compute(fetch_bars, *, benchmark_epoch)`, the `-1` sentinel test; `tests/test_evaluator_traced.py` serial vs concurrent (`component_sem`) fixtures `_period_keyed_stub` (`:259`) and `_counting_stub` (`:273`), used by the tests at `:296-323` (`test_concurrent_component_series_byte_identical_to_serial` `:296`, `test_component_sem_bounds_concurrent_dispatch` `:310`, `test_component_sem_none_is_strictly_serial` `:323`).
- C-13 verdict: the refusal-error builder `_not_found()` (`test_unreadable_formula.py:34`; re-spec 2026-11-05, was `:36`) and `_ADMIN_REFUSAL` already live in this file with one consumer file; the new tests reuse them (no second inline copy).
- Existing pin that this step must re-pin: `tests/test_unreadable_formula.py:293-307` `test_list_opportunities_unreadable_formula_is_not_unavailable` asserts `(passing, total) == (1, 2)` for a NOT_FOUND-refused formula. Once Step 5 lands, `evaluate_conditions_traced` returns the 0/0 marker trace and `_compute_opportunities` (`servicer.py:5770-5861`) stores it as the row's `readiness_json` with no sibling `fetch_failed`, so the row is `(0, 0)` with `data_unavailable False` even before Step 7 writes the provenance token (`formula_unreadable` stays False on the proto until then). Instruction 8 re-pins it.
- Existing helpers the new evaluator tests must extend: `_evaluator(error, *, raise_unreadable)` (`:138-141`) builds `MagicMock()` with only `ExecuteFormula` awaitable, but `_definition()` carries an `sma` BUILTIN component, so `evaluate_conditions_traced` also awaits `ComputeIndicator`; `_sma_resp(req)` (`:82`) is the response builder (`SimpleNamespace(result=[…])` over `req.values`), already wired as `AsyncMock(side_effect=lambda req, **_kw: _sma_resp(req))` at `:265` and as `"ComputeIndicator": _sma_resp` in the `RecordingStub` at `:94`. `_definition()` has a single formula component `z`.

**TDD**: red-green required — RED on today's tree for the right reason. The public-API tests (`evaluate_conditions_traced`, `compute_readiness_row`) never pass the new kwarg, so there is no `TypeError` there: `PERMISSION_DENIED` fails because the `AioRpcError` is re-raised (the evaluator re-raises any non-NOT_FOUND refusal today), and `NOT_FOUND` fails on the missing `formula_unreadable` key (the component is skipped with no marker). Only the direct `_execute_formula(..., unreadable_sink=set())` tests (Instruction 5) fail with `TypeError` on the unknown keyword.

**Covers**: `AC-1, AC-2, AC-5, AC-10, AC-13, AC-15, AC-16`

**Instructions**: (each in serial mode `component_sem=None` and concurrent mode `component_sem=asyncio.Semaphore(2)`)
0. **Helpers first** (`test_unreadable_formula.py`): the existing `_evaluator()` is not usable for traced evaluation (see Codebase Evidence). Add a traced helper `_traced_evaluator(execute_side_effect, *, component_sem)` that builds `indicators = MagicMock()` with `ComputeIndicator = AsyncMock(side_effect=lambda req, **_kw: _sma_resp(req))` and `ExecuteFormula = AsyncMock(side_effect=execute_side_effect)`, and returns `StrategyEvaluator(indicators, (("x-user-id", "bob"),), component_sem=component_sem)`. For Instruction 3 add `_definition_two_formulas()` with `z` (`f-zscore`) and `z2` (`f-timeout`) components, both referenced by the entry rule (the `ExecuteFormula` side effect dispatches on `req.formula_id`: `f-zscore` raises the refusal, `f-timeout` returns the timeout `SimpleNamespace`). In Instruction 7 give the `RecordingStub` `"ComputeIndicator": _sma_resp`.
1. `evaluate_conditions_traced` with `ExecuteFormula` → `PERMISSION_DENIED` ("admins cannot execute another user's formula") on a **referenced** formula returns `{symbol, conviction 0.0, passing 0, total 0, conditions [], formula_unreadable True}` (@AC-1); same with `NOT_FOUND` plus **exactly one** `caplog` record `"formula f-zscore not readable by owner"` (@AC-15).
2. `_definition(z_ref="sma")` (unreferenced refused component): evaluated normally, no `formula_unreadable` key, one log line (@AC-16).
3. Mixed (uses `_definition_two_formulas()`): one component refused + another responds `success=false` error `"Formula execution timed out after 5000ms"` → `FormulaExecutionError` propagates (@AC-10/@AC-13 evaluator half; build the response via `SimpleNamespace(success=False, error=…)`).
4. Benchmark `source_symbol` component whose formula is refused (benchmark bars supplied) → marker (covers the `:752` call site).
5. Direct `_execute_formula` tests (`evaluate_conditions_traced` always creates a sink, so the no-sink and sink-present contracts are asserted on `_execute_formula` itself). First extend the existing `_execute(ev)` helper (`tests/test_unreadable_formula.py:144-145`, which builds `SimpleNamespace(formula_id="f-zscore")` with no `ref_name`) to build `SimpleNamespace(formula_id="f-zscore", ref_name="z")` and to take an optional `sink` argument forwarded as `unreadable_sink=sink`; without `ref_name` the Step 5 `unreadable_sink.add(comp.ref_name)` would raise `AttributeError`. Then assert on `_execute_formula(..., unreadable_sink=set())`: `PERMISSION_DENIED` and `NOT_FOUND` both return `None` and the sink holds `{"z"}`; with `raise_unreadable=True` and a sink present `FormulaExecutionError` is still raised first and the sink stays empty (@AC-5); with no sink the existing `test_live_path_*` tests are unchanged and stay green.
6. Two candidates sharing a refused formula on one shared evaluator, awaited concurrently via `asyncio.gather`: **both** results marked, **one** log record (sink outside the log-dedupe; supports @AC-21).
7. `test_readiness.py`: `compute_readiness_row` with a refusing evaluator returns `readiness_json["formula_unreadable"] is True`, `passing/total 0`, and `bar_epoch >= 0` (never `-1`) (@AC-2); the bars-fetch-failure case still stamps `-1`. Do **not** reuse `_fake_evaluator` (`SimpleNamespace(evaluate_conditions_traced=AsyncMock(return_value={}))`) or the current `_compute` (no evaluator parameter, `definition={}`): the assertion would be tautological. Build a real `StrategyEvaluator` over a stub whose `ExecuteFormula` raises `aio_rpc_error(grpc.StatusCode.PERMISSION_DENIED, ...)`, a one-formula-component definition (e.g. `_definition()` from `tests/test_unreadable_formula.py` or an equivalent minimal one whose entry rule references the formula component; the stub also needs `"ComputeIndicator": _sma_resp`, as `_definition()` has an `sma` BUILTIN component), and a `fetch_bars` returning non-empty bar objects exposing `.close` and `.time.seconds` (empty bars would hit the no-bars early return before the sink matters). Extend `_compute` with `evaluator=` and `definition=` keyword parameters (defaults keep the existing `-1`-sentinel callers unchanged).
8. **Interim re-pin of `test_unreadable_formula.py:293-307`** (`test_list_opportunities_unreadable_formula_is_not_unavailable`): change `(opp.passing_conditions, opp.total_conditions) == (1, 2)` to `(0, 0)` and keep `opp.data_unavailable is False`. Step 8a Instruction 1 later extends it with `formula_unreadable True` once Step 7 writes the provenance token.

**Verification** (whole-file runs include the re-pinned `:293-307` test):
```bash
cd "$(git rev-parse --show-toplevel)"/services/xstockstrat-analysis && uv run pytest tests/test_unreadable_formula.py tests/test_readiness.py tests/test_evaluator_traced.py -q && uv run pytest --cov=app --cov-fail-under=40 && ruff check . && ruff format --check .
```

---

### Step 7 — service: servicer producer wiring (rows, heal, fundamentals classification, per-owner cache)

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify
- `services/xstockstrat-analysis/app/services/evaluator.py` — modify (constraint comment at `:675` only)

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `_row_for` in `_compute_opportunities`: `grep -n "async def _row_for" servicer.py` → `:5699`; local flags `readiness/exit_fires/fund_skip/fund_unknown` `:5703-5706`; trace call `:5770-5779`; `except grpc.RpcError` `:5780-5790` (`fetch_failed.add(sym)` `:5789`); `else:` branch (held exit-rule check `exit_fires` `:5792-5794`); `action = _resolve_action_tag(c, exit_fires)` `:5803`, sell-with-no-position drop `:5804-5810`, `if fund_skip:` `:5811-5813`; `sym_unavailable` `:5827-5829`; `zeroed` `:5832`; composite `:5839-5848` (readiness term skipped when `total_conditions == 0`, `:5841`); return dict `:5850-5861` (`"conviction": 0.0 if zeroed else …`, `"signal_axis": 0.0 if zeroed else c["signal_axis"]`). `_add_provenance(c, origin)` is defined at `:5416`. `c["is_held"]` is the held discriminator; `_resolve_action_tag` `:6688-6710` (held + exit fires → REDUCE; signal direction × held via `_action_for`; watchlist/held fallback ADD (held) / ENTER).
- Heal: `_retry_unavailable_symbols` `:4934`; selector `"unavailable" in (r.get("provenance") or [])` `:4948-4952`; per-row loop `:5035`; `rule = "exit" if "position" in provenance else "entry"` `:5040`; trace call `:5119-5128`; `except grpc.RpcError` `:5129-5134` (catches PERMISSION_DENIED as an outage today); `else: still_unavailable = False` `:5135-5140`; healed row `:5163-5177` (no `action` key → `replace_symbols` keeps stored action via `COALESCE($11::int, action)`, `opportunities.py:144,165`); `_axis_for` `:4981`, `_composite_for` `:4987-5007`; skip-row precedent `"action": int(analysis_pb2.OPPORTUNITY_ACTION_TAG_UNSPECIFIED)` `:5100`; watchlist-entry readiness restage `:5181-5224` with success-only gate `staged.get("bar_epoch", -1) >= 0` `:5223`; fresh `valid_until` filled post-loop `:5226-5236`. Heal task failure catch `:4927-4928` ("opportunity surgical retry failed").
- Fundamentals classification: `_formula_fundamentals` `:1901-1934`, `except grpc.RpcError:` `:1926-1929` writes `failures[("formula", fid)] = Availability.UNKNOWN`; docstring `:1904-1909` ("An unreachable ``GetFormula`` caches ``[]``…"); `_declared_formula_warmup` `:2512-2547`, `except grpc.RpcError:` `:2543-2546`; `_prefetch_formula_warmups` `:2549-2596` (feeds the explicit-start backtest branch; `_formula_fundamentals` feeds the no-start branch `:984`); `_rpc_code` `:6617-6618` (`e.code() if isinstance(e, grpc.RpcError) and hasattr(e, "code") else None`). The live twin `evaluator.declared_formula_fundamentals` `:652-684` (`except grpc.RpcError:` `:675-681`) is **unchanged**.
- Per-owner cache: `recompute_unscored_pairs` `:3064-3089` — `fund_cache: dict = {}` `:3074`, **`formula_cache: dict = {}` `:3075`**, `failures: dict = {}` `:3076`, one shared set passed per `(user_id, strategy_id)` pair at `:3079-3086`; each pair's `GetFormula` runs under its own `owner_metadata` (`_recompute_headline` default `meta=owner_metadata(user_id)`, `:2891`).
- Import: `servicer.py:66-76` imports from `app.services.evaluator` (add `UNREADABLE_FORMULA_CODES` there).
- Callers of `_formula_fundamentals`: `:787` (write-time validation), `:984` (backtest, no explicit start), `:2790` (grade-exclusion), `:3973` (EvaluateReadiness), `:4277` (kick), `:4509` (GetIndicatorSeries), `:5067` (heal), `:5734` (opportunities), `:6061` (materializer).

**TDD**: red-green required (tests: Steps 8a for Instructions 1-2, 8b for Instructions 3-6)

**Covers**: —

**Instructions**:
1. `_row_for` (precedence `fund_skip` > `unreadable` > sibling-`fetch_failed` `unavailable`; an `unavailable` from `fund_unknown` cannot coexist with `unreadable` because the evaluator is not called when `fund_skip or fund_unknown`, `servicer.py:~5768`):
   - Add `unreadable = False` beside `fund_unknown = False` (`:5706`). In the `else:` branch after the trace (`:5791`) set `unreadable = bool(readiness.get("formula_unreadable"))`.
   - After the sell-with-no-position drop (`:5804-5810`) and beside `:5811-5813`: `if unreadable: _add_provenance(c, "formula_unreadable")`; for a **non-held** row also `action = analysis_pb2.OPPORTUNITY_ACTION_TAG_UNSPECIFIED`. A **held** row keeps `_resolve_action_tag`'s result (REDUCE on a sell signal / existing monitored-holding fallback ADD; a firing exit cannot occur on a 0/0 trace).
   - `sym_unavailable` (`:5827-5829`) gains `and not unreadable` so a sibling candidate's symbol-wide `fetch_failed` cannot flip the row (@AC-21). `zeroed = sym_unavailable or fund_skip or (unreadable and not c["is_held"])`: non-held → conviction and signal axis 0.0, composite NULL (the `if not zeroed` guard at `:5840` already NULLs it); held → `readiness["conviction"]` is 0.0 (0/0), `signal_axis` kept, composite from the signal alone (`:5841` skips the readiness term when `total_conditions == 0`; `:5843-5847` adds the signal term).
2. Heal arm (`_retry_unavailable_symbols`): the refusal no longer reaches the `except grpc.RpcError` at `:5129` (the evaluator swallows it into the marker). In the `else:` branch (`:5135`) read `unreadable = bool(readiness.get("formula_unreadable"))` (initialise `unreadable = False` beside `still_unavailable = True`, `:5041`). In the healed-row construction (`:5163-5177`): when `unreadable`, `provenance = [p for p in provenance if p not in ("unavailable", "formula_unreadable")] + ["formula_unreadable"]`, `readiness_json = readiness` (the 0/0 marker), conviction 0.0, `_healed True` (fresh `valid_until` is filled post-loop `:5233-5236`). **Held** (`"position" in provenance`, i.e. `rule == "exit"`): **omit** the `action` key (the stored action is kept via `COALESCE`), `signal_axis = _axis_for(sym)`, `composite_score = _composite_for(sym, readiness)` (signal-only). **Non-held**: `"action": int(analysis_pb2.OPPORTUNITY_ACTION_TAG_UNSPECIFIED)` bound (overwrites, as the skip row does at `:5100`), `signal_axis 0.0`, `composite_score None`. The watchlist-entry restage (`:5181-5224`) needs no change: `compute_readiness_row` now returns the marker with `bar_epoch >= 0`, which passes the success-only gate at `:5223`. The selector stays keyed on `"unavailable"` so a healed unreadable row is never re-selected.
3. `_formula_fundamentals` (global, user-confirmed C-16 CHANGE of FR-5 with the gate ON): `except grpc.RpcError as e: metrics = []; if failures is not None and _rpc_code(e) not in UNREADABLE_FORMULA_CODES: failures[("formula", fid)] = Availability.UNKNOWN`; `metrics = []` either way (so `cache[fid] = []`). An `RpcError` without `.code()` stays UNKNOWN. Rewrite the docstring sentence at `:1907-1909` (≤ 2 lines): a refusal (NOT_FOUND/PERMISSION_DENIED) is "not a fundamentals formula" and records no failure; an outage records UNKNOWN.
4. `_declared_formula_warmup` in lock-step: `except grpc.RpcError as e: cache[formula_id] = 0; if fund_map is not None and failures is not None and _rpc_code(e) not in UNREADABLE_FORMULA_CODES: failures[...] = Availability.UNKNOWN`, so the explicit-start and no-start backtest branches cannot split.
5. Leave `evaluator.declared_formula_fundamentals` (`evaluator.py:652-684`) behaviour unchanged (FR-5/`@AC-11`; live deny-entry ignores UNKNOWN) but add a ≤ 2-line constraint comment at `evaluator.py:675` ("do not merge with servicer._formula_fundamentals: a refusal must still record UNKNOWN here — live behaviour pinned by test") so a later DRY merge cannot silently change live behaviour.
6. `recompute_unscored_pairs`: replace the shared `formula_cache: dict = {}` (`:3075`) with `formula_caches: dict[str, dict] = {}` and pass `formula_cache=formula_caches.setdefault(user_id, {})` at `:3083` (one `GetFormula` result cache per owner; the PIT `fund_cache` stays shared — user-independent). `failures` stays shared and records only real outages (a refusal no longer writes it). Do **not** "never cache refusals" (rejected alternative).
7. Add `UNREADABLE_FORMULA_CODES` to the evaluator import block (`:66-76`). No new outbound gRPC call is added (header propagation unchanged — all calls reuse the existing `propagation_meta` / `owner_metadata`).

**Verification**: Step 8a's and Step 8b's commands plus lint:
```bash
cd "$(git rev-parse --show-toplevel)"/services/xstockstrat-analysis && ruff check . && ruff format --check . && grep -n "UNREADABLE_FORMULA_CODES" app/handlers/servicer.py app/services/evaluator.py
```
(Header propagation: no new outbound gRPC call is added, so no propagation grep is required.)

---

### Step 8a — test: servicer paths (opportunities, readiness, heal, materializer, scheduled passes)

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_unreadable_formula.py` — modify (rewrite `:293-307`; parameterize `_definition`/`_row`; new servicer cases; new live-loop warning test; `EvaluateReadiness` SLOW/FAST/timeout cases and the heal cases (calling `_retry_unavailable_symbols` directly; import `_unavailable_served_row` and `_FakeReadinessCache` from `tests.test_analysis_servicer`); the `_kick_readiness_refresh` + `GetWatchlistReadiness` end-to-end case (@AC-3); the materializer (@AC-8, @AC-19) and daily-refresh (@AC-19) cases). Import-only sources (these files are **not modified** by this step): `_materializer_svc`, `_upserted_rows`, `_due_schedule` from `tests.test_readiness_materializer`; `_mock_pool` from `tests.test_opportunity_refresh`; `_cache_svc` from `tests.test_readiness_cache`; `_real_bars` from `tests.test_readiness_opportunities_source_symbol`. `test_watchlist_readiness.py` is modified only by Step 4
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify (Instruction 0 only: `_FakeOppRepo.read` / `available_sources` marker exemption)

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Confirmed via: `tests/test_unreadable_formula.py:293-307` `test_list_opportunities_unreadable_formula_is_not_unavailable` — uses `_materialized_svc(watchlists=[_wl(bindings=[("AAPL","s-1")])], strategies={"s-1": _row(definition)}, bars={"AAPL": _FIRING_BARS})`, `svc._indicators.ExecuteFormula = AsyncMock(side_effect=_not_found())`, `GetFormula` likewise, `by_symbol, _ = await _list_opps(svc)`; asserts `opp.data_unavailable is False` and `(opp.passing_conditions, opp.total_conditions) == (1, 2)` (pins the **old** skip behaviour — rewritten as the test-level face of the AC-14 retirement: now `(0, 0)`, `formula_unreadable True`, `data_unavailable False`).
- Fixtures in that file are hardcoded and single-consumer (`grep -rn test_unreadable_formula tests/` → only itself): `_definition(z_ref="z")` (`:38-66`) hardcodes `strategy_id="s-1"`, formula `f-zscore`; `_row(definition=None)` (`:69-79`) hardcodes `strategy_id "s-1"`, owner `bob`; `_WARNING = "formula f-zscore not readable by owner"` (`:31`). The Gherkin names (`f-9`, `MYSZ`, `s-2`, `s-3`, an "admin") are **narrative, not literals**: tests keep `f-zscore`, `bob` and assert on `_WARNING`; the symbol is free (`_wl(bindings=[("MYSZ","s-1")])`).
- Helpers confirmed: `tests/test_analysis_servicer.py:4774` `_materialized_svc(signals, held, watchlists, strategies, bars, source_weights, live_strategies)`, `:4884` `_list_opps` (drains the cold-read recompute kick); `:5806` `TestOpportunitySurgicalRecovery` (calls `_retry_unavailable_symbols` directly; `_unavailable_served_row` `:4665` and `_FakeReadinessCache` `:4651` are module-level and importable; `_META` is a per-class attribute, so the new heal cases declare their own `_META`); `:7908` `TestUnguardedReadinessParity_feature215` (re-run only, see Verification); `tests/test_readiness_materializer.py:48` `_materializer_svc`, `:93` `_upserted_rows`, `:27` `_due_schedule`; `tests/test_opportunity_refresh.py:18` `_mock_pool` (the daily-refresh tick itself is the servicer method `svc._opportunity_refresh_tick(schedule)`, called at `:42`/`:61`/`:82` with a `DurableSchedule(_mock_pool(), …)`); `tests/test_readiness_cache.py:27` `_cache_svc(bars_by_symbol, strategy_row=None)`; `tests/test_opportunities_fundamentals_guard.py:374` `test_ac13_heal_rewrites_to_skip_row_without_readiness_staging` / `:393` `test_heal_of_technical_row_carries_no_action_key` are the heal-row templates.
- Live-loop pins: `tests/test_unreadable_formula.py:89` `test_ac5_live_loop_skips_unreadable_component_as_owner` is a **NOT_FOUND skip** (not a PERMISSION_DENIED isolation) and `:172` `test_live_path_permission_denied_still_reraises` is evaluator-level; neither asserts the `live_loop: (…) error: … — continuing` warning (`app/engine/live_loop.py:~479`, `log.warning("live_loop: (%s,%s) error: %s — continuing", …)`).
- Fake-repo gap (Step 7 cannot fix a fake): `_FakeOppRepo.read` (`tests/test_analysis_servicer.py:4520`, floor at `~:4544-4550`) exempts only `denied`/`unavailable` from the conviction floor, and `_FakeOppRepo.available_sources` (`~:4586`) skips only `watchlist`/`position`/`denied` origins, so Instruction 1's `min_conviction=0.9` and `"formula_unreadable" not in available_sources` assertions would fail for the wrong reason without the fake extension in Instruction 0. The real-SQL floor / source behaviour stays covered by Step 4's `test_opportunities_repo.py` tests.
- Placement (circular-import constraint, extended to the materializer / daily-refresh / kick cases): `test_readiness_materializer.py:23-24` `_live_row` wraps `_simple_strategy_row()`, `test_watchlist_readiness.py:24` uses `_simple_strategy_row()` and `test_opportunity_refresh.py` has no strategy fixture, so none can hold a custom-formula case; importing `_row`/`_definition` into `test_readiness_materializer.py` is circular (`test_unreadable_formula.py:29` imports `tests.test_owner_header_guard`, whose `:31` imports `_due_schedule`, `_live_row`, `_materializer_svc` from `tests.test_readiness_materializer`). Those cases therefore also live in `test_unreadable_formula.py`, importing the helpers above; this is cycle-free because neither `test_readiness_materializer.py`, `test_opportunity_refresh.py` nor `test_readiness_cache.py` imports `test_unreadable_formula.py` (`grep -rn test_unreadable_formula tests/` → only itself).
- Placement (circular-import constraint): the `EvaluateReadiness` SLOW/FAST/timeout cases and the heal cases need the custom-formula `_row`, `_definition`, `_not_found`, `_sma_resp` that live in `test_unreadable_formula.py`; importing them into `test_analysis_servicer.py` is circular (`test_unreadable_formula.py:20-28` imports from it) and copying them breaks C-13 (Step 4 resolved the FAST case the same way). So those cases live in `test_unreadable_formula.py` and import `_unavailable_served_row` / `_FakeReadinessCache` from `tests.test_analysis_servicer`; `test_analysis_servicer.py` only gets the Instruction 0 fake extension.
- `_FakeOppRepo.replace_symbols` (`tests/test_analysis_servicer.py:4591-4611`) never stores `action`, so Instruction 5's `action` assertions cannot be read from stored rows; they read the rows handed to `replace_symbols` through a spy (precedent `_spy_heal`, `tests/test_opportunities_fundamentals_guard.py:366-370`).
- C-13 verdict: servicer-level seeds reuse the existing `tests/test_analysis_servicer.py` helpers (already a second-consumer home imported by `test_unreadable_formula.py`); the per-test `GetFormula` error stubs are inline one-offs; the `_definition`/`_row` parameterization stays in this single-consumer file.

**TDD**: red-green required — RED on today's tree for the right reason: today a refused formula yields `(1, 2)` / `data_unavailable True` / an aborting `EvaluateReadiness` / a heal that re-stamps `unavailable`. Characterization cases (AC-4, AC-5, AC-10, AC-11, AC-12, AC-13) are green on arrival and are regression guards, not red-first. The red cases are AC-1/2/3/8/9/15-21 and AC-26 (it first asserts the marked state before the marker clears, so it is red today; AC-16's unreferenced-component `s-2` assertions are green but sit in the same test as the red `s-1` marker assertions).

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-5, AC-8, AC-9, AC-10, AC-11, AC-12, AC-13, AC-15, AC-16, AC-17, AC-18, AC-19, AC-20, AC-21, AC-26`

**Instructions**:
0. **Fixtures first.** (i) `tests/test_analysis_servicer.py`: extend `_FakeOppRepo`: in `read` add `and "formula_unreadable" not in _prov` to the floor condition (match the real variable names at `~:4544-4550`); in `available_sources` add `"formula_unreadable"` to the skipped-origin tuple. Existing tests are unaffected. (ii) `test_unreadable_formula.py`: add `import logging` (Instruction 2's live-loop test uses `caplog.at_level(logging.WARNING, …)`; the file has no `logging` import or `caplog` use today), `timedelta` to the `datetime` import (heal rows are aged > 300 s), and `_unavailable_served_row` / `_FakeReadinessCache` to the existing `from tests.test_analysis_servicer import (…)` block (Instruction 3's `EvaluateReadiness` and Instruction 5's heal cases live in this file); also `import asyncio` (Instruction 3's kick drain), `from app.engine.durable_schedule import DurableSchedule` (Instruction 4's daily-refresh tick uses a real `DurableSchedule` over `_mock_pool`), and `from tests.test_readiness_opportunities_source_symbol import _real_bars` (that module imports only `tests.test_analysis_servicer`, so it closes no cycle with this file; signature `_real_bars(symbol, closes, start=…)` returns real `Bar` messages with `.close` / `.time.seconds`). The `_materializer_svc` and `_cache_svc` cases use `_real_bars(sym, [120.0, 130.0, 150.0])`; the `_materialized_svc` cases (Instruction 1 and Instruction 4's daily refresh) use `_FIRING_BARS` (a plain list of floats, already imported). Parameterize `_definition(z_ref="z", formula_id="f-zscore", strategy_id="s-1")` (component `z`'s `formula_id`, `strategy_id` and `display_name`) and have `_row(definition=None)` take `strategy_id`/`display_name` from the definition (default behaviour unchanged for every existing caller). Build the `s-2`/`s-3` rows as `_materialized_svc(strategies={"s-1": _row(_definition()), "s-2": _row(_definition(z_ref="sma", strategy_id="s-2")), "s-3": _row(_definition(strategy_id="s-3"))}, …)` with matching `_wl(bindings=[(SYM, "s-1"), (SYM, "s-2"), (SYM, "s-3")])` bindings; assertions on the log use `_WARNING`, never an `f-9` literal.
1. **Opportunities** (`test_unreadable_formula.py`, @AC-1/15/16/17/18/21/26): rewrite `:293-307` (the Step 6 interim `(0, 0)` assertion becomes the full rewrite: `formula_unreadable True`, `data_unavailable False`, `(0, 0)`); add PERMISSION_DENIED and NOT_FOUND cases: `s-1` row has `formula_unreadable True`, `data_unavailable False`, present at `min_conviction=0.9`, `source != "formula_unreadable"`, `"formula_unreadable" not in available_sources`, no `"indicator RPC failed for <SYM>"` record, exactly one `_WARNING` record; `s-2` (unreferenced refused component, `z_ref="sma"`) evaluated normally with no marker. Non-held: action UNSPECIFIED, conviction 0, `signal_axis 0`, composite unset. Held (`held=[…]` in `_materialized_svc`, exit rule referencing the formula) Examples: sell signal → REDUCE, axis > 0, composite set; no signal → ADD, axis 0, composite unset; conviction 0 and 0/0 in both. Sibling `s-3` sharing the formula + a sibling `UNAVAILABLE` for another component on the same symbol → `s-1` and `s-3` stay marked regardless of completion order, one log line. After the formula becomes readable, the next recompute clears the marker (@AC-26).
2. **Outage / timeout characterization**: `UNAVAILABLE` → `data_unavailable True`, no marker (@AC-4); `success=false` "Formula execution timed out after 5000ms" → recompute fails with warning `"opportunity recompute failed"` and stored rows retained (@AC-10); `EvaluateReadiness` on the timeout raises `FormulaExecutionError` and is not converted to 0/0 (@AC-13); `RunBacktest` PERMISSION_DENIED stays FORMULA_ERROR "not readable by owner" (@AC-5; already pinned by `test_backtest_permission_denied_maps_to_formula_error_with_code` — re-assert, do not duplicate). **Live loop (@AC-11) — add a NEW test** (none exists): build `indicators = RecordingStub({"ExecuteFormula": aio_rpc_error(grpc.StatusCode.PERMISSION_DENIED, _ADMIN_REFUSAL), "GetFormula": _not_found(), "ComputeIndicator": _sma_resp})`, `loop = _live_loop(_ingest(), indicators, [_row()])` (`_live_loop`/`_ingest` from `tests/test_owner_header_guard`), run `await loop._run_cycle()` under `caplog.at_level(logging.WARNING, logger="app.engine.live_loop")`; assert the cycle completes without raising and, after filtering `caplog.records` on `r.name == "app.engine.live_loop"` (and `r.levelno == logging.WARNING`), exactly one record remains, whose message matches `live_loop: \(s-1,\w+\) error: .* — continuing`, and that no formula-unreadable sink/marker is involved (the live path is unchanged). Keep `:89`/`:172` as they are.
3. **Readiness paths** (@AC-2/3/20; all in `test_unreadable_formula.py`, which owns the custom-formula `_row`/`_definition`/`_not_found`/`_sma_resp`; the `EvaluateReadiness` timeout case of Instruction 2 lives there too): the SLOW/FAST servicer setups reuse Step 4 Instruction 2(b)'s, including `svc._strategies_repo = MagicMock(get_by_owner_and_id=AsyncMock(return_value=row_of_strategy))` (never assign onto the `None` that `make_servicer()` leaves at `servicer.py:547`). `EvaluateReadiness` SLOW → OK, 0/0, marker, no `AioRpcError`; second call within `stale_after_seconds` → FAST, marker, `ExecuteFormula` not re-awaited (use the custom-formula strategy row and a seeded fresh cache row from Step 4 Instruction 2(b), or a stateful cache stub that records the first call's upsert; the SLOW case needs the same `svc._indicators.GetFormula = AsyncMock(return_value=SimpleNamespace(fundamental_inputs=[]))` and an awaitable `ComputeIndicator` stub, since a bare `MagicMock` `GetFormula` raises `TypeError` on `await` at `servicer.py:3973`; when the refusal is the thing under test, `GetFormula` instead raises `_not_found()` as in the opportunities cases); `_kick_readiness_refresh` + `GetWatchlistReadiness` end to end (@AC-3) is **also in `test_unreadable_formula.py`** (not `test_watchlist_readiness.py`, whose `_wl_svc` builds only `_simple_strategy_row()` services): build the service with `_cache_svc(bars_by_symbol, strategy_row=_row(_definition()))` imported from `tests.test_readiness_cache` (its signature is `_cache_svc(bars_by_symbol, strategy_row=None)`; it wires `_strategies_repo.get_by_owner_and_id`, marketdata, a `ComputeIndicator` stub and an `AsyncMock` `_readiness_cache_repo`), then set `svc._indicators.GetFormula = AsyncMock(side_effect=_not_found())` and `ExecuteFormula` to the refusal → the symbol RESOLVED 0/0 marker and `AAPL` RESOLVED. Setup as `_wl_svc` does (`test_watchlist_readiness.py:34-41`): `svc._portfolio = MagicMock()` with `GetWatchlist = AsyncMock(return_value=SimpleNamespace(watchlist=SimpleNamespace(bindings=[SimpleNamespace(symbol="MYSZ", strategy_id="s-1"), SimpleNamespace(symbol="AAPL", strategy_id="s-1")])))` (`_cache_svc` does not set `_portfolio`, and `GetWatchlistReadiness` aborts UNAVAILABLE when it is `None`, `servicer.py:4103`). Both symbols are bound to `s-1` although the Gherkin binds `AAPL` to `s-2`: `_cache_svc(strategy_row=…)` returns the same row for any strategy id, and both symbols are RESOLVED either way, so the assertions hold. Call `GetWatchlistReadiness` once with `ctx_with(_BOB)` (both already imported in `test_unreadable_formula.py` at `:19` and `:29`; matches the owner `bob` used elsewhere in the step); its `read_many` returns `{}`, so the rows are PENDING and the call kicks a fire-and-forget refresh. Drain the kick with `for _ in range(1000): if not svc._readiness_kicking: break; await asyncio.sleep(0)` (`_readiness_kicking`, `servicer.py:629`, is the in-flight guard set, cleared in the kick's `finally`). Feed `svc._readiness_cache_repo.upsert_many.await_args.args[0]` back as `read_many` (`AsyncMock(return_value={r["symbol"]: r for r in rows})`, as `test_readiness_cache.py:82-83` does). Call `GetWatchlistReadiness` again and assert the `MYSZ` row (`.state == READINESS_STATE_RESOLVED`, `.readiness.formula_unreadable True`, 0/0) and the `AAPL` row RESOLVED, and assert `"readiness refresh kick failed" not in caplog.text` only after the drain (before the drain the assertion is vacuous). `TestUnguardedReadinessParity_feature215` stays green (no `failures` argument added).
4. **Scheduled passes** (@AC-8, @AC-19; **all in `test_unreadable_formula.py`**, importing `_materializer_svc`, `_upserted_rows`, `_due_schedule` from `tests.test_readiness_materializer` and `_mock_pool` from `tests.test_opportunity_refresh`; `test_readiness_materializer.py` must NOT import from `test_unreadable_formula.py` — that would close the cycle through `test_owner_header_guard`). The live row is built inline as `{**_row(_definition()), "user_id": "bob", "strategy_id": "s-1"}` (not via `_live_row`, which wraps `_simple_strategy_row()`); after `_materializer_svc(...)` returns, set `svc._indicators.GetFormula` / `ExecuteFormula` to the refusal stubs. A one-line test comment on the materializer case: `_materializer_svc` sets `svc._cfg.get_bool = MagicMock(return_value=enabled)`, so the fundamentals gate is effectively ON there (harmless: the definition has no fundamentals operand, and `_formula_fundamentals` is called without `failures` at `servicer.py:~6061`). The daily-refresh case drives `svc._opportunity_refresh_tick(DurableSchedule(_mock_pool(), "opportunity", "wallclock", anchor_hour=lambda: 0))` as the due-now precedents `test_opportunity_refresh.py:50-66` and `:69-89` do. Build this case with `_materialized_svc(watchlists=[_wl(bindings=[("MYSZ","s-1")])], strategies={"s-1": _row(_definition())}, bars={"MYSZ": _FIRING_BARS})`, not `_materializer_svc`: `make_servicer()` and `_materializer_svc` leave `_opportunities_repo = None`, and `_opportunity_refresh_tick` wraps `distinct_user_ids()` in `except Exception` (`servicer.py:~5973-5979`), so the resulting `AttributeError` would be swallowed and take the retry-soon path (no row computed). `_materialized_svc` installs `_FakeOppRepo`, whose `distinct_user_ids` returns `list(self.rows.keys())` (empty before any compute), so seed `svc._opportunities_repo.distinct_user_ids = AsyncMock(return_value=["bob"])`. Then set `svc._indicators.GetFormula` and `ExecuteFormula` to the refusal stubs and run the tick. `_FakeOppRepo.rows` is a dict keyed by user id whose values are lists of row dicts, so find the row in `svc._opportunities_repo.rows["bob"]` with `symbol == "MYSZ"` and `strategy_id == "s-1"`: its `provenance` contains `"formula_unreadable"` and not `"unavailable"`. Assert the pass completed with `pool.execute.await_count == 1` (`DurableSchedule.advance` ran; the retry path would also advance once, so also assert the `MYSZ` row exists, which only the completed pass produces), and that the stubbed `ExecuteFormula` saw owner-only metadata (`svc._indicators.ExecuteFormula.await_args.kwargs["metadata"] == [("x-user-id", "bob")]`, no admin bit). A real `DurableSchedule` over `_mock_pool()` is used because that count is observable only through the pool; `_due_schedule()` would instead expose `sched.advance.await_count`, so use it only if the pool count is not asserted. Materializer (`_materializer_svc`) with `owner_metadata` and a stub that answers NOT_FOUND when no admin bit is in metadata, and also with PERMISSION_DENIED: persisted verdict for the symbol/`s-1` is 0/0 + marker + `bar_epoch >= 0`, served fresh (not `-1`), the pass continues and writes `AAPL`. Bind both `MYSZ` and `AAPL` to `s-1` in the `bindings_by_owner` builder (`{"bob": [("MYSZ", "s-1"), ("AAPL", "s-1")]}`) even though the Gherkin binds `AAPL` to `s-2`: the materializer resolves a binding only against the single live row `s-1`, `AAPL` is RESOLVED either way, so the assertions hold; the daily-refresh tick (`_opportunity_refresh_tick`) yields the marked row as specified above.
5. **Heal** (@AC-9, @AC-12; in `test_unreadable_formula.py`, `TestOpportunitySurgicalRecovery` style, calling `svc._retry_unavailable_symbols` directly): data-unavailable row > 300 s, watchlist entry, `ExecuteFormula` now PERMISSION_DENIED → row carries the marker, no `"unavailable"` token, provenance and `readiness_json` agree in both the replace row and the staged readiness-cache row, held rows omit `action`, non-held rows bind `action 0`; a second `_retry_unavailable_symbols`/selector pass does not select it; recovery case (indicators healthy) restores an evaluated row (existing behaviour). Assert the `action` key (omitted for held, `0` for non-held) by spying `svc._opportunities_repo.replace_symbols = AsyncMock(side_effect=real)` and reading `spy.await_args.args[1]`, as `_spy_heal` does (`tests/test_opportunities_fundamentals_guard.py:366-370`; it also sets `svc._readiness_cache_repo = _FakeReadinessCache()`, which the staged-row assertion reads via `.upserted`). The fake `replace_symbols` does not store `action`. Declare the 2-line spy inline rather than importing across test files (C-13).
6. Header propagation: no new outbound call — assert (existing parity tests) that metadata is unchanged.

**Verification**:
```bash
cd "$(git rev-parse --show-toplevel)"/services/xstockstrat-analysis && uv run pytest tests/test_unreadable_formula.py tests/test_readiness_materializer.py tests/test_opportunity_refresh.py tests/test_watchlist_readiness.py tests/test_analysis_servicer.py -q && uv run pytest --cov=app --cov-fail-under=40 && ruff check . && ruff format --check .
```
`tests/test_readiness_materializer.py`, `tests/test_opportunity_refresh.py` and `tests/test_watchlist_readiness.py` are listed as a harmless regression re-run of the import-source modules (this step does not modify them). `tests/test_analysis_servicer.py` is in the command for the Instruction 0 fake extension and the `TestUnguardedReadinessParity_feature215` re-run (no new cases are added there).
Confirm C-13: `grep -rn "def _not_found\|def _rpc_error" tests/` — no new duplicate declaration beyond the existing per-file one-consumer helpers.

---

### Step 8b — test: servicer paths (gate-ON fundamentals classification, per-owner formula cache)

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_backtest_fundamentals_guard.py` — modify (@AC-22)
- `services/xstockstrat-analysis/tests/test_grade_fundamentals_exclusion.py` — modify (@AC-23; `:387-396` per-owner cache; u1/u2 poisoning test)
- `services/xstockstrat-analysis/tests/test_opportunities_fundamentals_guard.py` — modify (@AC-24, @AC-25)
- `services/xstockstrat-analysis/tests/test_fundamentals_pit_pager.py` — modify (NOT_FOUND parity at `:295-311`)

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Confirmed via: `tests/test_backtest_fundamentals_guard.py:127` `_svc(gate=…)`, `:167` `_req`, `:66` `_blend`, `:235` gate-on outage pattern `_RERUN`, `:292`/`:312` formula-map outage with gate on/off; `tests/test_fundamentals_pit_pager.py:162` `_gated_servicer`, `:82` `_formula_definition`, `:295-311` sibling tests (servicer `:295-302`, evaluator `:304-311`; both use UNAVAILABLE today); `tests/test_grade_fundamentals_exclusion.py:87` `_blend_svc(cells)`, `:55` `_cell`, `:98` `_CountingSem`, `:387-396` boot-pass test (`GetFormula` count assertion `:396`; `:395` is the `GetHistoricalFundamentals` count); `tests/test_opportunities_fundamentals_guard.py:215-409` skip-row / heal cases (`:374`, `:393`).
- Today with the gate ON a refused `GetFormula` records `failures[("formula", fid)] = UNKNOWN` (`servicer.py:1926-1929`), which short-circuits to UNKNOWN before `ExecuteFormula` — hence RED here.
- C-13 verdict: gate-ON fixtures reuse each file's existing one-consumer helpers; the per-test `GetFormula` error stubs are inline one-offs.

**TDD**: red-green required — RED on today's tree for the right reason: with the gate ON the refusal short-circuits to UNKNOWN (backtest "fundamentals fetch failed — rerun", ScoreStrategy abort, `unavailable` opportunity) before `ExecuteFormula` is reached. Characterization case AC-25 (`GetFormula` UNAVAILABLE stays data-unavailable) is green on arrival and is a regression guard, not red-first. The red cases are AC-22/23/24.

**Covers**: `AC-22, AC-23, AC-24, AC-25`

**Instructions**:
1. **Fundamentals gate ON** (@AC-22/23/24/25): `RunBacktest` with `analysis.backtest.fundamentals.enabled` true and `GetFormula`+`ExecuteFormula` NOT_FOUND, with and without an explicit start → `NO_TRADE_REASON_FORMULA_ERROR`, warning `"backtest symbol AAPL not evaluated: NOT_FOUND"`, no `"rerun"` warning, status INSUFFICIENT_DATA (the explicit-start branch exercises `_prefetch_formula_warmups` → `_declared_formula_warmup`); `ScoreStrategy` succeeds with trailer `x-score-excluded-symbols` `"[]"`, while `GetFormula` UNAVAILABLE still aborts UNAVAILABLE "fundamentals availability unknown — grade unchanged"; opportunities compute and heal with the gate ON yield the marker and are not re-selected (`test_opportunities_fundamentals_guard.py`); `GetFormula` UNAVAILABLE with the gate ON stays `data_unavailable` with its action kept. `test_fundamentals_pit_pager.py`: add NOT_FOUND parameters — servicer sibling asserts `fmap == {}` and `failures == {}`; evaluator sibling (`declared_formula_fundamentals`) asserts `failures == {("formula","divf"): UNKNOWN}` (pins the live twin as unchanged). Gate OFF: unchanged outcomes (existing `:267`, `:312` tests).
2. **Per-owner formula cache**: update `test_boot_pass_shares_cache_and_takes_background_sem` (the `GetFormula` count assertion at `:396`) to expect one `GetFormula` per distinct owner (2); add a test: u1's `GetFormula` refused, u2's readable fundamentals formula → u2 still excludes the ETF 0-trade cell (SCHD) regardless of pair order.
3. No new outbound call is added by Step 7's classification change — the existing metadata assertions in these files stay unchanged.

**Verification**:
```bash
cd "$(git rev-parse --show-toplevel)"/services/xstockstrat-analysis && uv run pytest tests/test_backtest_fundamentals_guard.py tests/test_grade_fundamentals_exclusion.py tests/test_opportunities_fundamentals_guard.py tests/test_fundamentals_pit_pager.py -q && uv run pytest --cov=app --cov-fail-under=40 && ruff check . && ruff format --check .
```

---

### Step 9 — service: agent `list_opportunities` consumer surface (C-14)

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify (tool docstring)
- `docs/runbooks/mcp-tools.md` — modify (`list_opportunities` section)

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity; tool-count statements kept in sync across all six inventory surfaces; no secret values in tool output

**Codebase Evidence**:
- Confirmed via: `grep -n "async def list_opportunities" services/xstockstrat-agent/app/tools.py` → `:1684`; docstring field list `:1697-1704` (`Each opportunity carries …` through `… the traced conditions`) includes `data_unavailable (true = a terminal data-unavailable row, distinct from an evaluated 0/N), fundamentals_unavailable (…), fundamentals_gap (…)`.
- Confirmed via: `client.py:839-902` `_opportunity_to_dict` is an explicit whitelist; Step 2 added `"formula_unreadable": o.formula_unreadable` after `"fundamentals_gap"` (`:863`); `tools.py` docstring `min_conviction` line (`:1692`) says muted rows are exempt (already incomplete — fix only the field list this feature touches).
- Confirmed via: `docs/runbooks/mcp-tools.md:1054-1090` — the `list_opportunities` section; return paragraph `:1068-1073`, feature-215 bullet group `:1075-1084` (its last bullet, "A held position on such a symbol still receives its exit-rule row.", is `:1084`; the omit-not-fabricate paragraph follows at `:1086`).
- Confirmed via: `services/xstockstrat-agent/CLAUDE.md:70` tool-table row `list_opportunities | List the caller's ranked Decide-queue opportunities…` (no sentinel wording; **no tool is added or removed, so the tool-count statements need no change**).
- No readiness tool exists in the agent (`grep -n "EvaluateReadiness" services/xstockstrat-agent/app/` → none; per `recon.md`).
- `plugins/strat-lab/skills/backtest/SKILL.md` has no `list_opportunities` dependency (grep → none), so the strat-lab rule is handled in Step 13 only for the backtest-behaviour change.

**TDD**: red-green required — the red run is Step 10 Instruction 3 (docstring mentions `formula_unreadable`), written and run **before** this step's `tools.py` edit; the projection key itself was already carried by Step 2.

**Covers**: —

**Instructions**:
1. `tools.py:1697-1704`: add to the field list `formula_unreadable (true = the row's strategy references a formula this account cannot read — missing, private to another user, or its author record needs repair; a NON-ACTIONABLE row for a non-held symbol: action UNSPECIFIED, conviction 0, no composite_score; a held row keeps its action; never also data_unavailable)`. Keep the docstring within the existing style (no secret values; omit-not-fabricate unchanged). The projection key itself was added in Step 2.
2. `docs/runbooks/mcp-tools.md`: in the `list_opportunities` section add a feature-289 bullet group after the feature-215 bullet group's last bullet (`:1084`, so the 215 group is not split): the `formula_unreadable` semantics above, exempt from the `min_conviction` floor, never an `Opportunity.source` / `available_sources` facet, mutually exclusive with `data_unavailable` and `fundamentals_unavailable`.
3. `services/xstockstrat-agent/CLAUDE.md:70` (the tool-table row) has no sentinel wording and no tool is added or removed, so no edit is made there (`grep -n "data_unavailable" services/xstockstrat-agent/CLAUDE.md` → none confirms it; if a hit appears, extend it and add the file to this step's Files).

**Verification**: Step 10's command plus lint:
```bash
cd "$(git rev-parse --show-toplevel)"/services/xstockstrat-agent && ruff check . && ruff format --check .
```

---

### Step 10 — test: agent projection

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_opportunity_projection.py` — modify
- `services/xstockstrat-agent/tests/test_client.py` — modify (`list_opportunities` mapping, near `:1352-1385`)
- `services/xstockstrat-agent/tests/test_tools.py` — modify (list_opportunities docstring mentions formula_unreadable)

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity

**Codebase Evidence**:
- Confirmed via: `tests/test_tools.py:1103-1111` `test_docs_surfaces_state_rule_string_or_object` — the docstring-assertion pattern Instruction 3 follows (`server._tool_manager.get_tool(name).description`, whitespace-normalized); `tests/test_list_correlation_parity.py:122` pins a different `list_opportunities` docstring concern (join keys) and is not modified.
- Confirmed via: `tests/test_opportunity_projection.py:50-54` `test_opportunity_projection_covers_every_proto_field`, `:57-64` `test_guard_has_teeth`, `:94-109` existing value tests; `tests/test_client.py:1352-1385` `list_opportunities` mapping tests.
- Confirmed via: `tests/test_tools.py` holds tool-surface/docstring assertions (file listed in `ls tests/`).
- C-13 verdict: `_full_opportunity` already lives once in `test_opportunity_projection.py`; the `test_client.py` case builds its own minimal message (single consumer, inline).

**TDD**: Instructions 1-2 are **regression guards, green on arrival** — Step 2 already carried `"formula_unreadable"` through `_opportunity_to_dict`, so the projection and `list_opportunities` mapping assertions pass the moment they are written (AC-6 projection coverage is therefore guard-covered, not red-first). Only Instruction 3 (the `list_opportunities` docstring mentions `formula_unreadable`) is red-then-green, and only if it is authored **before** Step 9's docstring edit: Step 9 is numbered before Step 10, so `/sdd-execute` must write and run Instruction 3's assertion first (RED: docstring lacks the field), then apply Step 9's `tools.py` edit (GREEN). If Step 9 has already landed, Instruction 3 is a guard like the others and no red run is claimed.

**Covers**: `AC-6`

**Instructions**:
1. `test_opportunity_projection.py`: add `test_formula_unreadable_projected_true_and_false` — `_opportunity_to_dict` of an `Opportunity(formula_unreadable=True)` yields `d["formula_unreadable"] is True`, a default message yields `False`, and `data_unavailable`/`fundamentals_unavailable` are independent (@AC-6).
2. `test_client.py`: extend the `list_opportunities` mapping case so a returned page with the marked `MYSZ`/`s-1` row surfaces `formula_unreadable True` in `["opportunities"][0]` (@AC-6).
3. Add a tools-level assertion (`tests/test_tools.py`, following its existing docstring/inventory checks) that the `list_opportunities` docstring mentions `formula_unreadable`.
4. Keep `_full_opportunity` as the single fixture (extended in Step 2).

**Verification**:
```bash
cd "$(git rev-parse --show-toplevel)"/services/xstockstrat-agent && uv run pytest tests/test_opportunity_projection.py tests/test_client.py tests/test_tools.py -q && uv run pytest --cov=app --cov-fail-under=40 && ruff check . && ruff format --check .
```

---

### Step 11 — service: UI consumer surface (C-14, C-17)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/readinessRollup.ts` — modify
- `services/xstockstrat-ui/src/lib/readinessCue.ts` — modify
- `services/xstockstrat-ui/src/lib/readinessRollup.test.ts` — modify (mechanical, keeps `tsc` and the existing assertions green at this step's boundary: `formulaUnreadable: false` on the 5 `readinessState` calls (`:6-9`, `:13`) AND on every `rollupReadiness` row literal (`:27-30`, `:40`); the `toEqual` at `:35` gains `unreadable: 0`; the sum invariants at `:50`, `:57` gain `+ c.unreadable`)
- `services/xstockstrat-ui/src/lib/opportunityShared.test.ts` — modify (mechanical: add `'unreadable'` to the `states` list at `:11`)
- `services/xstockstrat-ui/src/app/insights/opportunities/page.tsx` — modify
- `services/xstockstrat-ui/src/components/mobile/sections.ts` — modify
- `services/xstockstrat-ui/src/components/mobile/SectionRenderer.tsx` — modify
- `services/xstockstrat-ui/src/components/insights/WatchlistReadiness.tsx` — modify
- `services/xstockstrat-ui/src/components/insights/SignalReadiness.tsx` — modify
- `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx` — modify

**Reviewers**: xstockstrat-ui owner — trading UI correctness, analytics display accuracy, Connect-RPC call safety, no secret values rendered in UI, no direct DB access

**Codebase Evidence**:
- Confirmed via: `src/lib/readinessRollup.ts` — `export type ReadinessState = 'firing' | 'watching' | 'quiet' | 'nodata'` (`:13`); `readinessState(r)` (`:20-28`, `totalConditions === 0` → `'nodata'`); `ReadinessCounts` (`:30-35`) + `rollupReadiness(readiness, requestedSymbols)` (`:42-62`; sum invariant documented in the doc comment at `:37-41`). `rollupReadiness` does **not** call `readinessState`: it branches inline (`if (!r || r.totalConditions === 0)` → `nodata` at `:51`, then `isFiring` / `passingConditions > 0` / quiet), so a 0/0 marked row stays `nodata` unless an explicit `formulaUnreadable` branch is added before `:51`. `src/lib/readinessCue.ts:15-20` `READINESS_CUE: Record<ReadinessState, EnumRender>` (imports `Lightning, Eye, Moon, Question, Stack` from `@phosphor-icons/react`, `:6`); `SemanticRole = 'buy'|'sell'|'paper'|'secondary'|'info'` (`src/lib/opportunityShared.tsx:20`) — no warning role. Re-spec 2026-11-06 (post-merge of `origin/main-dev`): feature 282 added `UNSERVABLE_REASON` to `opportunityShared.tsx` and a `UNSERVABLE_REASON` describe block to `opportunityShared.test.ts`; neither touches the readiness cue contract, so the state list stays the one at `opportunityShared.test.ts:11`.
- Call sites to update (`tsc` flags each once `formulaUnreadable` is required): `src/app/insights/opportunities/page.tsx:60` (`readinessVariant(passing: number, total: number)` takes bare numbers and calls `readinessState({ passingConditions, totalConditions })` at `:61`; its one call site is `:559`, `readinessVariant(o.passingConditions, o.totalConditions)`), `src/components/mobile/SectionRenderer.tsx:158`, `src/components/insights/SignalReadiness.tsx:108`, `src/components/insights/WatchlistReadiness.tsx:51` (`barVariant`), `:73` (`stateLabel`), `:235` (`rollupReadiness`), `:296` (`cueState`), plus `readinessRollup.test.ts`: the 5 `readinessState` calls (`:6-9`, `:13`) and the `rollupReadiness` row literals (`:27-30` via the shared `readiness` array, `:40`) — `tsconfig` includes `**/*.ts`, so a required `formulaUnreadable` on the rollup row type breaks `tsc` on every un-updated literal; adding `unreadable` to `ReadinessCounts` also breaks the `toEqual({ ready: 1, watching: 1, quiet: 1, nodata: 1 })` at `:35` and the sum invariants at `:50`, `:57` no longer cover all buckets (they must add `c.unreadable`).
- `opportunities/page.tsx`: mobile mapping `signals: g.opps.map((o) => ({ … dataUnavailable: o.dataUnavailable (:196), fundamentalsUnavailable (:197), … }))` starts `:191` (the **single** `SignalItem` construction site: `grep -rn "SignalItem"` → only `sections.ts:13` and the renderer); row header badge priority `:502-513` (fundUnavailable → muted → action); "Readiness" cell chain `:541-570` (`o.dataUnavailable` → `role="status"` span testid `opportunity-unavailable-${o.symbol}` `:545-552`, `fundUnavailable` `—` `:553-554`, `hasReadiness` Progress `:555-568`); act buttons suppressed for `fundUnavailable` at `:632`.
- `sections.ts:13-35` `SignalItem` (optional flags `dataUnavailable?`, `fundamentalsUnavailable?`); `SectionRenderer.tsx:154-158` `SignalRow` (`rs = readinessState(...)` at `:158`), `:171` badge chain (`s.fundamentalsUnavailable ?` → `s.muted ?` → action), `:235-246` `s.dataUnavailable` cue testid `opportunity-unavailable-mobile-${s.symbol}`.
- `SignalReadiness.tsx`: `isHeld = pairRow?.provenance.includes('position')` `:47`; `pairRow?.fundamentalsUnavailable && <CardNotice>` `:73-79` (testid `readiness-fundamentals-unavailable`); branch chain `:80-92` (`!readiness || readiness.conditions.length === 0` at `:92`); `readiness = data?.readiness?.[0]` (the `EvaluateReadiness` result). Detail header: `trader/positions/[symbol]/page.tsx:1008-1014` badge chain (`opportunity.fundamentalsUnavailable ? EnumBadge testId="detail-fundamentals-unavailable" : EnumBadge OPPORTUNITY_ACTION[…]`).
- `WatchlistReadiness.tsx:296-318` verdict cell: `READINESS_CUE[cueState]` with `testId={`readiness-cue-${cueState}`}`; UNKNOWN branch `readiness-unknown-${binding.symbol}` `:320-328`.
- BFF `src/lib/insightsBff.ts:63,68,71` is a plain `forward(...)` — the new camelCase field flows untouched (`recon.md`; no change).
- `CardNotice` (`src/components/shared/CardNotice.tsx:3-23`, variants `muted|error`), `EnumBadge`/`EnumRender`, `QueryStateMessages` are the C-17 primitives.
- `LockSimple` exists in `@phosphor-icons/react` (`^2.1.7` in `package.json`, resolved to `@phosphor-icons/react@2.1.10` at `pnpm-lock.yaml:1915`). Checked on 2026-11-05 against the published `2.1.10` tarball: `dist/index.d.ts` exports `LockSimple` and `dist/ssr/LockSimple.d.ts` exists. `grep -rn LockSimple src` → none, so this is its first use. Re-spec 2026-11-06: not re-checkable locally yet — no `node_modules` is installed in this checkout or the main worktree; `pnpm-lock.yaml:1915` still pins `@phosphor-icons/react@2.1.10`. Re-checked 2026-11-06 after the `origin/main-dev` merge: still no `node_modules`, `grep -rn LockSimple src` still empty, lockfile pin unchanged; the npm registry is reachable (`npm view @phosphor-icons/react@2.1.10` resolves), so the post-install grep below can run. Step action (mandatory, before the `readinessCue.ts` edit): after `pnpm install --frozen-lockfile`, re-confirm with `grep -n "LockSimple" services/xstockstrat-ui/node_modules/@phosphor-icons/react/dist/index.d.ts` (pnpm links it under the UI package, not the root — `.npmrc` public-hoists only `@bufbuild/*`); fall back to `Lock` if absent.

**TDD**: red-green required (paired with Step 12, which is authored first).

**Covers**: —

**Instructions**:
1. `readinessRollup.ts`: `ReadinessState` gains `'unreadable'`; `readinessState(r)` takes a **required** `formulaUnreadable: boolean` field and returns `'unreadable'` **before** the `totalConditions === 0` check (so a 0/0 marked row is never `nodata`); `ReadinessCounts` gains `unreadable`, and `rollupReadiness`'s row param type gains `formulaUnreadable: boolean`. Because `rollupReadiness` branches inline rather than calling `readinessState`, add an explicit `else if (r.formulaUnreadable) { counts.unreadable += 1; }` arm **after** the `!r` check and **before** the `r.totalConditions === 0` → `nodata` test at `:51` (split that condition: `if (!r) nodata; else if (r.formulaUnreadable) unreadable; else if (r.totalConditions === 0) nodata; …`), so a 0/0 marked row is counted `unreadable` while a requested symbol with no row stays `nodata`; the sum invariant `ready + watching + quiet + nodata + unreadable === requestedSymbols.length` holds (update the doc comment at `:37-41`). Making it required lets `tsc` flag every literal call; fix each (generated proto objects already carry `formulaUnreadable` after Step 2). In `readinessRollup.test.ts` (mechanical edits only; new unreadable cases belong to Step 12): add `formulaUnreadable: false` to the 5 `readinessState` calls (`:6-9`, `:13`) and to every `rollupReadiness` row literal (`:27-30`, `:40`); change `:35` to `toEqual({ ready: 1, watching: 1, quiet: 1, nodata: 1, unreadable: 0 })`; add `+ c.unreadable` to the sum invariants at `:50` and `:57`.
2. `readinessCue.ts`: `unreadable: { label: 'formula not readable', role: 'secondary', icon: LockSimple }` (fallback `Lock`; icon + text keeps it distinct from "quiet"/"no data", `@AC-4 @feature-155`). `readinessVariant`'s signature gains `formulaUnreadable: boolean` (`readinessVariant(passing, total, formulaUnreadable)`, forwarded into its `readinessState` call at `:61`) and its sole call site `:559` passes `o.formulaUnreadable`. `barVariant` / `stateLabel` / `readinessVariant` have declared return types, so the new case is a type error until handled: `barVariant`/`readinessVariant` → `'muted'`, `stateLabel` → `'formula not readable'`.
3. `opportunities/page.tsx`: derive `held = o.provenance.includes('position')` exactly as `SignalReadiness.tsx:47` does. Header badge priority: fundUnavailable → (`o.formulaUnreadable && !held`: `EnumBadge` of `READINESS_CUE.unreadable`) → muted → action; for a **held** unreadable row show the action badge **plus** the cue. Readiness cell: add a branch directly after the `o.dataUnavailable` branch (`:541-552`; the two markers are mutually exclusive, so order is immaterial): `o.formulaUnreadable ? <span role="status" data-testid={`opportunity-formula-unreadable-${o.symbol}`} aria-label={`Formula not readable for ${o.symbol}`}>` with the cue icon + text "formula not readable" (accessible name includes the symbol; C-17 unique name). Hide act buttons for a non-held unreadable row like `fundUnavailable` (`:632`). Mobile mapping: add `formulaUnreadable: o.formulaUnreadable` beside `dataUnavailable` (`:196`).
4. `sections.ts`: `SignalItem` gets a **required** `formulaUnreadable: boolean` (deliberate divergence from the optional sibling flags, so `tsc` catches the single construction site). `SectionRenderer.tsx`: pass `formulaUnreadable` into `readinessState` (`:158`); render `data-testid={`opportunity-formula-unreadable-mobile-${s.symbol}`}` cue in the readiness slot (`:235-246`, beside the `s.dataUnavailable` branch) before the `hasReadiness` meter; the action badge chain (`:171`) is unchanged so a held row keeps its badge.
5. `WatchlistReadiness.tsx`: RESOLVED 0/0 + marker → `readinessState(r)` is `'unreadable'` → `READINESS_CUE.unreadable` with label "formula not readable" (testid `readiness-cue-unreadable`, via the existing `readiness-cue-${cueState}` pattern `:317`, rendered by the `EnumBadge` at `:316`), and the `unreadable` count fragment in the rollup summary (`rollupReadiness` result). `blockingCondition` is `—` for 0 conditions already.
6. `SignalReadiness.tsx`: add a branch **before** `!readiness || readiness.conditions.length === 0` (`:92`): `readiness?.formulaUnreadable` → `<div data-testid="readiness-formula-unreadable"><CardNotice>` with the copy below `</CardNotice></div>`. Key it off the **`EvaluateReadiness` result**, not `pairRow`. Signal-detail header (`trader/positions/[symbol]/page.tsx:1008`): non-held unreadable → `EnumBadge render={READINESS_CUE.unreadable} testId="detail-formula-unreadable"`; held → action badge plus that cue.
7. Copy (neutral — covers missing formulas and legacy-author rows; cross-reference `docs/runbooks/legacy-formula-authors.md`; soft-deleted formulas still execute): *"A formula in this strategy isn't readable by your account (missing, private to another user, or its author record needs repair), so readiness can't be shown here."*
8. `CopilotRail` / `copilot.ts:38-52` need no change (UNSPECIFIED rows tally under `OPPORTUNITY_ACTION[UNSPECIFIED].label`, as muted / fund_skip rows already do). Use design-role tokens only (no hex/oklch literals), no new `ui/*` primitive (C-17).
9. CLAUDE.md edits are in Step 13.

**Verification**:
```bash
cd "$(git rev-parse --show-toplevel)" && pnpm install --frozen-lockfile && grep -n "LockSimple" services/xstockstrat-ui/node_modules/@phosphor-icons/react/dist/index.d.ts
cd "$(git rev-parse --show-toplevel)"/services/xstockstrat-ui && pnpm exec tsc --noEmit && pnpm run lint && pnpm run format:check && pnpm run test:unit
```
(Step 12 supplies the Playwright run.)

---

### Step 12 — test: UI fixtures, vitest, Playwright (C-12)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/readinessRollup.test.ts` — modify (new unreadable cases)
- `services/xstockstrat-ui/src/lib/opportunityShared.test.ts` — modify (`READINESS_CUE.unreadable` data-only assertions)
- `services/xstockstrat-ui/e2e/fixtures/opportunities.ts` — modify (MYSZ unreadable rows, exported separately and NOT added to `OPPORTUNITIES`; `READINESS_BUCKET_OVERRIDE` `MYSZ` entry + `formulaUnreadable?` type)
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify (catalog rows)
- `services/xstockstrat-ui/e2e/helpers/watchlistMock.ts` — modify (RESOLVED 0/0 with the marker)
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify (`MARKERS` and the floor emulation; `listOpportunities` `MYSZ` pool branch)
- `services/xstockstrat-ui/e2e/insights/opportunities.spec.ts` — modify (desktop, mobile and held cases via a per-test `page.route`)
- `services/xstockstrat-ui/e2e/insights/watchlist-readiness-list.spec.ts` — modify
- `services/xstockstrat-ui/e2e/trader/position-detail.spec.ts` — modify

**Reviewers**: xstockstrat-ui owner — trading UI correctness, analytics display accuracy, Connect-RPC call safety, no secret values rendered in UI

**Codebase Evidence**:
- C-12 inventory (cited `e2e/fixtures/INVENTORY.md`, lines `:40,41,43,44,74`; re-spec 2026-11-05: recon's `:71` is the `strat-notfound-readiness-01` row, and `mockWatchlists` is `:44`): "Opportunity queue — `OPPORTUNITIES`", "Fundamentals skip row (215) — `SCHD_FUNDAMENTALS_UNAVAILABLE_OPPORTUNITY`", "Symbol readiness — `symbolReadiness`", the `READY1/WATCH1/QUIET1/NODATA1` override row, "Watchlists (stateful mock) — `mockWatchlists`". **Reuse/extend**: `OPPORTUNITIES` (`fixtures/opportunities.ts:72`; the PLTR data-unavailable row `:163-176` is the template), `READINESS_BUCKET_OVERRIDE` (`:310-318`, `NODATA1` = 0/0), `symbolReadiness` (`:275`), `mockWatchlists` (`helpers/watchlistMock.ts`; `ReadinessStateOverrides = Record<string, 'pending' | 'unknown'>` `:52`; RESOLVED override spread `READINESS_BUCKET_OVERRIDE[b.symbol]` `:280` — re-spec 2026-11-06, shifted from `:39`/`:254` by feature 282's `unservable` 4th arg). New domain object (the unreadable row) gets a fixture + `INVENTORY.md` catalog row **in this step**; scenario one-offs stay inline.
- `e2e/mock-backend.ts`: `MARKERS = ['watchlist','position','denied','fundamentals_unavailable']` `:935`; floor emulation `:945-956` (`o.muted || o.dataUnavailable || fundamentalsUnavailable || o.conviction >= min`); facet filter `:985`; `evaluateReadiness` `:1008-1030` merges `READINESS_BUCKET_OVERRIDE`. `e2e/insights/opportunities.spec.ts:57` is the **only other** floor-exemption copy (feature 190 moved filtering server-side; there is no UI `useMemo` copy); it filters `OPPORTUNITIES`, which excludes the marked rows (served from a bespoke per-test `page.route`), so it needs no edit. Existing cue specs: `opportunities.spec.ts:380-399,425,586-588,651-669`, `watchlist-readiness-list.spec.ts:53-69`, `position-detail.spec.ts:827-833` (`detail-fundamentals-unavailable` pattern).
- Vitest: `src/lib/readinessRollup.test.ts` (`readinessState` `:6-13`, `rollupReadiness` `:34-55`), `src/lib/opportunityShared.test.ts:9-26` (cue data contract). Coverage threshold 40% scoped to `src/lib/**` (`CLAUDE.md` § Testing).

**TDD**: red-green required — Playwright and the new vitest cases are authored first and FAIL against the pre-Step-11 UI (no `formulaUnreadable` branch, `readinessState` ignores the flag, `READINESS_CUE.unreadable` undefined).

**Covers**: `AC-7, AC-27`

**Instructions**:
1. Vitest: `readinessState({passingConditions:0,totalConditions:0,formulaUnreadable:true})` → `'unreadable'` (not `'nodata'`), also with non-zero counts; false keeps the existing mapping; `rollupReadiness` counts an unreadable row in the `unreadable` bucket and `ready+watching+quiet+nodata+unreadable === requestedSymbols.length` for mixed input; `READINESS_CUE.unreadable` has a non-empty label, a valid role and a defined icon; the state list in the "exactly one entry per state" test includes `'unreadable'`.
2. Fixtures: in `fixtures/opportunities.ts` add `MYSZ_FORMULA_UNREADABLE_OPPORTUNITY` (non-held: action UNSPECIFIED, conviction 0, 0/0, `provenance ['watchlist','formula_unreadable']`, `formulaUnreadable: true`) and a held variant (`provenance […,'position','formula_unreadable']`, `action: OpportunityActionTag.REDUCE`, `formulaUnreadable: true`); `INVENTORY.md` rows for both.
   - **Neither is added to the `OPPORTUNITIES` array** (`fixtures/opportunities.ts:72`): that array drives the sort, count, facet, copilot-tally and mobile-overflow assertions in other specs. Follow the `SCHD_FUNDAMENTALS_UNAVAILABLE_OPPORTUNITY` precedent (exported separately, reachable only on demand). For the **queue surfaces** (`/insights/opportunities` desktop and mobile), serve the marked row from a per-test `page.route` in `opportunities.spec.ts` (the default mock-backend `listOpportunities` is not the place). For **`/trader/positions/MYSZ`**, add a `symbol === 'MYSZ'` pool branch in `mock-backend.ts` `listOpportunities` mirroring the SCHD branch (`:941-944`, `[... as unknown as Opp]`), serving the non-held variant only (the held variant is served by the per-test `page.route`; no assertion here exercises `evaluateReadiness` on the EXIT rule, so `exitReadiness` is untouched).
   - `mock-backend.ts`: add `'formula_unreadable'` to `MARKERS` (`:935`) and `(o as { formulaUnreadable?: boolean }).formulaUnreadable` to the floor emulation (`:945-956`) — the cast is required: `tsconfig.json:21` includes `**/*.ts` so `e2e/` is typechecked, and `Opp` (`typeof OPPORTUNITIES[number]`) has no `formulaUnreadable` (TS2339), exactly as for the existing `fundamentalsUnavailable` access at `:951`. If any test routes the marked row through `mockOpportunities`, require the same cast there.
   - **Readiness override is keyed by symbol** (`READINESS_BUCKET_OVERRIDE[s]` in `mock-backend.ts:1024` and `READINESS_BUCKET_OVERRIDE[b.symbol]` in `watchlistMock.ts:280`). The position-detail and watchlist assertions use `MYSZ`, so key the entry `MYSZ: { passingConditions: 0, totalConditions: 0, formulaUnreadable: true }` (not `UNREADABLE1`) — `MYSZ` appears in no other spec's readiness path (`grep -rn MYSZ e2e/` → no hit in this tree, so the key is collision-free). Extend the override's TS type to `{ passingConditions?: number; totalConditions?: number; formulaUnreadable?: boolean }` (`fixtures/opportunities.ts:310-313`). `watchlistMock.ts` then renders `MYSZ` as RESOLVED 0/0 with the marker (it already spreads the override). If a spec needs a second symbol on the watchlist panel, add `UNREADABLE1` as an additional entry rather than re-keying.
3. Playwright (`@AC-7` Scenario Outline, four surfaces; unique accessible names per C-17): `/insights/opportunities` → `opportunity-formula-unreadable-MYSZ` visible, `opportunity-unavailable-MYSZ` absent, no `0/0` progress; mobile project → `opportunity-formula-unreadable-mobile-MYSZ`; `/insights/watchlists` readiness panel → `readiness-cue-unreadable` with text "formula not readable" and not `readiness-unknown-*`; `/trader/positions/MYSZ?strategy=…` → `readiness-formula-unreadable` notice and `detail-formula-unreadable` header cue. `@AC-27`: held REDUCE row → the REDUCE action badge **and** the `formula not readable` cue are both visible, not the data-unavailable state. Row stays visible at the default `min_conviction` and a raised floor.
4. Keep imports from `e2e/fixtures` / `helpers/auth` (C-12): `grep -n "from '../fixtures'\|from './fixtures'\|helpers/auth"` on touched specs.

**Verification**:
```bash
cd "$(git rev-parse --show-toplevel)"/services/xstockstrat-ui && pnpm run test:coverage && pnpm exec tsc --noEmit && pnpm run lint && pnpm run format:check && pnpm exec playwright test e2e/insights/opportunities.spec.ts e2e/insights/watchlist-readiness-list.spec.ts e2e/trader/position-detail.spec.ts
```
(`vitest.config.ts` thresholds: lines/functions/statements 40 on `src/lib/**`. `./scripts/run-e2e.sh` is the hermetic Docker alternative when Chromium is unavailable. Also confirm `INVENTORY.md` lists the new fixture symbols: `grep -n "MYSZ_FORMULA_UNREADABLE\|MYSZ" services/xstockstrat-ui/e2e/fixtures/INVENTORY.md`.)

---

### Step 13 — docs: context files, runbook cross-references, strat-lab clause, operator note

**Status**: `pending`
**Service**: `docs/` and per-service `CLAUDE.md`
**Files**:
- `services/xstockstrat-analysis/CLAUDE.md` — modify
- `services/xstockstrat-ui/CLAUDE.md` — modify
- `plugins/strat-lab/skills/backtest/SKILL.md` — modify
- `plugins/strat-lab/skills/backtest/reference/output-handling.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Confirmed via: `services/xstockstrat-analysis/CLAUDE.md:49-52` — "**Unreadable formula.** An indicators `NOT_FOUND` … the other surfaces skip the component with a warning." (this contract is a signed-off C-16 CHANGE: non-backtest traced surfaces now mark the row; the NOT_FOUND log string is kept). `:224-225` — the `ListOpportunities` bullet (`…Feature 185: …data-unavailable sentinel…`, floor sentence `OR provenance ? 'fundamentals_unavailable'`) and the `Fundamentals skip row` sub-bullet. `:432` "Backtest refusal", `:443` "Opportunity skip row", `:457-465` "Evidence exclusion (H)" incl. "Gate-off re-includes refused cells (Open Risk 3)" — gate-ON behaviour for a refused `GetFormula` changes here.
- Confirmed via: `services/xstockstrat-ui/CLAUDE.md:119-138` — the Decide-screens bullets incl. `:132` "**Fundamentals skip row (feature 215).**" sub-bullets; `:143` "Enum render maps"; `:157` "Mobile companion"; Key File Paths rows `:399`, `:401`.
- Confirmed via: `plugins/strat-lab/skills/backtest/SKILL.md:178-199` ("Fundamentals-gated strategies refuse un-evaluable symbols (feature 215)" — the `fundamentals fetch failed for <SYM> — rerun` warning; "Symbols that could not be evaluated are reported, never skipped (feature 275)" — `NOT_FOUND`/`PERMISSION_DENIED` → FORMULA_ERROR), and `reference/output-handling.md:25-36`. Root `CLAUDE.md` Context Guide: a change to `run_backtest` behaviour must update the `backtest` skill in the **same** PR. With the fundamentals gate ON, a refused formula now yields FORMULA_ERROR instead of the "rerun" warning — the skill's rerun advice for real outages is unchanged.
- `docs/runbooks/legacy-formula-authors.md` exists (cross-reference target).

**TDD**: N/A (docs)

**Covers**: —

**Instructions** (each edit ≤ the minimal sentence; comments-style rule: constraints not narration):
1. Analysis `CLAUDE.md`: (a) `:49-52` — rewrite to: on every non-backtest path that traces readiness (`_compute_opportunities`, `EvaluateReadiness`, kick/`GetWatchlistReadiness`, materializer, daily refresh, heal) an indicators `NOT_FOUND` **or** `PERMISSION_DENIED` on a formula the traced rule references yields `formula_unreadable` (0/0, `bar_epoch >= 0`); an unreferenced refused component is skipped with one log line; backtest unchanged; **the live loop still skips / isolates**, so on an OR rule it may fire while the queue shows "formula not readable" (recorded Open Risk, `@AC-5 @feature-224`). (b) `:224` — add the `formula_unreadable` marker to the provenance/floor/structural-marker sentence and the non-held/held rank rule. (c) The § Fundamentals availability guard (`:432`, `:443`, `:457-465`): with the gate ON a refused `GetFormula` is "not a fundamentals formula" (no UNKNOWN), reaching `ExecuteFormula` → FORMULA_ERROR in backtests, no ScoreStrategy abort, marker in opportunities; outages still UNKNOWN; gate OFF unchanged; the live twin `declared_formula_fundamentals` unchanged; per-owner formula cache in `recompute_unscored_pairs`; Open Risk 3 now also applies with the gate ON.
2. UI `CLAUDE.md`: add a "**Formula-unreadable row (289).**" sub-bullet after the 215 bullet (`:132-138`) — testids `opportunity-formula-unreadable-<sym>`, `opportunity-formula-unreadable-mobile-<sym>`, `readiness-formula-unreadable`, `detail-formula-unreadable`, `readiness-cue-unreadable`; held rows show the action badge plus the cue; `readinessState` takes a required `formulaUnreadable`; update `:119-125`/`:176-179`-style readiness mentions and the "Enum render maps (083)" / "Mobile companion (083)" rows only where they enumerate states/flags.
3. strat-lab: in `SKILL.md` (feature-215/275 paragraphs, `:178-199`) and `reference/output-handling.md:25-36` add one sentence, starting `(feature 289)`: with `analysis.backtest.fundamentals.enabled` on, a symbol whose formula indicators refuses is `NO_TRADE_REASON_FORMULA_ERROR` (warning `backtest symbol <SYM> not evaluated: NOT_FOUND|PERMISSION_DENIED`), not the `fundamentals fetch failed … rerun` warning.
4. Reference the filed follow-up defect `docs/reports/2026-11-05-analysis-readiness-batch-loss-on-indicator-outage-defect.md` in the analysis `CLAUDE.md` open-risk sentence (do **not** re-create the report).
5. Operator action (restated for the PR body, not a repo edit): run the blast-radius SQL from § Execution Summary and the `legacy_authors` report-mode command before the dev rollout; note the expected flip of quiet partial rows to marked rows.
6. **Teardown (root `CLAUDE.md`):** after editing context files run `/context-forge:context-constitution refresh` scoped to the touched `CLAUDE.md` files (analysis, UI, strat-lab docs); if the plugin is unavailable, re-read each touched file against the code, reconcile drift, and record both facts in the PR body.

**Verification**:
```bash
cd "$(git rev-parse --show-toplevel)" && grep -n "formula_unreadable\|Formula-unreadable" services/xstockstrat-analysis/CLAUDE.md services/xstockstrat-ui/CLAUDE.md plugins/strat-lab/skills/backtest/SKILL.md plugins/strat-lab/skills/backtest/reference/output-handling.md && ! grep -q "skip the component with a warning" services/xstockstrat-analysis/CLAUDE.md && for f in plugins/strat-lab/skills/backtest/SKILL.md plugins/strat-lab/skills/backtest/reference/output-handling.md; do grep -q "feature 289" "$f" || { echo "missing feature 289 marker in $f"; exit 1; }; done
python3 plugins/strat-lab/scripts/validate.py --self-test && python3 plugins/strat-lab/scripts/validate.py
```
(The `skip the component with a warning` phrase (`services/xstockstrat-analysis/CLAUDE.md:52`) must not match after the edit; the first `grep -n` cannot confirm the strat-lab edits because Instruction 3 uses `FORMULA_ERROR`, not `formula_unreadable`, so the final per-file `for` loop (which fails if either file lacks it, unlike a two-file `grep -n` that passes on one hit) pins the distinctive `feature 289` marker Instruction 3 writes into both strat-lab files. The two `validate.py` runs are the strat-lab plugin validators required before the plugin changes ship, `docs/patterns/strat-lab-plugin.md:39-48`.) Plus `/proofread-claude-md services/xstockstrat-analysis/CLAUDE.md services/xstockstrat-ui/CLAUDE.md` if available.

---

### Step 14 — docs: promote scenarios into the durable per-service suites (integration PR only)

**Status**: `pending`
**Service**: `xstockstrat-analysis`, `xstockstrat-ui`, `xstockstrat-agent` durable acceptance suites
**Files**:
- `services/xstockstrat-analysis/acceptance/opportunity-compute-robustness.feature` — modify
- `services/xstockstrat-analysis/acceptance/opportunities-server-side-filters.feature` — modify
- `services/xstockstrat-analysis/acceptance/readiness-caching-poll-discipline.feature` — modify (EXTEND: FAST-path marker, @AC-20)
- `services/xstockstrat-ui/acceptance/opportunity-compute-robustness.feature` — modify
- `services/xstockstrat-ui/acceptance/watchlist-opportunity-signal-cues.feature` — modify
- `services/xstockstrat-ui/acceptance/watchlist-readiness-list-ux.feature` — modify
- `services/xstockstrat-agent/acceptance/opportunity-compute-robustness.feature` — modify
- `services/xstockstrat-analysis/acceptance/fix-backtest-silent-symbol-skip.feature` — modify (EXTEND: gate-ON counterpart of `@AC-7 @feature-275`, i.e. this feature's `@AC-22`)

**Reviewers**: none

**Codebase Evidence**:
- Confirmed via: `services/xstockstrat-analysis/acceptance/opportunity-compute-robustness.feature:17-22` — `@AC-1 @FR-1 @feature-185` "A data-unavailable symbol is marked unavailable, not evaluated-0/0" ("Given a candidate symbol whose bars/indicator fetch fails…"); the file exists in all three services' `acceptance/` dirs (`ls services/*/acceptance`), as do `opportunities-server-side-filters.feature` (analysis) and `watchlist-opportunity-signal-cues.feature` / `watchlist-readiness-list-ux.feature` (UI).
- Rules per `design.md` § Business Rules Touched (C-16): **CHANGE** `@AC-1 @FR-1 @feature-185` — add a clarifying line (a formula-visibility refusal is not "indicator fetch fails"/data-unavailable; outage codes still are, pinned by this feature's `@AC-4`); **EXTEND** `@AC-5 @FR-1 @feature-185` (round-trip), `@AC-3 @FR-1 @feature-190` (floor survival), UI `@AC-3 @FR-2 @feature-185` / `@AC-6 @FR-7 @feature-181` / `@AC-4 @FR-1 @feature-155`, agent `@AC-10 @FR-6 @feature-185`; `@AC-7 @feature-275` now also holds with the gate ON.
- Re-spec 2026-11-06: `@AC-7 @FR-3 @FR-4 @FR-8 @regression @feature-275` lives at `services/xstockstrat-analysis/acceptance/fix-backtest-silent-symbol-skip.feature:63` (owner NOT_FOUND → `NO_TRADE_REASON_FORMULA_ERROR`, warnings name the symbol and `NOT_FOUND`, `BACKTEST_STATUS_INSUFFICIENT_DATA`; no gate precondition). This feature's `@AC-22` (`acceptance.feature:168`) is the same outcome with `analysis.backtest.fundamentals.enabled` true, with and without an explicit start, so the file is added to **Files** as the EXTEND target; the `@AC-7 @feature-275` text itself is PRESERVE (unchanged).
- The durable-suite promotion is performed by the `/sdd-execute` integration PR (C-16; `/promote` backstop; `docs/sdd/business-rules/CLAUDE.md`). `/sdd-archiver` never deletes these files.

**TDD**: N/A (docs)

**Covers**: —

**Instructions**:
1. **Do not execute in the per-step PRs.** Perform this step only in the final integration PR, after Steps 1-13 are merged to `feature/fix-analysis-admin-formula-refusal`.
2. Add the clarifying line under `@AC-1 @feature-185`; promote `@AC-22` as a `@feature-289` scenario directly after `@AC-7 @feature-275` in `fix-backtest-silent-symbol-skip.feature` without editing the feature-275 text; and promote this feature's scenarios as `@feature-289`-tagged scenarios (keep IDs; no renumbering; `@AC-14` stays retired) into the suites above per the CHANGE/EXTEND/PRESERVE list in `design.md`.
3. Record in the integration PR body the C-16 sign-off references (`context.md` round-1 decisions 1-2, round-2 decision 2, round-3 decision 2, round-4 decision 1).

**Verification**:
```bash
cd "$(git rev-parse --show-toplevel)" && grep -rn "@feature-289" services/xstockstrat-analysis/acceptance services/xstockstrat-ui/acceptance services/xstockstrat-agent/acceptance | head && git diff --stat -- services/*/acceptance
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

### Step 2 — `_MAPPED` comment placed above the entry, not inline (2026-11-06)
- **Spec said**: Instruction 3 — add `"formula_unreadable",  # feature 289 — derived from the "formula_unreadable" provenance marker at read` to `TestOpportunityRowParity._MAPPED`.
- **Actual**: the inline form is 110 columns and fails the step's own `ruff check .` (E501, limit 100). The comment sits on its own line above `"formula_unreadable",`, the style the neighbouring `_MAPPED` entries already use. Same text, same set member.
- **Disposition**: lint fix on the step's own line (in scope per HARD CONSTRAINTS); no behaviour change.

### Step 3 — RED captured with an uncommitted probe; Step 4's suite does not exist yet (2026-11-06)
- **Spec said**: TDD red-green required; Verification = "run Step 4's test command (this step's behaviour is verified there), plus lint".
- **Actual**: Step 4 (the paired test step) lands after Step 3, and F-08 bars staging its files here. RED and GREEN were shown with an untracked probe `tests/test_zz_step3_probe.py` that asserted the three behaviours (`_readiness_to_proto` / `_symbol_readiness_from_json` carry `formula_unreadable`; the marker is in `_PROVENANCE_STRUCTURAL_MARKERS` and `_primary_source` skips it; the read floor SQL exempts it). The probe was deleted before commit. Step 4's command was run over the three existing files plus the full suite with coverage, as a regression check; Step 4 authors the durable tests and re-proves RED against the pre-Step-3 source.
- **Disposition**: retroactive-pairing RED via uncommitted probe (ledger `insights.md` service-before-test pattern); no Files change.

### Step 3 — comment wording and list layout fitted to the 100-column limit (2026-11-06)
- **Spec said**: Instruction 2 — append `"formula_unreadable"` to `_PROVENANCE_STRUCTURAL_MARKERS` and extend the comment by ≤ 1 line.
- **Actual**: the one-line list would be 118 columns, so it is one element per line (ruff-format layout); the new comment line reads "(unreadable-formula marker)" rather than "(the unreadable-formula marker)" to clear E501. Same members, same order plus the new token.
- **Disposition**: lint fix on the step's own lines (in scope per HARD CONSTRAINTS); no behaviour change.

### Step 4 — `_empty_readiness` also imported into `test_watchlist_readiness.py` (2026-11-06)
- **Spec said**: Instruction 2(b) adds the `_empty_readiness` import to `test_unreadable_formula.py`. Instruction 3 seeds a marked cache row in `test_watchlist_readiness.py` but names no import.
- **Actual**: `test_watchlist_readiness.py` also imports `_empty_readiness` from `app.services.evaluator`, so its seeded row is `{**_empty_readiness("MYSZ"), "formula_unreadable": True}`. `_readiness_to_proto` indexes `symbol`/`conviction`/`passing_conditions`/`total_conditions`/`conditions` directly, so a bare `{"formula_unreadable": True}` would raise `KeyError`. Each file keeps one inline seeded dict (C-13).
- **Disposition**: in-scope test construction detail in a listed Files entry; no behaviour change.

### Steps 5 + 6 — landed as one combined commit (operator decision, 2026-11-06)
- **Spec said**: Step 5 and Step 6 are separate steps, each with its own commit (§5.5 one commit per step); Step 5's Verification is "Step 6's command plus lint".
- **Actual**: on Step 5's blocker the operator chose Option C: run Steps 5 and 6 as one unit. Step 6's tests were authored first, including the Instruction 8 re-pin of `test_list_opportunities_unreadable_formula_is_not_unavailable` (`(1, 2)` → `(0, 0)`). RED was captured, then the saved Step 5 evaluator patch was applied. Both steps' Verification ran together, and both landed in ONE "step 5+6" commit with both Statuses flipped to `done`.
- **Disposition**: operator decision (Option C, 2026-11-06). Files = Step 5's plus Step 6's; no scope beyond the two steps.

### Step 6 — extending `_execute` turns the five feature-275 unit tests RED before Step 5 (2026-11-06)
- **Spec said**: Instruction 5 — extend `_execute(ev)` with `ref_name="z"` and an optional `sink` forwarded as `unreadable_sink=sink`. With no sink, the existing `test_live_path_*` tests are unchanged and stay green.
- **Actual**: `_execute` always forwards `unreadable_sink=sink`, `None` by default. On the pre-Step-5 tree, the five existing tests that call it (`test_backtest_permission_denied_…`, `test_backtest_not_found_…`, `test_live_path_permission_denied_…`, `test_live_path_not_found_…`, `test_backtest_unavailable_…`) therefore failed with `TypeError` on the unknown keyword. They are green after Step 5, and their assertions did not change.
- **Disposition**: expected consequence of the instructed helper change; RED noise only, no behaviour change.

### Step 6 — unreferenced and refusal cases parametrized over both codes (2026-11-06)
- **Spec said**: Instruction 1 — PERMISSION_DENIED → marker, and NOT_FOUND → marker plus exactly one log record. Instruction 2 — an unreferenced component gives no marker and one log line (no code named). Instruction 5 — the sink-present cases for both codes.
- **Actual**: the referenced, unreferenced and direct `_execute_formula` tests are parametrized over both `PERMISSION_DENIED` and `NOT_FOUND`. The one-log-record assertion is also made for `PERMISSION_DENIED`. The NOT_FOUND unreferenced variant already passed before Step 5, so it is a regression guard, not RED. The mixed (Instruction 3) and gathered-candidates (Instruction 6) tests use `PERMISSION_DENIED` as the refusal.
- **Disposition**: in-scope test construction in a listed Files entry; no behaviour change.

### Step 6 — `test_readiness.py` reuses `_definition`/`_sma_resp`/`_ADMIN_REFUSAL` from `test_unreadable_formula.py` (2026-11-06)
- **Spec said**: Instruction 7 — use a real `StrategyEvaluator`, with `_definition()` from `tests/test_unreadable_formula.py` or an equivalent minimal definition, and `"ComputeIndicator": _sma_resp`.
- **Actual**: `test_readiness.py` imports `_ADMIN_REFUSAL`, `_definition` and `_sma_resp` from `.test_unreadable_formula`, `RecordingStub` and `aio_rpc_error` from `.conftest`, and `StrategyEvaluator` and `grpc`. No second inline copy (C-13). The bars come from the already-imported `_real_bars`.
- **Disposition**: in-scope test construction; no new fixture.

### Steps 7 + 8a + 8b — landed as one combined commit (operator decision, 2026-11-06)
- **Spec said**: Step 7, Step 8a and Step 8b are separate steps, each with its own commit (§5.5); Step 7's Verification is "Step 8a's and Step 8b's commands plus lint".
- **Actual**: on Step 7's blocker the operator chose Option C: run Steps 7, 8a and 8b as one unit. The Step 8a and 8b tests were authored first, including Step 8b Instruction 2's re-pin of `test_grade_fundamentals_exclusion.py:396` to `== 2`. RED was captured against the pre-Step-7 tree. Then the saved Step 7 patch (`step7-servicer.patch`, applied unchanged) was applied. All three Verification blocks ran together and landed in ONE "step 7+8a+8b" commit with all three Statuses flipped to `done`.
- **Disposition**: operator decision (Option C, 2026-11-06). Files = Step 7's plus 8a's plus 8b's; no scope beyond the three steps.

### Step 8a — readiness, scheduled-pass and characterization cases are green on arrival (2026-11-06)
- **Spec said**: TDD — the red cases are AC-1/2/3/8/9/15-21 and AC-26 "on today's tree".
- **Actual**: that TDD line predates Steps 5+6. The evaluator marker from Step 5 already reaches every `compute_readiness_row` caller, and Step 7 does not touch those paths. So these cases passed before the Step 7 patch: `EvaluateReadiness` SLOW→FAST (@AC-2/@AC-20), kick + `GetWatchlistReadiness` (@AC-3) and the materializer (@AC-8, both stub variants). They are regression guards. The cases that depend on Step 7 were RED: opportunities (@AC-1/15/16/17/18/21/26), the daily refresh (@AC-19) and the heal (@AC-9). The characterization cases were green as specified: @AC-4, @AC-10, @AC-11 (new live-loop test), @AC-12 and @AC-13.
- **Disposition**: red N/A for the readiness half (behaviour already delivered by Step 5); recorded, no scope change.

### Step 8a — test construction choices (2026-11-06)
- **Spec said**: Instruction 0 lists the imports to add; Instruction 1 describes opportunities assertions (axis, composite, action) and a sibling `UNAVAILABLE` "for another component on the same symbol".
- **Actual**:
  - `asyncio`, `logging` and `timedelta` were already imported (Step 6), so only `re` was added.
  - `_ctx`, `_HEADERS`, `_sig`, `_strat_row` and `_GT_100` are imported from `tests.test_analysis_servicer` beyond the listed set. They serve the 0.9-floor `ListOpportunities` re-read, the held sell signal and the sibling strategy. `_due_schedule` is used for the materializer tick.
  - `Opportunity` has no `signal_axis` field, so action, axis and composite are asserted on the stored `_FakeOppRepo` rows or on the `_compute_opportunities` return value. The floor, `source` and `available_sources` assertions read the `ListOpportunities` response.
  - The sibling outage is a third binding `tech` (`_strat_row`, SMA(3)) whose `ComputeIndicator` raises `UNAVAILABLE`. It is parametrized over early and late completion.
  - The SLOW→FAST case uses `_cache_svc` and feeds the SLOW upsert back as `read_many`, the stateful-stub option the spec allows.
- **Disposition**: in-scope test construction in a listed Files entry; no behaviour change.

### Step 8b — test construction choices (2026-11-06)
- **Spec said**: Instruction 1 — the gate-ON cases plus NOT_FOUND parameters for the two `test_fundamentals_pit_pager.py` siblings; Instruction 2 — the per-owner re-pin plus a u1/u2 poisoning test.
- **Actual**:
  - `test_backtest_fundamentals_guard.py` has no RPC-error helper, so the NOT_FOUND `AioRpcError` is built inline once in the new test.
  - The `ScoreStrategy` refusal case also asserts `evidence_symbols == 2`. SCHD's 0-trade cell now counts, which is the accepted risk recorded at design round 4.
  - The poisoning test is parametrized over both pair orders. It reads each owner's derived score from `svc._strategies`.
  - In `test_fundamentals_pit_pager.py` both siblings are parametrized over `UNAVAILABLE` and `NOT_FOUND`. The evaluator NOT_FOUND case was green before the change, which pins the live twin as unchanged.
- **Disposition**: in-scope test construction in listed Files entries; no behaviour change.

### Step 7 — evaluator constraint comment at `:697`, not `:675` (2026-11-06)
- **Spec said**: Instruction 5 — add the constraint comment at `evaluator.py:675`.
- **Actual**: Step 5 shifted the anchor. The comment sits directly above the same `except grpc.RpcError:` in `declared_formula_fundamentals`, now `evaluator.py:697-699`. The heal's marked row writes conviction `0.0` as a literal, which equals the 0/0 trace's conviction.
- **Disposition**: anchor drift only; same location by symbol.

### Step 9 — RED captured with an uncommitted probe; Step 10 Instruction 3 not staged here (2026-11-06)
- **Spec said**: TDD — the red run is Step 10 Instruction 3 (the `list_opportunities` docstring mentions `formula_unreadable`), written and run before this step's `tools.py` edit.
- **Actual**: F-08 bars staging Step 10's `tests/test_tools.py` in the Step 9 commit. RED and GREEN were shown with an untracked probe `tests/test_zz_step9_probe.py`, which reads the registered tool description (whitespace-normalized) and asserts the new `formula_unreadable (true = the row's strategy references a formula` clause and `never also data_unavailable`. The probe was deleted before commit. Step 10 authors the durable assertion; with Step 9 landed it is a guard, as Step 10's TDD line allows.
- **Disposition**: retroactive-pairing RED via uncommitted probe (same as Step 3); no Files change.

### Step 9 — runbook bullet names `available_sources` as a response facet (2026-11-06)
- **Spec said**: Instruction 2 — "never an `Opportunity.source` / `available_sources` facet".
- **Actual**: `available_sources` is a `ListOpportunitiesResponse` field (`analysis.proto:725`) that the agent does not project, so the bullet reads "never an opportunity `source` (nor a `ListOpportunities` `available_sources` facet)". Same rule, no claim of an agent field that does not exist.
- **Disposition**: wording precision in a listed Files entry; no behaviour change.

### Step 10 — `list_opportunities` mapping case added beside the feature-185 case, not merged into it (2026-11-06)
- **Spec said**: Instruction 2 — extend the `list_opportunities` mapping case so a returned page with the marked `MYSZ`/`s-1` row surfaces `formula_unreadable True` in `["opportunities"][0]`.
- **Actual**: `TestListOpportunitiesClient` gains a sibling `test_projects_formula_unreadable_row` that builds the same page/stub/`mtls` patch shape as `test_projects_data_unavailable_and_response_pending_flags` (`test_client.py:1352`). Putting `MYSZ` at index 0 of the existing case would have re-indexed its feature-185 `GME`/`AAPL` assertions. The new case asserts `MYSZ`/`s-1` at `[0]` with `formula_unreadable True`, `data_unavailable False`, action UNSPECIFIED, and the evaluated `[1]` row `False`.
- **Disposition**: same file and class, same assertion; no Files change.

### Step 11 — RED captured with an uncommitted probe; Step 12 is not authored yet (2026-11-06)
- **Spec said**: TDD — red-green, paired with Step 12, "which is authored first".
- **Actual**: in sequential order Step 12 runs after Step 11, and F-08 bars staging Step 12's files here. RED and GREEN were shown with an untracked probe, `src/lib/zz_step11_probe.test.ts`. It asserts three things: `readinessState` of a marked 0/0 row is `'unreadable'`; `rollupReadiness` counts it in `unreadable` with the five-bucket sum intact; and `READINESS_CUE.unreadable` has the label `formula not readable` and an icon. RED: 3 failed. GREEN: 3 passed. The probe was deleted before commit. Step 12 authors the durable cases.
- **Disposition**: retroactive-pairing RED via uncommitted probe (same as Steps 3 and 9); no Files change.

### Step 11 — `tsc --noEmit` and `format:check` are not clean on HEAD for reasons outside this step (2026-11-06)
- **Spec said**: Verification — `pnpm exec tsc --noEmit && pnpm run lint && pnpm run format:check && pnpm run test:unit`.
- **Actual**: `tsc --noEmit` reports only `e2e/insights/backfills.spec.ts(135,23)` and `(136,23)` (TS2339 on a closure-assigned `triggered` narrowed to `never`, TypeScript 5.9.3). Both appear identically on the pre-Step-11 tree, and no file of this step is involved. CI has no standalone `tsc` job, which is why they are latent. `format:check` (`prettier --check src`) flags 7 files this step does not touch (`pnl-patterns/page.tsx`, `PerformanceDashboard.tsx`, `CredentialStatusBadge.tsx`, `useAccountPortfolios.ts`, `useSignalAttribution.ts`, `performanceMetrics{,.test}.ts`). `prettier --check` on the 10 Files passes. `lint` passes with no warning in a touched file. `test:unit` passes (65 files, 371 tests).
- **Disposition**: pre-existing, out of scope; judged on no new `tsc` error and on the touched files' formatting. Not fixed here (F-08).

### Step 11 — construction choices (2026-11-06)
- **Spec said**: Instructions 3-6 — render the cue "icon + text"; fix every `readinessState` call site that `tsc` flags.
- **Actual**:
  - The queue (desktop and mobile) readiness cells render `<EnumBadge render={READINESS_CUE.unreadable} />` inside the `role="status"` span that carries the testid and the per-symbol `aria-label`. This reuses the C-17 primitive and keeps the icon choice in `READINESS_CUE` (DRY).
  - The queue header badges carry no testid, since the spec names none. The held row shows the action badge and then the cue.
  - In the detail header, the held-row action badge and cue are wrapped in a `flex gap-2` div so they stay together in the `justify-between` header.
  - `SignalReadiness.tsx:108` and `WatchlistReadiness.tsx:235,296` needed no edit. Their arguments are the generated `SymbolReadiness`, which already carries `formulaUnreadable` (Step 2).
  - The 3 `isFiring` calls in `readinessRollup.test.ts` are untouched (`isFiring`'s param type is unchanged).
  - `LockSimple` is confirmed at `node_modules/@phosphor-icons/react/dist/index.d.ts:869`, so the `Lock` fallback is unused.
- **Disposition**: within the listed Files; no behaviour beyond the Instructions.

### Step 12 — RED captured by reverting Step 11's sources in the working tree (2026-11-06)
- **Spec said**: TDD — Playwright and the new vitest cases are authored first and FAIL against the pre-Step-11 UI.
- **Actual**: in sequential order Step 11 was already committed (`29b7e5fa`). After authoring Step 12, the 8 non-test Step 11 sources were checked out from `29b7e5fa~1` into the working tree. RED was captured against that tree, and the files were restored with `git checkout HEAD --` before GREEN. Nothing was committed in between.
  - Vitest RED: 10 failed, 8 passed.
  - Playwright RED: all 6 new cases failed. Each failure was a missing testid: `opportunity-formula-unreadable-MYSZ` / `-mobile-MYSZ`, `readiness-cue-unreadable`, `detail-formula-unreadable`.
- **Disposition**: red-before-green shown against the real pre-implementation UI; no Files change.

### Step 12 — Playwright run on the production bundle (`CI=1`) (2026-11-06)
- **Spec said**: Verification — `pnpm exec playwright test <3 specs>`.
- **Actual**: on the local `pnpm dev` harness, the `setup` warm-up project timed out at its 10 s local limit on first-hit compile, so no test ran. The same command was run with `CI=1`, which uses `pnpm build && pnpm start` with the CI timeouts and retries. That is the configuration CI's `frontend-e2e` job uses. GREEN: 92 passed across the 3 specs, with no retry and no flake.
- **Disposition**: CI-equivalent fallback.

### Step 12 — `tsc --noEmit` and `format:check` carry the same pre-existing noise as Step 11 (2026-11-06)
- **Spec said**: Verification — `tsc --noEmit && pnpm run lint && pnpm run format:check`.
- **Actual**: `tsc` reports only the 2 pre-existing `e2e/insights/backfills.spec.ts:135-136` TS2339 errors. `format:check` flags the same 7 untouched files. `prettier --check` on the 8 touched TS files passes, and `lint` exits 0 with no warning in a touched file.
- **Disposition**: pre-existing, out of scope (see Step 11's entry); not fixed here (F-08).

### Step 12 — construction choices (2026-11-06)
- **Spec said**: Instructions 2-3 — add a non-held and a held MYSZ fixture, serve the queue rows by a per-test `page.route`, and keep the row visible at a raised floor.
- **Actual**:
  - The held variant is named `MYSZ_FORMULA_UNREADABLE_HELD_OPPORTUNITY`. It spreads the non-held row and overrides `action` and `provenance`.
  - Both rows use `strategyId: 'strat-live-001'`. The position-detail test binds the watchlist to the same strategy.
  - The per-test route `routeWithUnreadableRow` applies the `minConviction` floor to `OPPORTUNITIES`, the same as the existing `mockOpportunities`. It always appends the marked row, so the floor-exemption assertion is meaningful.
  - The `@AC-27` held case asserts two `img` elements named "formula not readable" in the card: the header cue and the readiness-cell cue.
  - `watchlistMock.ts` needed no code change, because it already spreads the override. Only its comment that lists the override keys gains `MYSZ`.
  - `INVENTORY.md` gains a canonical-fixtures row for the two MYSZ rows and a sentinel row for the `MYSZ` readiness override.
  - The vitest cue case also asserts that the unreadable icon differs from the quiet and no-data icons (`@AC-4 @feature-155`).
- **Disposition**: within the listed Files; no behaviour beyond the Instructions.
