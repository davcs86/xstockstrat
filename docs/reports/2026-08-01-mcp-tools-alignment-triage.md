# MCP Tools ↔ Backend Alignment Triage — 2026-08-01

Root-cause triage from a full audit of the seventeen `xstockstrat-agent` MCP tools, as of
`main-dev` @ `eaa4f0c` (2026-08-01). The audit compared each tool's docstring against the agent
client layer (`services/xstockstrat-agent/app/client.py`) and the backing
servicers/repositories/protos/migrations of ingest, notify, indicators, analysis, and config —
every behavioral claim below was verified by reading that code. **Nothing is fixed by this
report**: it records where the MCP surface understates the services, where it (or its docs)
promises more than the services deliver, why, and what to do about it, so each finding can be
routed individually. GitHub Issues are disabled on this repo, so findings live here until routed
via `/sdd-triage --from-report`.

Legend: **U** = MCP understates the service (capability exists server-side, unreachable via the
tool); **O** = tool/docs overpromise (implied behavior the service does not deliver);
severity per `docs/runbooks/bug-triage.md` (SEV-1 outage/data-loss, SEV-2 feature-broken/risk,
SEV-3 quality).

---

## Root causes

The individual findings collapse into six structural causes:

| RC | Root cause | Instances |
|---|---|---|
| **RC-1** | **Hand-written dict→proto mapping with no parity check.** The agent client builds each request field-by-field; proto fields it never touches silently fall out of the MCP surface. The repo owns the antidote — the descriptor-parity test guarding `backtest_view` — but applies it to one projection only. | `RegisterFormulaRequest.outputs`/`warmup_period`, `ScreenCriterion.component`, `SignalSource.active`, `EmitAlertRequest.context`/`tags`/`correlation_id`, source health fields on list |
| **RC-2** | **Write-semantics divergence across the `manage_*` verbs.** Feature 070 gave `ManageStrategy` AIP-161 partial merge via `update_mask`; `UpdateFormula` and `ManageSignalSource` kept full-replace (unconditional `UPDATE SET` / blind `ON CONFLICT DO UPDATE`). The fix never propagated sideways. | F-2, F-6 |
| **RC-3** | **Registry/value conflation in config.** `config.config_values` is simultaneously key registry and value store; existence ⇔ a value row. | F-8 (typo-creates-key, unreachable `NOT_FOUND`, no create-audit, "registered but unset" unrepresentable) |
| **RC-4** | **Contract-first fields whose engine implementation never landed.** Proto/docs promise a knob; no code reads it; nothing fails. | `ScreenSymbolsRequest.min_conviction`, `ingest.signals.<source>.default_conviction`, `NO_TRADE_REASON_INSUFFICIENT_CAPITAL`, `notify.alert.max_body_bytes`, `indicators.sandbox.max_concurrent` |
| **RC-5** | **Two unreconciled credential conventions + a scope-blind config read.** Feature 008 stores `credentials_ref` on the ingest row (convention `secret.ingest.sources.<slug>.*`, read by nothing); feature 009's extract tools resolve a *different* key (`source.<slug>.credentials`) via `get_config_value`, which hardcodes `namespace="agent"`, sends no environment (config resolves unspecified ⇒ **dev**), and swallows all errors. | F-1 |
| **RC-6** | **One-way lifecycle verbs.** `active` is column-authoritative, rejected in `update_mask`, and no RPC sets it back to TRUE; strategy re-register hits the PK uncaught. `DeleteFormula` is a hard DELETE with no referential check against `definition_json` component refs. | F-2, F-5 |

Meta-cause spanning all six: **tool docstrings, `docs/runbooks/mcp-tools.md`, and the strat-lab
skill are hand-written prose with almost no executable link to behavior** (two substring asserts
in `tests/test_tools_endpoint.py`). Drift is caught only by manual audits.

---

## Findings

### F-1 (O, SEV-2) — Extract-tool credential resolution is structurally broken
`extract_email_content` / `extract_website_content` key their credential lookup off
`has_credentials` — derived from the **ingest** row's `credentials_ref`
(`services/xstockstrat-ingest/app/handlers/servicer.py:901`) — but resolve the secret from an
unrelated store: config key `source.<slug>.credentials` in namespace `agent`
(`services/xstockstrat-agent/app/tools.py` → `client.get_config_value`,
`app/client.py:678-695`). Two defects stack on top: the read sends no environment, which the
config service resolves to **dev** (`services/xstockstrat-config/src/grpc/configServiceImpl.ts:84-97`
`resolveEnv`) — so a production agent reads the dev scope — and every error is swallowed to
`None`. Net effect: password-protected PDFs and authenticated websites work only if an operator
seeds a dev-scoped, agent-namespace, non-`secret.`-prefixed plaintext key that no runbook
documents, while the documented `credentials_ref` convention is read by nothing. Partially
recorded in `services/xstockstrat-agent/docs/context-constitution-findings.md`.
**Use today:** treat both extract tools as unauthenticated-content-only; do not trust
`has_credentials`.
**Recommendation (radical):** give extraction credentials one owner. Cleanest: ingest resolves
its own `credentials_ref` and exposes a `ResolveSourceCredential` RPC gated by `x-mcp-secret`
(or moves mediated extraction fully server-side into its `extractor_module`s); then delete the
agent's `source.<slug>.credentials` path and the namespace/env-blind `get_config_value`.
Interim (no proto change): parameterize `get_config_value` with namespace + environment,
standardize the key, and document per-environment seeding in `docs/runbooks/add-data-source.md`.

### F-2 (O, SEV-2) — `manage_formula` update wipes; no read-back tool exists
`UpdateFormula` is a full replace — the repo UPDATE sets `name, description, source, is_public,
parameters, outputs, warmup_period` unconditionally
(`services/xstockstrat-indicators/app/repositories/formulas_repository.py:163-192`) — and the
agent sends proto defaults for every omitted field (`app/client.py:449-460`). A one-field update
therefore destroys `source`, drops `parameters`, silently un-publishes (`is_public=false`), and
zeroes `outputs`/`warmup_period`. The tool docstring reads as if update were partial. Worse,
the platform gives the model **no way to read a formula back**: `ListFormulas`/`GetFormula` RPCs
exist and `client.list_formulas` exists **unused**, so safe read-modify-write is impossible via
MCP. `DeleteFormula` is a hard `DELETE` with no check for strategies still referencing the
formula (`formulas_repository.py:194-199`); such strategies fail later at evaluation time.
**Use today:** keep the full definition from registration and resend everything on update; never
update from memory; treat delete as forbidden while any strategy references the formula.
**Recommendation:** (a) register `get_formula`/`list_formulas` read tools — one decorator away;
(b) propagate the feature-070 `update_mask` pattern to `UpdateFormula` (RC-2); (c) make delete
soft or reference-checked (scan strategies' `definition_json` component refs).

### F-3 (U, SEV-2) — MCP-registered formulas are capability-crippled vs the service
The indicators service supports declared secondary output series (`outputs`, addressable in
strategy rules as `<ref>.<series>`) and a declared `warmup_period`
(`RegisterFormulaRequest` fields 8–9); the agent client sends neither (`app/client.py:436-446`).
Analysis validates dotted series refs against *declared* outputs (fail-closed to `{"value"}`), so
MCP-registered formulas expose only the primary `value` series — forcing one-formula-per-series
workarounds, exactly what `docs/reports/2026-07-20-custom-indicators-strategies.md` had to do.
Related service-side ceiling: the strategy evaluator feeds custom formulas **close-only** data
(`services/xstockstrat-analysis/app/services/evaluator.py` `_compute_component`), so
high/low/volume indicators are inexpressible regardless.
**Recommendation:** add `outputs` + `warmup_period` params to `manage_formula` (agent-only
change) and a descriptor-parity test over the request builder (RC-1). The close-only evaluator
is a service roadmap item; until then split multi-series indicators per series.

### F-4 (O, SEV-3) — `screen_symbols` ships dead knobs and cannot do technicals
Three overpromises: (1) the docstring advertises `SCREEN_KIND_TECHNICAL_FORMULA`, but technical
kinds require `ScreenCriterion.component`, which the wrapper never maps (`app/client.py:220-222`)
— technical criteria are **silently skipped**; (2) `min_conviction` is accepted and ignored —
zero reads in `services/xstockstrat-analysis/app/services/screener.py`; (3) an unknown
fundamental `metric_name` silently skips the criterion rather than erroring
(`screener.py:318-327`). Also: `coverage_gaps` are computed after rank truncation
(`screener.py:125-130`) and the agent projection drops the `timeframe`/`bars_have`/`bars_need`
detail the proto carries.
**Use today:** fundamentals + signal blend only; apply your own score cutoff; filter on `passed`.
**Recommendation:** implement `min_conviction` in the screener (a one-clause filter) or remove
the field at the next breaking proto rev; map `component` in the agent — the server-side
capability is fully built, so this unlocks technical screening with no service change; pass gap
details through.

### F-5 (O, SEV-2) — Strategy deactivation is irreversible; duplicate register crashes ugly
No code path sets `active=TRUE`; the field is column-authoritative and explicitly rejected in an
`update_mask` (`services/xstockstrat-analysis/app/handlers/servicer.py:2340`, `:1570-1576`), and
re-registering the id hits the PK as an uncaught `UniqueViolationError` → generic INTERNAL, not
`ALREADY_EXISTS` (`app/repositories/strategies.py:33-45`). Deactivation is permanent-by-accident.
**Use today:** version strategy ids (`_v2`, `_v3`); never reuse or expect to reactivate one.
**Recommendation:** add a reactivate verb (`STRATEGY_OPERATION_REACTIVATE`, or let register
upsert-on-inactive) and catch the unique violation → `ALREADY_EXISTS` so the failure is honest.

### F-6 (O, SEV-2) — `manage_signal_source` register/update is one destructive upsert
The docstring presents register/update/deactivate as distinct safe verbs. Reality
(`services/xstockstrat-ingest/app/handlers/servicer.py:912-976`,
`app/repositories/signal_sources.py:93-121`): register and update share one blind full-replace
upsert — register on an existing slug silently overwrites it, update on an unknown slug silently
creates it, omitted fields blank stored values, omitting `credentials_ref` NULLs the stored
reference (`has_credentials` flips false), and the agent always sends `active=True`
(`app/client.py:507`), so any update also reactivates a deactivated source (this is in fact the
only reactivation path). No slug format validation exists, and `mediated_authenticated_website`
escapes the credentials_ref-required check that plain `authenticated_website` has
(`servicer.py:922-927`).
**Use today:** always resend the complete definition (fetch current fields from
`list_signal_sources`; re-supply `credentials_ref` from your records — it is never readable).
**Recommendation:** split the upsert into honest verbs (register → `ALREADY_EXISTS` on conflict;
update → `NOT_FOUND` + field-mask merge per RC-2), decouple update from reactivation, and close
the `mediated_authenticated_website` validation gap.

### F-7 (O, SEV-3) — `set_strategy_live` accepts configurations that can never fire
Enabling live on an inactive strategy succeeds and stores an inert flag — the live loop selects
`live_enabled = TRUE AND active = TRUE`
(`services/xstockstrat-analysis/app/engine/live_loop.py:89-91`) — and a strategy without
`signal_params.symbols` is silently skipped every cycle (`live_loop.py:109-114`). The docstring
also references `list_strategy_definitions`, which is not a registered MCP tool, and promises
"the updated strategy definition" when the response is a 4-field subset
(`app/client.py:669-675`).
**Use today:** after enabling, `get_strategy` and verify `active=true` and a non-empty
`signal_params.symbols`.
**Recommendation:** return `FAILED_PRECONDITION` (or a `warnings[]` field) from `SetStrategyLive`
for both inert configurations — the RPC already has everything it needs to detect them.

### F-8 (O, SEV-3) — `set_config` typo-creates orphan keys; the guard data is already in hand
`SetConfig` is a blind upsert with no existence check
(`services/xstockstrat-config/src/grpc/configServiceImpl.ts:286-334`): a mistyped key silently
creates a metadata-less row no service reads, and the tool's `NOT_FOUND → "config key not
found"` mapping is unreachable. Notably the agent tool already calls `ListKeys` on every write
for its secret-flag check — it has the existence answer and discards it. Related RC-3 effects:
unknown namespaces return empty (never `NOT_FOUND`) from `GetConfig`/`ListKeys`, creates write
no audit row, and "registered but unset" is unrepresentable.
**Use today:** `list_config_keys` immediately before every write; copy the key verbatim.
**Recommendation:** cheap agent-side fix — refuse keys absent from the `ListKeys` result unless
an explicit `create_key=true` parameter is passed. Structural fix — a real key registry in
config (registration migration + `SetConfig` rejecting unregistered keys), which also makes
`NOT_FOUND` reachable, unset-registered keys representable, and creates auditable.

### F-9 (O, SEV-3) — `ingest_signal` conviction contract
The tool docstring claims "ingest applies source default if absent" — false: the documented
`ingest.signals.<source>.default_conviction` key has zero readers (already recorded in
`services/xstockstrat-ingest/docs/context-constitution-findings.md`), and ingest stores
absent/0.0 conviction as NULL (`servicer.py:692`) — a genuine zero-conviction signal is
unrepresentable. Values > 1.0 escape Python validation and die as a DB CHECK → INTERNAL
(migration `001_newsletter_signals.up.sql:14`), not `INVALID_ARGUMENT`. The tool's auto-alert
side effect (threshold `agent.signal.alert_threshold`, default 0.6, failure swallowed) is
undocumented in the docstring — inviting a model to double-alert via `emit_alert`.
**Use today:** always pass conviction explicitly in `(0.0, 1.0]`; treat omitted as "no
conviction", never "default"; don't emit a manual alert for a high-conviction ingest.
**Recommendation:** implement the documented default-conviction key in ingest or delete it from
the docs; range-validate conviction in the servicer (`INVALID_ARGUMENT`).

### F-10 (U, SEV-3) — Service capabilities with no MCP surface at all
Built and reachable over gRPC, invisible to the agent: `ListStrategyDefinitions` (client fn
exists, unused), `ListFormulas`/`GetFormula` (see F-2), `CancelBackfill` (admin-gated in ingest —
the agent can start a paid backfill but never stop one), `ExecuteFormula` (supports **inline
source + timeout override**, i.e. a formula test-run), notify's `context`/`tags`/`correlation_id`
alert fields, and ingest's source-health fields (`health`/`last_seen_at`/`last_error`/
`signals_fed`, dropped in `client.list_signal_sources`). `emit_alert` also hides two behaviors:
unknown severity strings silently coerce to `'info'` (`app/client.py:44-49,125`; `'error'` is a
valid value the docstring omits), and notify applies **no field validation** — empty
`title`/`body` are stored and delivered blank (proto3 strings are never NULL, so the `NOT NULL`
columns never fire; `services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts:36-58`).
**Recommendation (highest leverage first):** expose `test_formula` via `ExecuteFormula` — it
converts "formula source is stored with zero validation" into a safe dry-run-then-register
workflow with **zero backend change**; add `cancel_backfill` (cost control on a paid operation);
add `list_strategies` / `get_formula` reads; pass health fields through `list_signal_sources`.

### F-11 (O, SEV-2) — Authorization is asymmetric where it matters most
Management tools ride a hardcoded admin scope (`x-access-scope: "7"`, invariants AGENT-3/4)
except `set_config`, which forwards the real caller's derived scope (feature 073). Server-side,
ingest gates `CancelBackfill` on admin but **not `TriggerBackfill`**
(`servicer.py:169-203` vs `:587`) — the operation that spends provider quota is the ungated one —
and notify's `EmitAlert` is fully ungated. The `trigger_backfill` docstring's "admin-scoped"
promise is thus decorative: the agent sends the scope; nothing checks it.
**Recommendation:** gate `TriggerBackfill` server-side like `CancelBackfill`; extend the
feature-073 caller-derived-scope pattern to the other write tools (`manage_*`,
`set_strategy_live`, `trigger_backfill`), starting with `trigger_backfill`.

### F-12 (O, SEV-3) — Documentation surfaces that drifted from behavior
`docs/runbooks/mcp-tools.md`: documents `emit_alert` returning `{"success": true}` (code returns
`{"alert_id", ...}`); documents `min_conviction` as "minimum blended score to pass" (never read —
F-4); repeats the false conviction claim "Ingest applies source default if absent" in the
`ingest_signal` parameter table (F-9's docs twin — the same sentence also appears in the tools.py
docstring, F-13); several error rows still say `HTTP 400` (pre-gRPC residue).
`plugins/strat-lab/skills/backtest/SKILL.md:37`: still teaches pre-070 full-replace
`manage_strategy update` — wrong against this repo's code. If the skill deliberately tracks the
deployed **staging** backend, that lag should be stated in the skill; otherwise the root
CLAUDE.md same-PR rule for these tools was missed when feature 070 landed.
**Recommendation:** fix the runbook rows; resolve the strat-lab skill's intent (track code vs
track staging) and update it accordingly; add return-shape contract tests for the tools — the
`backtest_view` descriptor-parity test is the in-repo template — so prose and behavior cannot
drift silently again.

### F-13 (O+U, SEV-3) — `tools.py` docstrings out of sync with verified behavior
The docstring layer itself needs a synchronization pass (docs-only change to
`services/xstockstrat-agent/app/tools.py`; the audit that produced this report drafted the full
text, reproducible from the findings above). The pass must:
- **Correct three false claims:** the conviction "source default" sentence (F-9); the pointer to
  the RPC `outputs` field as usable for multi-series formulas — the tool never sends it (F-3);
  the `set_strategy_live` reference to `list_strategy_definitions`, a tool that is not
  registered (F-7).
- **Document destructive/side-effect behavior:** `ingest_signal`'s auto-alert;
  `manage_formula`/`manage_signal_source` full-replace updates incl. the credentials_ref wipe
  (F-2, F-6); hard formula delete; deactivation permanence and duplicate-register crash (F-5);
  `set_config`'s create-on-typo upsert (F-8); `set_strategy_live`'s inert-success paths and
  4-field return (F-7); the extract tools' credential caveat (F-1 — say resolution is
  *attempted* and `has_credentials` does not guarantee it succeeds).
- **Document behavior a model needs to interpret results:** full return shapes where missing
  (`screen_symbols`, `manage_formula` per-operation, `manage_signal_source`); camelCase
  `manage_strategy` response vs snake_case `get_strategy`; int64-as-JSON-string serialization
  (`run_backtest`, `get_backfill_status`); silent severity coercion, broadcast default, and
  no-validation storage on `emit_alert` (F-10); empty-namespace-not-an-error and opaque
  `version` on the config reads; client-side ValueError guards and the 365-day default range on
  `trigger_backfill`; dead knobs and skip semantics on `screen_symbols` (F-4).
- **Preserve** the substrings asserted by `tests/test_tools_endpoint.py` ("Ingest a trading
  signal") and keep descriptions bounded — they ship in every `tools/list` response and render
  on the unauthenticated `/accounts/mcp-tools` page, so operative caveats belong in docstrings
  while encyclopedic detail (enum tables, sandbox limits) belongs in the runbook (F-12).

---

## Alignment matrix (docstrings vs verified behavior)

| Tool | Verdict | Findings |
|---|---|---|
| `run_backtest` | **Aligned** — the reference standard (parity-tested projection) | — |
| `get_strategy`, `get_backfill_status`, `list_config_keys` | Aligned; minor omissions only | F-8 (empty-namespace nuance), F-13 |
| `list_signal_sources` | Understates (health fields dropped) | F-10 |
| `emit_alert` | Understates + hides silent severity coercion, broadcast default, no validation | F-10, F-13 |
| `ingest_signal` | Overpromises (false conviction default; hidden auto-alert) | F-9, F-13 |
| `extract_email_content` / `extract_website_content` | **Overpromises** (credentials structurally unreliable) | F-1, F-13 |
| `screen_symbols` | **Overpromises** (dead `min_conviction`; unreachable technical kinds) | F-4, F-13 |
| `manage_strategy` | Mostly aligned; lifecycle + response-casing omissions | F-5, F-13 |
| `manage_formula` | **Worst overpromise** (implied partial update; unreachable `outputs`; hard delete) | F-2, F-3, F-13 |
| `manage_signal_source` | **Overpromises** (destructive upsert behind safe-looking verbs) | F-6, F-13 |
| `set_strategy_live` | Overpromises (inert-success paths; nonexistent tool reference) | F-7, F-13 |
| `trigger_backfill` | Overpromises protection (admin scope sent, never checked); no cancel | F-10, F-11 |
| `get_config` / `set_config` | Overpromise on errors (unreachable NOT_FOUND; typo-creates-key) | F-8, F-13 |

## Suggested routing

- **Track C (SDD features):** F-1 (credential ownership), F-2/F-3 (formula field-mask + outputs
  + read tools), F-6 (source verb split), F-8 structural registry, F-10 (test/cancel/read
  tools), F-11 (authz unification).
- **Track B / small server fixes:** F-4 `min_conviction` filter, F-5 `ALREADY_EXISTS` catch,
  F-7 precondition check, F-9 conviction range validation.
- **Docs-only:** F-12 (runbook rows, strat-lab skill intent) and F-13 (the tools.py docstring
  synchronization pass).

---

## Triage disposition (2026-08-02)

All 13 findings were re-verified against current `main-dev` code (one read-only investigator per
finding) — every one CONFIRMED. Disposition:

**Fixed in this pass (docs-only — no behavior change):**

- **F-12** — corrected the drifted rows in `docs/runbooks/mcp-tools.md` (`emit_alert` return is
  `{"alert_id": …}` not `{"success": true}`; `min_conviction` marked ignored; `ingest_signal`
  conviction "no source default"; `HTTP 400` → gRPC status rows; technical screen kinds noted as
  silently skipped) and updated the `strat-lab` skill/README to the feature-070 partial-merge
  semantics (it had taught pre-070 full-replace).
- **F-13** — synchronized every affected `tools.py` docstring to verified behavior: the three false
  claims (F-9 conviction default, F-3 `outputs`, F-7 `list_strategy_definitions`), the destructive /
  side-effect behavior (auto-alert, full-replace formula/source updates, hard delete, one-way
  strategy lifecycle, `set_config` create-on-typo, `set_strategy_live` inert-success, extract-tool
  credential caveat), and result-interpretation notes (return shapes, camelCase vs snake_case,
  int64-as-JSON-string, severity coercion, empty-namespace-not-an-error). The test-guarded
  substring `"Ingest a trading signal"` is preserved; `pytest` (55 tool tests) + `ruff` green.

**Prevention captured (context hardening):**

- Ledger `fails.md` (2026-08-02) — the doc↔behavior drift meta-cause (RC-1 + hand-written docs with
  no executable link); `insights.md` (2026-08-02) — the descriptor-parity / return-shape
  contract-test antidote (mirror `test_backtest_view.py`).
- `services/xstockstrat-agent/docs/context-constitution-findings.md` — the 10 behavioral defects
  recorded as open, pointing here, so they are not re-discovered.

**Routed to SDD feature directories (2026-08-02) — `draft`, not yet implemented.** The behavioral
fixes were bundled by shared surface / root cause (per the cross-finding notes) into nine Track C
features. Each needs the SDD pipeline (`/sdd-design` → `/sdd-spec` → `/sdd-execute` with design
gates); the full per-finding fix plan lives in this report and each feature's `context.md` points
back here.

| Feature dir | Findings | Severity | Design depth |
|---|---|---|---|
| `086-fix-mcp-formula-lifecycle` | F-2, F-3, F-10 (get/list_formulas) | SEV-2 | full |
| `087-fix-mcp-additive-tools` | F-10 (test_formula, cancel_backfill, list_strategies, source-health, emit_alert fields) | SEV-2 | quick |
| `088-fix-mcp-signal-source-verbs` | F-6 | SEV-2 | full |
| `089-fix-mcp-strategy-lifecycle` | F-5, F-7 | SEV-2 | full |
| `090-fix-mcp-screener-correctness` | F-4 | SEV-3 | full |
| `091-fix-mcp-config-key-registry` | F-8 | SEV-3 | full |
| `092-fix-mcp-writepath-authz` | F-11 | SEV-2 | full |
| `093-fix-mcp-extract-credentials` | F-1 | SEV-2 | full |
| `094-fix-mcp-server-input-validation` | F-9 (code), F-10 (notify validation) | SEV-3 | quick |

Run `/sdd-status` for live state, or `/sdd-design <slug>` to start any one. Not folded into the
docs PR's code because each is a proto/migration/cross-service change this repo routes through SDD.
