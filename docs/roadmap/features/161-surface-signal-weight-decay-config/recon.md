# Recon: surface-signal-weight-decay-config

**Created**: 2026-08-26
**From**: product-spec.md
**Affected services**: xstockstrat-agent, xstockstrat-ui, xstockstrat-config, xstockstrat-analysis (docs-only)

---

## Objective

Clean up the dead `analysis.signals.source_weights` config key (superseded by feature 134) and fully
surface two live signal-scoring knobs to their consumers: per-source `reliability_weight`
(`ingest.SignalSource`, feature 134) to the MCP agent tools and the config-ui source form, and the
decay half-life `analysis.scoring.signal_decay_half_life_hours` (feature 022) as a registered config
key visible in config-ui. Wherever these are configurable, add brief plain-language guidance. No
change to how either knob is *applied* in analysis scoring.

## Codebase Map

- **`xstockstrat-agent`** (Python)
  - Tool defs: `services/xstockstrat-agent/app/tools.py`
  - `list_signal_sources` tool: `tools.py:217-243` — re-projects each source into `{slug, display_name, source_type, config_json, extractor_tool}` and **drops** `reliability_weight`.
  - `manage_signal_source` tool: `tools.py:890-899` (signature; no `reliability_weight` param); source dict `:916-924`; update mask `:927-934`.
  - Client layer: `services/xstockstrat-agent/app/client.py`
    - `list_signal_sources` projection **already reads** `reliability_weight`: `client.py:195` (`"reliability_weight": src.reliability_weight`, dict `:178-197`).
    - `manage_signal_source` builds `ingest_pb2.SignalSource(...)` **without** `reliability_weight`: `client.py:1004-1010`; response projection omits it `:1033-1040`.
  - Config tools are namespace-generic: `get_config` `tools.py:1156-1181`, `list_config_keys` `:1184-1203`, `set_config` `:1205-1266` — no per-key allow-list; decay key reachable today once registered.
- **`xstockstrat-ui`** (Next.js)
  - Signal Sources page: `services/xstockstrat-ui/src/app/config-ui/sources/page.tsx`
    - Inline weight editor (feature 134): column `:329-366`, `saveWeight` `:185-203` (validates `[0,1]`, uses `updateMask.paths:['reliability_weight']`). Only `aria-label`, **no guidance text**.
    - Create/edit modal `FormState` `:49-77`, `formFromSource` `:146-164`, card `:462-630`, `handleSave` `:235-273` — **no `reliability_weight` field**.
    - Typed client: `src/lib/browserClients/ingestClient.ts`; list hook `src/app/config-ui/hooks/useSignalSources.ts`; mutation hook `.../hooks/useSignalSourceMutations.ts`; BFF `src/lib/configUiBff.ts:46`.
  - Generic config editor: `src/app/config-ui/[namespace]/NamespaceEditor.tsx` — Key/Value/**Description**/Actions table `:129-254`; description rendered `:183-187` from server `ListKeys` meta (hook `hooks/useConfigKeys.ts`). Secret-field help-text pattern (to mirror for guidance): `NamespaceEditor.tsx:160-165` (`<p className="text-muted-foreground text-xs mt-0.5">`).
- **`xstockstrat-config`** (Node)
  - `config.config_values` schema: `migrations/001_config_tables.up.sql:10` — `value_type TEXT CHECK IN ('string','int','float','bool','json')`. **No min/max column.**
  - Current INSERT column layout (post-147): `migrations/017_config_secrets_and_scoping.up.sql:110` — `(namespace,key,value_type,value_data,is_secret,description,default_value,consuming_service,environment,user_id)`, conflict `(namespace,key,environment,COALESCE(user_id,''))`, `environment IN ('staging','production')`.
  - Scalar float precedent: `migrations/012_trading_risk_sizing.up.sql:14` (`value_type='float'`, literal in `value_data`/`default_value`) — **pre-147 columns, adapt.**
  - Dead-key original INSERT (for down-restore): `migrations/003_analysis_signal_source_weights.up.sql:8-11` (`value_type='string'`, `value_data='{}'`); live description reworded by `016_deprecate_...up.sql:9-14` (down restores original wording).
  - `ListKeys` mapping: `src/grpc/configServiceImpl.ts:492-536` — `description←r.description`, `defaultValue←r.default_value`, `validation` emitted **only** when `WEIGHT_KEY_REGISTRY` has the key.
  - `WEIGHT_KEY_REGISTRY`: `src/grpc/configServiceImpl.ts:108-112` — **sole entry** `'analysis.signals.source_weights': {minValue:0.0, maxValue:1.0}`.
  - Last migration: `018_notify_fanout` → next free **019** (then **020** for the second migration).
- **`xstockstrat-analysis`** (Python) — **no code change; docs-only**
  - Reads decay key: `app/handlers/servicer.py:3057-3059` (`get_float_present("analysis.scoring.signal_decay_half_life_hours", 24.0)`; getter `app/config/watcher.py:134-137`).
  - Live in-memory `source_weights` map (feature 134, **NOT the config key**): `_drain_source_weights` `servicer.py:3598-3611`, consumed `servicer.py:2687-2692` (screener) & `:3231` (opportunities); `app/services/scoring.py:11-23`, `app/services/screener.py:84-268`. **Must not be touched.**
  - Config Keys table row for the dead key: `services/xstockstrat-analysis/CLAUDE.md:300`.

## Patterns to REUSE

- Weight `[0,1]` validation + `updateMask.paths:['reliability_weight']` → reuse the inline editor's `saveWeight` logic shape `sources/page.tsx:185-203` for the create/edit form field.
- In-UI guidance text → reuse the secret-field help pattern `NamespaceEditor.tsx:160-165` (`<p className="text-muted-foreground text-xs mt-0.5">…</p>`) and the form label pattern `sources/page.tsx:481`.
- Config seed migration → copy the **017** column layout (post-147), not the pre-147 003/012 shape.
- Config-service descriptor-parity/return-shape contract test → mirror `services/xstockstrat-config/src/__tests__/listKeysWire.test.ts` for the new decay key; for the agent, mirror the `test_backtest_view::test_summary_key_set_covers_every_proto_field` descriptor-parity pattern (insights.md) over the `SignalSource` builder/projection (FR-7).
- config-ui test fixtures → `services/xstockstrat-ui/e2e/fixtures/configKeys.ts` (C-12/C-13 canonical home) — extend/adjust rather than inline.
- Agent tool dict→proto passthrough → the existing `client.py:1004-1010` builder is the site to extend for `reliability_weight`.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-3` "GetConfig and ListKeys redact secrets at the edge" (`services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature`) — surfacing the new non-secret decay key through `ListKeys`/`get_config`/`list_config_keys`/config-ui must not regress secret redaction.
- **PRESERVE** `@AC-2` "WatchConfig never streams secret plaintext" (`services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature`) — analysis reads the decay key off WatchConfig; that stream must keep redacting secret rows.
- **PRESERVE** `@AC-1` "A signal-weighted screen returns results instead of crashing" (`services/xstockstrat-analysis/acceptance/fix-signal-screen-crash.feature`) — removing the dead key must not regress signal-weighted screening, whose weights come from `ListSignalSources.reliability_weight` (`_drain_source_weights`).
- **PRESERVE** `@AC-2` "compute_signal_score reads the bar time from the correct proto field" (`services/xstockstrat-analysis/acceptance/fix-signal-screen-crash.feature`) — the scoring path consuming source weighting/decay must keep returning a valid 0.0–1.0 score after the removal.
- **PRESERVE** `@AC-9` "The config-ui trigger control is admin-gated" (`services/xstockstrat-ui/acceptance/fix-fundamentals-signal-producer.feature`) — the new config-ui reliability_weight/decay editors are config writes and must keep the admin-forwarding BFF gate.
- **No existing `@AC-*`** guards the dead-key removal directly, nor the agent-side `reliability_weight` surfacing (net-new behavior → new scenarios, no CHANGE against a promoted rule). No CHANGE flagged; the `[0,1]` reliability range and the decay math are unchanged (altering either would be a CHANGE needing sign-off).

## Dependencies

- Proto/RPC: **none required** — `ingest.SignalSource.reliability_weight` field 12 already exists (`packages/proto/ingest/v1/ingest.proto:160`). ⚠️ *Enforced scalar bounds for the decay key would require a proto `config.v1.ValueType` enum addition (`config.proto:80-92`) — see Risks / the design fork.*
- Migration: `xstockstrat-config` next free **019** (register decay key) and **020** (delete dead key). Both operate on `config.config_values` rows, not schema.
- Config keys: ADD `analysis.scoring.signal_decay_half_life_hours` (float, default 24.0); REMOVE `analysis.signals.source_weights`.
- Inter-service edges: agent → ingest (`ManageSignalSource`/`ListSignalSources`, already carries field 12); analysis → config (`WatchConfig`, decay key). No new edges.
- New env vars / ports: none.

## Risks / Not-found

- **DESIGN FORK 1 — decay-key bounds vs. no-proto scoping.** The config store has **no numeric-bounds columns**; scalar-float bounds are surfaced to config-ui only via the proto `ValueType` enum (`config.proto:80` — members `UNSPECIFIED`, `FLOAT_MAP` only, **no scalar-float type**) + the hardcoded `WEIGHT_KEY_REGISTRY` (`configServiceImpl.ts:111`). A seed migration alone surfaces the decay key's **description + default** (satisfies the guidance ask) but **cannot enforce min/max**. Enforced bounds ⇒ proto enum addition + config-service code + config-ui scalar-bounds rendering + tests ⇒ contradicts the product-spec's "no proto changes." **Recommendation: guidance-only (description carries 0-disables / typical-24 guidance); analysis already clamps 0/negative safely via `get_float_present`.** Escalate to user at the design gate.
- **DESIGN FORK 2 — dead-key cleanup blast radius.** `analysis.signals.source_weights` is the **sole** `WEIGHT_KEY_REGISTRY` entry and is asserted by config-service tests (`configServiceImpl.test.ts:40`, `listKeysWire.test.ts:40/83/99/108/115`) and UI e2e (`e2e/fixtures/configKeys.ts:84`, `audit.spec.ts:25`, `api-smoke.spec.ts:237`, `value-persists-after-save.spec.ts:16`). Removing the key requires updating/removing those. Open sub-question: after removal the FLOAT_MAP-bounds validation machinery (feature 016) has **no live consumer** — **recommend removing only the dead key's registry entry + its assertions, leaving the generic validation machinery in place** (minimum change; don't gut feature 016). Escalate at the gate.
- **Trap F-6 / RC-1** (`fails.md`): the agent's `SignalSource` dict→proto builder/projection is named for silently dropping proto fields — this feature exists because it dropped `reliability_weight`. FR-7 mandates a descriptor-parity contract test (antidote per insights.md).
- **Trap F-11 / config value_type immutability** (`fails.md`): only ADD (float) and DELETE keys — never retype an existing key in place.
- **Trap migration numbering** (`fails.md`): re-`ls services/xstockstrat-config/migrations/` at spec/execute time before writing 019/020.
- Not-found: no acceptance suite scenario references the dead key (confirmed by scenario-recon) — removal is guarded only indirectly by the analysis scoring scenarios. `xstockstrat-ingest` acceptance suite was not read (producer of field 12); feature 134 already shipped, so no ingest change — flagged only for completeness.

## Recommended Scope

Advisory step boundaries (input to grilling / `/sdd-spec`):
1. **Agent — surface `reliability_weight`**: `list_signal_sources` projection + docstring; `manage_signal_source` param + `client.py` builder/passthrough/return + update-mask; docstrings. (FR-1, FR-2)
2. **Agent — descriptor-parity contract test** over the `SignalSource` builder/projection. (FR-7)
3. **UI — `reliability_weight` on create/edit form + guidance text** on both the form field and the inline editor. (FR-3, FR-4)
4. **Config — register decay key** (migration 019) with guidance description + default 24.0; **guidance-only** unless the gate chooses enforced bounds. (FR-5)
5. **Config — remove dead key** (migration 020) + `WEIGHT_KEY_REGISTRY` entry + config-service tests + UI e2e fixtures/specs. (FR-6)
6. **Docs** — analysis `CLAUDE.md:300`, `config-governance.md:320`, config-governance Per-Feature Registered Keys log; `/context-scrubber` scan. (FR-5/FR-6)
