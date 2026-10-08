# Product Spec: private-by-default-templates

**Created**: 2026-10-06

---

## Problem Statement

Visibility today is inconsistent and leaky. Formulas carry an `is_public` flag that exposes their source
to every user. Signal sources and ingested signals have no owner at all, so one user's signal feed drives
every user's live strategies, opportunities and attribution. analysis can run any user's private formula
through an internal-caller bypass (the residual left by PR #1219). Users also have no supported way to
start from curated, vetted building blocks: the only "templates" are UI-only formula starters that are
never persisted.

## User Story

As a platform owner, I want every user-authored object to be private to its owner, with the concept of
"public" removed entirely, and an admin-curated catalog of templates that users instantiate into
independent private copies. That way no user can read, execute or be influenced by another user's
strategies, formulas or signals, and users still get vetted starting points.

## Functional Requirements

FR-1. **No public concept.** `is_public` is removed from every behavior. A formula is readable,
executable, listable, updatable and deletable only by its author. The single exception is
`SYSTEM_AUTHOR` (`"system"`) formulas, which stay readable by all users and immutable, exactly as today
(operator decision 3). The `is_public` / `include_public` proto fields are deprecated, never deleted,
and their values are ignored. `ListFormulas` returns only the caller's own formulas (plus system
formulas), whatever `author_filter` says. The one further read exception is the audited, read-only admin
view in FR-13.

FR-2. **Formula author identity is the header.** `RegisterFormula` stamps `author` from `x-user-id` only.
A body `author` is ignored, and the header always wins. That stays non-breaking for callers that send their own id. This closes debt D-30, where a body
author could register as another user or as `"system"`.

FR-3. **Owner-scoped formula execution in analysis.** analysis calls indicators as the strategy owner
(`x-user-id` = strategy owner) for evaluation, warmup, screening and backtests. The
`x-internal-caller: analysis` formula-read bypass (`_INTERNAL_FORMULA_READERS`, analysis
`app/internal_caller.py`) is removed. A strategy whose component references a formula its owner cannot
read fails that component visibly: a strategy warning on write, and the component skipped at
evaluation. It never silently runs someone else's formula. The fundamentals loop runs the system scoring
formula, which stays readable (FR-1 exception).

FR-4. **Signal sources are owned.** Every signal source has an owner (`user_id`). `ManageSignalSource`
create/update/delete is allowed for the owner and is no longer admin-only. `ListSignalSources` returns
only the caller's sources. Slugs are unique per owner, not globally.
`ListSignalSources` and `QuerySignals` also return `system`-owned sources and signals, flagged read-only
(FR-6 exception). **System slugs are reserved:** no user may register a slug that a `system` source
holds. The mcp_client bearer credential for a user's source is stored as a per-user config secret
(FR-14).

FR-5. **Ingested signals are owned.** Every ingested signal row carries the owner of the source it was
ingested into. `IngestSignal` stamps the owner from the caller (`x-user-id`) and accepts only sources
the caller owns. Dedup keys are per owner, so two users ingesting the same newsletter item each keep
their own row. `QuerySignals` returns only the caller's signals.

FR-6. **Signal consumers are owner-scoped.** In analysis, the live loop's `signal_eligible` path,
`ListOpportunities` signal provenance, attribution (`GetAttribution` `source_id`) and the screener's
`signal_sources` filter consume only the signals owned by the strategy/request owner.

The only exception is signals owned by the reserved `system` owner. The fundamentals signal producer
(analysis `fundsignal_loop`) emits under a `system`-owned source, and every user's signal-eligible
strategies, opportunities and screener may consume it. This is the same special case `SYSTEM_AUTHOR`
formulas already get (OQ-2).
- `system`-owned sources and signals are immutable through user RPCs.
- Only a caller presenting the `x-internal-caller: analysis-fundsignal` grant may write as `system`. A
  user-supplied `x-user-id: system` is rejected.
- `system` is recorded as an ingest ownership convention (C-10(c), ledger 2026-07-01/063).

FR-7. **Template catalog.** Templates exist for three kinds: strategy, formula and signal source.
- A template has a stable id, a kind, a name, a description, a payload and a monotonically increasing
  `version`.
- All authenticated users can list and read templates.
- Only admins (`x-access-scope` ADMIN bit) can create, update or retire templates. An update bumps
  `version`.
- Retiring a template hides it from the catalog. Existing instances are unaffected.
- The catalog starts **empty**. No migration seeds templates (operator decision 3).

FR-8. **Instantiation is a snapshot copy.** Instantiating a template creates an independent private
object owned by the caller. The instance records `origin_template_id` and `origin_template_version`.
Later template updates never mutate instances. Every read **and list** path that returns an
instance exposes its origin and whether the template's current version is newer (an "update available"
indicator only). For formulas that is `GetFormula` and `ListFormulas`; for strategies, `GetStrategy`, `ListStrategies` and
`ListStrategyDefinitions`; for signal sources, `ListSignalSources`. C-10(b) parity.

FR-9. **Strategy templates deep-copy their formulas.** Instantiating a strategy template:
- copies every formula template the strategy's components reference into the caller's private formulas,
  each recording its own origin;
- repoints the new strategy's components at those copies;
- runs atomically: if any copy fails, no partial strategy or orphan formulas remain visible to the user;
- creates the strategy inactive and not live.

Strategy templates reference formula **templates** by template id, never live formula ids (promoted
from OQ-5). Instantiation accepts an optional caller-chosen `strategy_id`. If none is given, the template's
id is used. If that collides with one the caller already owns, the server assigns `<id>_2`, `<id>_3`, …
using the first free suffix. A caller-supplied id that collides fails with `ALREADY_EXISTS`.

FR-10. **Strategy-id-keyed state is owner-scoped.** Tables keyed by bare `strategy_id` gain an owner
dimension, so two users holding the same `strategy_id` (for example from one template) never read or
overwrite each other's state: `analysis.strategy_scores`, `backtest_run_symbols`, `backtest_details`, and
the in-memory `self._strategies` map. `GetBacktest` enforces ownership.

FR-11. **Existing data migrates to private.**
- Every formula currently `is_public=true` stays with its author and becomes private.
- Existing signal sources, signals and dedup keys are backfilled to the `SEED_USER_ID` owner, mirroring
  feature 133 (OQ-1). Sources the fundamentals producer writes to are backfilled to `system` instead
  (OQ-2).
- System objects stay special-cased exactly as today: `SYSTEM_AUTHOR` formulas, and the
  `analysis.engine.fundamentals_blend_strategy_id` id-convention match.
- No data is deleted.

FR-12. **Consumer surfaces reflect the model.** These are in-scope deliverables, not follow-ups:
- the UI removes every public toggle, badge and filter, and adds the template catalog, "use template"
  and admin template authoring;
- the agent's MCP tools drop `is_public` / `include_public` and gain template list/instantiate tools;
- the strat-lab `backtest` skill is updated in the same PR as any `manage_strategy` change (root
  CLAUDE.md rule).

FR-13. **Admins get a read-only view, nothing more** (OQ-3). With the ADMIN bit, an admin can read
another user's formulas, strategies, signal sources and signals for support and audit, through the
existing read RPCs.
- Get RPCs work by id.
- List RPCs (`ListFormulas`, `ListSignalSources`, `QuerySignals`, strategy list) honour an owner selector
  only when the caller has the ADMIN bit. For anyone else the selector is ignored and FR-1/FR-4/FR-5
  apply.
- Every admin read of a non-owned object emits a `audit.admin_read` ledger event (stream key
  `user:<owner>`) carrying the admin id, object kind and object id. indicators gains a ledger client for
  this.
- The existing admin signal-source page under `/config-ui` becomes this read-only view. Admins can no
longer create, update, delete, execute or instantiate on behalf of another user. This removes today's
admin override on `UpdateFormula`/`DeleteFormula`. Admin template authoring (FR-7) is unaffected. Admins
cannot mutate `system` objects either; existing guards stay.

FR-14. **Per-user secrets** (operator decision 2026-10-06; overrides feature 147's global-only rule).
Config secrets may be scoped to a `user_id`:
- An mcp_client source's bearer is written as the owner's secret.
- `GetSecret` resolves it for the allow-listed ingest caller on behalf of the source owner.
- No read or broadcast edge (`WatchConfig`/`GetConfig`/`ListKeys`/config-ui/agent) ever returns
  plaintext, to any user including the owner.
- Existing global mcp credentials keep resolving for the seed owner's migrated sources.

## Out of Scope

- User-published templates or any user-to-user sharing (operator decision 2: admin catalog only).
- Linked or auto-updating instances (operator decision 2: snapshot only).
- Templates for watchlists, screener presets, backtests or config.
- Seeding an initial template catalog. A separate content task, if wanted.
- Converting today's public formulas into templates (operator decision 3: "just make everything private").
- Portfolio exactly-once / multi-instance consumption (PR #1219 discussion item 2, tracked separately).
- Deleting deprecated proto fields (a later breaking-change cleanup after all callers migrate).

## Affected Services

- `xstockstrat-indicators` — formula owner-only reads, executes and lists; header-only author; deprecated
  `is_public`; formula templates and instantiation; removal of the internal-caller read bypass.
- `xstockstrat-analysis` — owner-scoped indicators calls (drops the interceptor); strategy templates and
  deep-copy instantiation; owner dimension on strategy-id-keyed tables; owner-scoped signal consumption
  in the live loop, opportunities, attribution and screener; `GetBacktest` ownership.
- `xstockstrat-ingest` — owner on signal sources, signals and dedup keys; owner-scoped `IngestSignal`,
  `QuerySignals`, `ListSignalSources` and `ManageSignalSource`; signal-source templates and
  instantiation; any MCP-client/scheduled source pollers ingest as the source's owner.
- `xstockstrat-agent` — MCP tool contract changes (formula, signal-source, strategy tools; new template
  tools); `docs/runbooks/mcp-tools.md` parity.
- `xstockstrat-ui` — `/insights` formulas, strategies and signal-source surfaces; `/config-ui` admin
  template authoring; removal of public UI.
- `xstockstrat-ledger` — receives the new `audit.admin_read` events (FR-13); no ledger code change expected.
  indicators gains a new indicators→ledger client in code. `LEDGER_ENDPOINT` is **already wired** for
  indicators (`docker-compose.yml:311`, `.do/app.yaml:214`, `.do/app.dev.yaml:214`), so no deploy-file
  change is needed.
- `packages/proto` — indicators, analysis and ingest contract changes.
- `xstockstrat-config` — **in scope (operator decision 2026-10-06).** Per-user secrets: `is_secret` rows may
  carry a `user_id`, which overrides feature 147's global-only secret invariant. This covers `SetConfig`
  per-user secret writes, owner-scoped `GetSecret` resolution for the ingest mcp poller, and redaction
  that holds per user on `WatchConfig`/`GetConfig`/`ListKeys`. `analysis.fundsignal.scoring_formula_id`
  and `analysis.engine.fundamentals_blend_strategy_id` keep their current meaning. The config-team
  approval gate applies.

## Consumer Surface(s)

- [x] **UI** — `xstockstrat-ui`:
  - `/insights`
    - formulas library: drop the Public/Private filter, badge and checkbox; show the caller's own and
      system formulas;
    - new **Templates** catalog (formula, strategy, signal source) with a "Use template" action that
      instantiates and navigates to the new private object, plus an "update available" indicator on
      instances;
    - strategy wizard: start from a template;
    - signal sources: a per-user management page, which today is admin-only under `/config-ui`.
  - `/config-ui`: admin template authoring (create, edit, retire).
  - All new routes registered in `PLATFORM_SUBNAV` (C-10). New nav entries:
    - `/insights/templates` (catalog)
    - `/insights/signal-sources` (per-user management)
    - `/config-ui/templates` (admin authoring)
    - `/config-ui` signal-sources page, which becomes the admin read-only view (FR-13)
- [x] **Agent** — `xstockstrat-agent` MCP tools:
  - `manage_formula` and `list_formulas` (drop `is_public` / `include_public`);
  - `get_formula` (no `isPublic`);
  - `manage_signal_source` (per-user, not admin);
  - `list_signal_sources` and `ingest_signal` (owner-scoped);
  - new `list_templates` and `instantiate_template`;
  - `manage_strategy` / strat-lab `backtest` skill (doc parity).
- [ ] **None**

## Proto Contract Changes

- **indicators.proto**
  - Deprecate (never delete): `FormulaDefinition.is_public`=8, `RegisterFormulaRequest.is_public`=4,
    `ListFormulasRequest.include_public`=2, `UpdateFormulaRequest.is_public`=6.
  - Deprecate `RegisterFormulaRequest.author`=6, which is ignored because the author comes from the
    header.
  - Add origin fields to `FormulaDefinition` (`origin_template_id`, `origin_template_version`).
- **ingest.proto**: add `user_id` (server-stamped) to `SignalSource` and `ExternalSignal`; add origin
  fields to `SignalSource`.
- **analysis.proto**: add origin fields to `StrategyDefinition` at field numbers **16+**. Field 15 is
  pre-assigned to feature 217's `sector_param_overrides`; see merge-order.
- `Template.kind` is an enum with `TEMPLATE_KIND_UNSPECIFIED = 0`, `_STRATEGY`, `_FORMULA` and
  `_SIGNAL_SOURCE` (C-04).
- **Template messages and RPCs**: `Template`, `ListTemplates`, `GetTemplate`, `ManageTemplate` (admin)
  and `InstantiateTemplate`. Placement (a per-service RPC set on indicators, analysis and ingest, or a
  single owning service) is a design decision for `/sdd-design`.
- All changes are additive or deprecations, so non-breaking under `buf breaking`. Behavior changes for
  callers that relied on public visibility are governed as **semantically breaking** (see Workflow
  Notes).

## Config Key Changes

- [x] No new config keys planned. `analysis.fundsignal.scoring_formula_id` and
  `analysis.engine.fundamentals_blend_strategy_id` keep their current semantics (system special-cases).

## Database Changes

- **indicators**: migration making all existing formulas effectively private. `is_public` is retained
  but unread, or dropped in a later cleanup; drop the `is_public` partial index. Add origin columns and a
  formula template table, unless templates live in another service (design).
- **ingest**:
  - add `user_id` to `signal_sources`, `newsletter_signals` and `signal_dedup_keys`;
  - change the `signal_sources` PK/unique from `slug` to `(user_id, slug)`;
  - change the dedup PK to `(user_id, source, symbol, direction)`;
  - backfill existing rows to the owner chosen in Open Questions;
  - add origin columns and a source-template table (design).
- **analysis**:
  - add `user_id` to `strategy_scores`, `backtest_run_symbols` and `backtest_details`, with backfills
    from the owning strategy or run;
  - add origin columns to `strategies`;
  - add a strategy-template table (design).
- **Migration strategy** (C-07):
  - **Numbering:** next free per service as of 2026-10-06 is indicators `007`, ingest `013` and analysis
    `026`. Re-derive across all remote branches at `/sdd-spec` (ledger 2026-08-06
    fundamentals-signal-producer).
  - **Pairs:** every change ships as an `.up.sql` + `.down.sql` pair.
  - **Run order inside each owner-column migration:**
    1. Add the column nullable.
    2. Backfill. ingest uses `SEED_USER_ID`, except the fundamentals-producer sources, which go to
       `system`. analysis takes `user_id` from `strategies` (migration 013) or `backtest_runs` (015) by
       joining on `strategy_id` / `backtest_id`.
    3. `SET NOT NULL`.
    4. Swap the PK or unique constraint. ingest `signal_sources` moves to `(user_id, slug)`; the dedup key
       moves to `(user_id, source, symbol, direction)`.
  - **Cross-service order:** none required. Each service's migration is self-contained, and analysis
    backfills only from its own tables.
  - **Deploy order:** migrations ship before the code that relies on the new columns, which
    `scripts/db-migrate.sh` already guarantees by running in the pre-deploy job.
  - **Lossy down-migrations:** the ingest PK swaps and owner-column drops are refused rather than run
    lossily. Each such `.down.sql` raises an exception if any `(slug)` or `(source, symbol, direction)`
    group has more than one owner. If none does, the down migration restores the old PK and drops the
    column. After cutover, rollback is a forward fix, and this is documented as such.
  - **`SEED_USER_ID`:** wired at all three run sites with a concrete local default (ledger 2026-08-19
    strategy-user-ownership/config).

## Feature Workflow Notes

Branch to create: `feature/private-by-default-templates` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change), for each affected service
- [x] 2 service owners + platform lead: the proto diff is additive, but the **visibility semantics are
  breaking** for existing consumers (public formulas disappear from other users; global signals become
  per-user). Escalated deliberately.
- [x] DBA review + service owner (schema migrations in indicators, ingest and analysis)

**Hard dependency:** PR #1219 (branch `ccr-5a32dbd3-cmvj83`) must merge to `main-dev` first. FR-1 and FR-3
remove the `_INTERNAL_FORMULA_READERS` bypass and analysis `app/internal_caller.py` that #1219 adds. If
#1219 does not land, FR-1 and FR-3 expand to adding the owner checks on `GetFormula`/`ExecuteFormula`
from scratch. Feature 217 merges before 224 (`StrategyDefinition` field 15, plus shared
`ManageStrategy`, evaluator, `StrategyWizard` and agent tool-count surfaces).

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`), the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [x] **OQ-1 Backfill owner for today's global signal data:** resolved 2026-10-06. Backfill to
  `SEED_USER_ID`, mirroring feature 133 (FR-11). Known trap (ledger 2026-08-19 strategy-user-ownership/config):
  the env var must be wired at all three run sites with a concrete local default.
- [x] **OQ-2 Fundamentals signal producer:** resolved 2026-10-06. It emits under a `system`-owned source
  that is readable by all users and immutable (FR-6).
- [x] **OQ-3 Admin reach:** resolved 2026-10-06. Admins get a read-only, audited view and no mutation of
  other users' objects (FR-13).
- [x] **OQ-4 Template placement:** **deferred to /sdd-design** (architecture decision). FR-9's atomicity
  requirement holds whichever option is chosen; the design must show how. Original text: Templates could live in each owning service (indicators, analysis,
  ingest) or in one catalog service with typed payloads. Cross-service atomicity of the FR-9 deep copy
  differs by option (saga/compensation versus a single DB). Design decision for `/sdd-design`.
- [x] **OQ-5 Strategy-template formula references:** **resolved** by promotion into FR-9 (template-id
  references). Original text: Inside a strategy template payload, components
  must reference formula **templates** (by template id), not live formula ids, or deep copy has nothing
  stable to copy. Confirm in design.
- [x] **OQ-6 Inbound signal channels:** **deferred to /sdd-design Phase 0 recon** (an inventory task,
  not a product decision). FR-5's rule already decides it: the owner is the source's owner. Feature 010's
  draft scheduler `ingest_signal` caller is included. Original text: For MCP-client and newsletter/email sources polled by ingest or
  the agent, the owner must be the source's owner, never the poller identity. Inventory every ingest
  entry point in recon.
- **Known traps** (ledger):
  - 2026-07-01/063: a seeded shared resource that another service depends on must be mutation-protected
    (system formula and blend strategy keep their guards).
  - 2026-08-14/133 strategy-user-ownership: every "already handles ownership" claim must be verified by
    a code read; the bare `WHERE strategy_id = $1` writes are exactly the FR-10 surface.
  - 2026-08-05/008 signal-source-registry: enum and variant changes must propagate to every sibling
    artifact (migration CHECK, validators, extractor stubs).
