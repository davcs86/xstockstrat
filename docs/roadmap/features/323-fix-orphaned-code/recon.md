# Recon: fix-orphaned-code

**Created**: 2026-11-11
**From**: product-spec.md
**Tree**: main-dev@c4fd48b0a ≡ origin/main-dev (detached; `feature/fix-orphaned-code` did not exist on origin at recon start)
**Affected services**: xstockstrat-config, xstockstrat-ledger, xstockstrat-notify, xstockstrat-marketdata, xstockstrat-analysis, xstockstrat-ingest, xstockstrat-agent, xstockstrat-ui, xstockstrat-portfolio

---

## Objective

Remove the orphaned modules, scripts and dependencies from defect report
`docs/reports/2026-10-19-orphaned-code-defect.md`, which have no runtime caller. Also fix the one live
hazard in the list: portfolio repo methods still call `r.pool`, which is nil under
`NewPortfolioRepoWithDB` (pgxmock), so they panic. Item 7 is excluded (the agent `app/config/` package
is live). Item 5 is already resolved. Item 9 (ui `PortfolioPanel` combined branch) turns out to be
**reachable** and covered by a durable acceptance scenario.

## Codebase Map

Recon re-verified every item at the tree stamp above. Status per item:

| # | Item | Verdict at c4fd48b0a |
|---|---|---|
| 1 | config `src/services/configWatcher.ts` | orphan, so delete (with its test) |
| 2 | ledger `migrate` script | orphan, so delete; the same script exists in config, identity and notify (scope fork) |
| 3 | notify `jsonwebtoken`/`bcrypt` (+`@types`) | orphan, so delete |
| 4 | marketdata `alpaca.AlpacaAsset` | orphan, so delete |
| 5 | analysis/ingest `sandbox_*` accessors | **already gone**: no code change |
| 6 | ingest `example_simple_email.py`, `noop.py`, non-MCP input dataclasses | orphan at runtime, so delete |
| 7 | agent `app/config/` | **live, excluded** (AC-3) |
| 8 | agent `app/prompts/signal_extraction.md` | orphan, so delete |
| 9 | ui `PortfolioPanel` combined branch | **reachable**, so keep and document (see Risks) |
| 10 | portfolio `r.pool` stragglers | live bug: swap to `r.db` |

- **`xstockstrat-config`** (Node.js)
  - Orphan class: `ConfigWatcher` — `services/xstockstrat-config/src/services/configWatcher.ts:18`. Its stale default is at `:96` (`async waitForSnapshot(timeoutMs = 10_000)`).
  - Sole consumer is its own test: `services/xstockstrat-config/src/__tests__/configWatcher.test.ts:23,26` (dynamic `import('../services/configWatcher.js')`). No other `src/` importer.
  - `src/services/` also holds `logger.ts`, so the directory survives the deletion.
  - Test harness: `package.json` `test` = `tsc && node --test dist/__tests__/*.test.js`; `test:coverage` uses c8 with `--lines 40`.
  - Wiring-manifest entries: `scripts/config-wiring.json:52-55` (`…/xstockstrat-config/src/services/configWatcher.ts:{getBool,getFloat,getInt,getString}`, each `[]`), in the `"dynamic"` registry (`:46`). Lines `:56`, `:59` and `:73` are the identity, ledger and notify watchers. They are live, so keep them.
  - Docs that name the file: `services/xstockstrat-config/docs/context-constitution.md` (4 hits; the 10s-default claim is at `:50`), `services/xstockstrat-config/docs/context-constitution-findings.md` (3 hits; the `APPLICATION_ENV` row is at `:14`). `services/xstockstrat-config/CLAUDE.md:71` (`└── ConfigWatcher.WaitForSnapshot()`) is a generic client-flow line, not config's own file.
  - Last migration: `047_config_alias_removal_rows.up.sql`. Not needed.
- **`xstockstrat-ledger`** (Node.js)
  - Dead script: `services/xstockstrat-ledger/package.json:11` (`"migrate": "node-pg-migrate up"`). Its devDependency is at `:54` (`"node-pg-migrate": "^7.3.2"`).
  - No caller: no `pnpm migrate`/`npm run migrate` hit in `scripts/`, the ledger and notify Dockerfiles or `.github/workflows/*.yml`.
  - Docker build: `services/xstockstrat-ledger/Dockerfile:13` copies the **root** `pnpm-lock.yaml`, and `:17` runs `pnpm install --frozen-lockfile`.
  - Docs: `services/xstockstrat-ledger/CLAUDE.md:4` (Constitution banner names the dead script) and `:145`; `services/xstockstrat-ledger/docs/context-constitution-findings.md:29`; root `docs/context-constitution-findings.md:57` (the row names all four Node leaves).
  - Ledger's own `src/__tests__/configWatcher.test.ts` tests ledger's live watcher. It is not item 1.
  - Last migration: `003_events_user_id.up.sql`. Not needed.
- **`xstockstrat-notify`** (Node.js)
  - Dead runtime deps: `services/xstockstrat-notify/package.json:35-36` (`jsonwebtoken`, `bcrypt`). Dead types: `:51-52` (`@types/jsonwebtoken`, `@types/bcrypt`). There is no `src/` import.
  - The same dead `migrate` script and devDependency are at `package.json:11,57`.
  - Docker build: `services/xstockstrat-notify/Dockerfile:13` copies the **root** `pnpm-lock.yaml`, and `:17` runs `pnpm install --frozen-lockfile`.
  - Root lock importer block `services/xstockstrat-notify:` is at `pnpm-lock.yaml:373`. It holds `bcrypt` (`:426`), `jsonwebtoken` (`:432`), `@types/bcrypt` (`:448`), `@types/jsonwebtoken` (`:451`) and `node-pg-migrate` (`:481`).
  - Docs: `services/xstockstrat-notify/CLAUDE.md:4` (banner); `services/xstockstrat-notify/docs/context-constitution-findings.md:30,45`.
  - Last migration: `003_alert_reads.up.sql`. Not needed.
- **`xstockstrat-marketdata`** (Go)
  - Orphan type: `services/xstockstrat-marketdata/internal/alpaca/client.go:653-654` (`// AlpacaAsset is kept for backward compatibility.` / `type AlpacaAsset struct {`). It is the last declaration in the file.
  - A repo-wide grep of `.go`/`.ts`/`.py` finds no other reference. The only other hit is `services/xstockstrat-marketdata/docs/context-constitution-findings.md:33`, which cites stale lines ~L560-568.
  - Last migration: `009_symbol_classification.up.sql`. Not needed.
- **`xstockstrat-analysis`** (Python)
  - Item 5 is resolved. The only `sandbox` hits in `services/xstockstrat-analysis/app/**/*.py` are prose comments (`app/services/evaluator.py:151`, `app/services/screener.py:6`, `app/handlers/servicer.py:4618`). There is no `sandbox_*` accessor and no `indicators.sandbox.*` read.
  - The `indicators.sandbox.max_concurrent` seed belongs to indicators alone: `services/xstockstrat-config/migrations/041_heal_config_keys_to_reader_catalog.up.sql:125` (reader `services/xstockstrat-indicators/app/config/watcher.py:sandbox_max_concurrent`). Do not touch it.
- **`xstockstrat-ingest`** (Python)
  - Item 5 is resolved: there is no `sandbox` hit in `services/xstockstrat-ingest/app/**/*.py`.
  - `services/xstockstrat-ingest/app/extractors/` holds `__init__.py`, `base.py`, `example_simple_email.py`, `mcp_client.py` and `noop.py`.
  - Non-MCP dataclasses in `services/xstockstrat-ingest/app/extractors/base.py`:
    - `SimpleEmailInput` (`:10`)
    - `EmailAttachmentInput` (`:16`)
    - `LinkedEmailInput` (`:23`)
    - `SimpleWebsiteInput` (`:30`)
    - `AuthenticatedWebsiteInput` (`:36`)
  - Live types in `base.py`: `McpClientInput` (`:43`), the `RawInput` union (`:51`) and `BaseExtractor` (`:61`). Keep the `RawInput` name, because `mcp_client.py` imports it.
  - Runtime extractor imports (digest 6): `app/engine/mcp_client_loop.py:24-25` (`McpClientInput`, `McpClientExtractor`).
  - No `importlib` anywhere in `services/xstockstrat-ingest/app`. `extractor_module` is a stored and echoed string only. The only `app/` hit for `noop` is the module's own docstring (`noop.py:2`), and no migration contains `noop`.
  - `services/xstockstrat-ingest/tests/test_extractor.py` (150 lines) tests **only** the two orphans:
    - imports at `:13-14`
    - `TestExampleSimpleEmailExtractor` at `:21`
    - `TestNoopExtractor` at `:82`
    - module-level tests at `:124`, `:132` and `:146`
  - `McpClientExtractor` is tested separately in `tests/test_mcp_client_extractor.py`. So the whole of `test_extractor.py` goes with the modules.
  - The string `"app.extractors.noop"` is opaque fixture data, not an import. It appears in `tests/test_signal_ownership.py`, `test_ingest_servicer.py`, `test_source_templates.py`, `test_signal_sources.py` and `test_source_health.py`. It also appears in `scripts/migration-assertions/fixtures-pre-224.sql:20-22` and the ui e2e fixtures (digest 5).
  - Docs: `services/xstockstrat-ingest/docs/context-constitution-findings.md:24`, which records that `extractor_module` is never resolved.
  - Last migration: `014_contract_signal_ownership.up.sql`. Not needed.
- **`xstockstrat-agent`** (Python)
  - Item 7 is live. `services/xstockstrat-agent/app/config/` holds `__init__.py`, `watch_core.py` and `watcher.py`.
  - `watcher.py:13` imports `watch_core`.
  - Importers of `app.config.watcher` (digest 7): `app/main.py:88,240`, `app/client.py:1124`, `app/tools.py:77` and `app/oauth_server.py:28`.
  - Item 8 is orphaned. `services/xstockstrat-agent/app/prompts/` holds `__init__.py`, `list_correlation.md` and `signal_extraction.md`.
  - A grep for `signal_extraction` over agent `.py`/`.md`/`.toml` hits only `services/xstockstrat-agent/docs/context-constitution-findings.md:34`.
  - `list_correlation.md` is live (`app/tools.py:87`, `register_prompts` at `app/tools.py:2590`). Keep it.
- **`xstockstrat-ui`** (Next.js)
  - `services/xstockstrat-ui/src/components/trader/PortfolioPanel.tsx:77-78` (`useAccountContext()` → `usePortfolios(selectedAccountId)`).
  - The single-account branch starts at `:85`. The combined branch follows: "No portfolios available" at `:161` and the "All accounts" card at `:176`.
  - Auto-select picks only an **active** account: `services/xstockstrat-ui/src/context/AccountContext.tsx:43-44` (`fetched.find((a) => a.isActive)` → `?? null`). A failure of `listBrokerAccounts` is swallowed at `:46-48`.
  - So with no active account, the combined branch renders. The e2e spec exercises it: `services/xstockstrat-ui/e2e/trader/offline-pnl.spec.ts:109-110,119` and `:195-196,205`, both accounts `isActive: false`, asserting the "All accounts" card.
- **`xstockstrat-portfolio`** (Go)
  - `queryRower` (`QueryRow`/`Query`/`Exec`) is at `services/xstockstrat-portfolio/internal/repository/portfolio_repo.go:22-26`. The struct `PortfolioRepo{pool; db}` is at `:29-34`.
  - Constructors: the production one sets both handles (`:45`). `NewPortfolioRepoWithDB` (`:49-51`) sets only `db`.
  - `Pool()` (`:55-56`) must keep returning `r.pool`, because sibling repos reuse it.
  - The three `r.pool` call sites are:
    - `GetSnapshot` (`:211`), with the call at `:217`
    - `CountPositions` (`:238`), with the call at `:241`
    - `UpdatePositionBracket` (`:340`), with the call at `:341`
  - There is no repository-level test of these three methods. The only `GetSnapshot` tests are service-level ownership tests (`internal/service/portfolio_ownership_test.go:15`).
  - Last migration: `018_watchlist_signal_expiry.up.sql`. Not needed.

## Patterns to REUSE

- AC-1 `GetSnapshot` pgxmock test → reuse the `pgxmock.NewPool()` → `NewPortfolioRepoWithDB(mock)` → `ExpectQuery` → `ExpectationsWereMet()` shape in `services/xstockstrat-portfolio/internal/repository/portfolio_repo_test.go:49-87` (`TestGetPosition_ScopesToRequestedAccount`). Put the new test in the same file.
- The `r.pool` → `r.db` swap needs no interface change. `queryRower` already exposes `QueryRow` and `Exec` (`portfolio_repo.go:22-26`). This is the mockable-`db` pattern recorded in insights.md:1961.
- Pure-deletion AC-2 discharge → reuse the feature-175 pattern (insights.md:2935-2957). It has two parts:
  - a construct-scoped presence check (`git ls-files` / `grep` empty) as a named step
  - each service's **real** compile gate (`pnpm build`/`tsc` for the Node leaves, `GOWORK=off go build ./... && go vet` for Go, `uv run pytest` for Python, `next build` for ui)
  - It is not a permanent CI guard.
- Lockfile → regenerate the **root** `pnpm-lock.yaml` with `pnpm install` at the repo root. The leaf Dockerfiles copy the root lock (ledger/notify `Dockerfile:13`). Per-service `pnpm-lock.yaml` files exist but are not the build input (insights.md:2952-2953).
- Wiring check → after removing `scripts/config-wiring.json:52-55`, verify with `node scripts/check-config-wiring.mjs --final` (CI step `.github/workflows/ci.yml:1050`).

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-30` "The combined PortfolioPanel sums each account's own figures" (`services/xstockstrat-ui/acceptance/offline-account-full-pnl.feature:32-33`, `@FR-6 @feature-240`). This is the item-9 branch, and it is reachable. Deleting the branch would turn this into a **CHANGE**, which needs explicit user sign-off in `context.md` (C-16). Recon recommends keep-and-document, which keeps it PRESERVE.
- **PRESERVE** `@AC-14` (`services/xstockstrat-ui/acceptance/offline-account-full-pnl.feature:11`, `@feature-240`): the single-account PortfolioPanel path.
- **PRESERVE** `@AC-1` "A stored zero is honoured by the Python config getters" and `@AC-4` "An unset or mismatched value still resolves to the coded default" (`docs/sdd/business-rules/platform.feature`, `@feature-244`). Item 5 needs no edit, so the watchers are not touched.
- **PRESERVE** `@AC-5` (reconnect after a non-gRPC exception) and `@AC-8` (an unexpected watch-task exit is retained and logged) (`docs/sdd/business-rules/platform.feature`, `@feature-259`).
- **PRESERVE** `@AC-1` (`services/xstockstrat-analysis/acceptance/fix-config-watcher-client-id.feature`) and `@AC-2` (`services/xstockstrat-ingest/acceptance/fix-config-watcher-client-id.feature`) (`@feature-174`): the watcher client ids.
- **PRESERVE** `@AC-1`..`@AC-3` (`services/xstockstrat-ingest/acceptance/fix-python-config-zero-trap.feature`, `@feature-173`): the present-aware accessors. Scenario bodies were not read.
- **PRESERVE** `@AC-12` "Ledger logs the relative key as read evidence" (`services/xstockstrat-ledger/acceptance/config-keys-relative-consumers.feature`, `@feature-304`). This is ledger's own `configWatcher.ts`/test, which must not be touched by item 1.
- **PRESERVE** `@AC-2` (dead propagation middleware gone), `@AC-3` (Node leaf `@types/node` ^24 typechecks) (`@feature-175`) and `@AC-4` (the ledger/identity `test:coverage` 40% gate, `@feature-252`), all in `docs/sdd/business-rules/platform.feature`. The `package.json` edits must keep `build` and `test:coverage` green.
- **PRESERVE** `@AC-1` "The dead getEnvBool is gone from the Go config packages" (`docs/sdd/business-rules/platform.feature`, `@feature-175`). This is a precedent, and marketdata and portfolio must still compile and lint.
- **PRESERVE** `@AC-4` (`services/xstockstrat-ui/acceptance/fix-dead-code-cleanup-batch.feature`, `@feature-175`): `next build` stays green if item 9 adds a comment.
- No existing acceptance suite covers items 3, 4, 6, 8 or 10. The feature's own `@AC-1`..`@AC-3` are the only guards, and `@AC-1` should promote at launch (C-16).
- Watch-only, not read in full:
  - `services/xstockstrat-portfolio/acceptance/fix-portfolio-snapshot-surface.feature` (`@feature-264`, snapshot owner isolation). The handle swap must not change the `GetSnapshot` query semantics.
  - The agent `fix-config-keys-drift.feature`.
- The C-16 sweep was partial: grep-driven over all nine services' suites. Suites using none of the grepped terms are a residual blind spot.

## Dependencies

- Proto/RPC: none.
- Migration: none.
- Config keys: none added or retired. Removing `scripts/config-wiring.json:52-55` drops registry entries for a deleted dynamic-read site, not keys.
- Inter-service edges: none changed.
- New env vars / ports: none.
- Lockfile: root `pnpm-lock.yaml` (notify importer `:373`; plus ledger importer `:264` and the other leaves if the `node-pg-migrate` scope widens). It is regenerated, never hand-edited.

## Risks / Not-found

- **Item 9 is not unreachable.** The product spec's premise ("`AccountContext` auto-selects") is false when no account is `isActive`, or when the account fetch fails (`AccountContext.tsx:43-48`). Live e2e (`offline-pnl.spec.ts:107-121,195-205`) and the durable `@AC-30` cover the branch. Recommend resolving Open Question 1 as **document, don't delete**: a ≤2-line constraint comment at `PortfolioPanel.tsx:85` stating when the combined view renders. Deletion is a C-16 CHANGE that needs user sign-off.
- **Item 2 scope fork.** The identical dead `"migrate": "node-pg-migrate up"` script and devDependency also live in `services/xstockstrat-config/package.json:11,50`, `services/xstockstrat-identity/package.json:11,55` and `services/xstockstrat-notify/package.json:11,57`. The root defect-log row (`docs/context-constitution-findings.md:57`) already names all four. Note that identity is **not** an affected service in the product spec. Widening scope needs a design decision, and possibly a product-spec amendment to add identity.
- **Lockfile trap (corrects digest 3).** The notify and ledger images build from the **root** `pnpm-lock.yaml` with `--frozen-lockfile` (`Dockerfile:13,17`), not the per-service locks. Editing only `services/xstockstrat-notify/pnpm-lock.yaml` would leave the image build broken or stale.
- **Reverse-dependency check before claiming removal** (fails.md:2388-2390). `jsonwebtoken`/`bcrypt` are still direct deps of identity (`services/xstockstrat-identity/package.json:34-35,48-49`), so their package entries stay in the root lock. Only the notify importer lines go. Run `pnpm why bcrypt jsonwebtoken node-pg-migrate` per importer before asserting what disappears. If the `node-pg-migrate` scope stays ledger-only, its package entry stays too.
- **config-wiring.json entries.** The ratchet's `STALE` check (`scripts/check-config-wiring.mjs:709`) applies to `findings` entries. The `"dynamic"` registry (`:510-519`) is a lookup only, and from the code read an unused registry key does not appear to fail. Remove `:52-55` for hygiene anyway, and confirm with `--final`. Do not touch `:56,59,73`.
- **Findings-doc rows go stale on deletion.** A stale finding can mislead future scoping (fails.md:2247-2250), so include each row in the step that deletes its subject:
  - config `context-constitution*.md`
  - ledger `CLAUDE.md:4` and `docs/context-constitution-findings.md:29`
  - notify `CLAUDE.md:4` and `docs/context-constitution-findings.md:30,45`
  - marketdata `docs/context-constitution-findings.md:33`
  - ingest `docs/context-constitution-findings.md:24`
  - agent `docs/context-constitution-findings.md:34`
  - root `docs/context-constitution-findings.md:57`
- **The config `APPLICATION_ENV` finding** (`services/xstockstrat-config/docs/context-constitution-findings.md:14`) says only `telemetry.ts` and the dead `configWatcher.ts` read it. After deletion, `CLAUDE.md:131`'s "default environment scope" wording becomes doubly wrong. Decide at design whether to fix the wording (docs-only, in scope as an orphan's teardown) or leave the finding open.
- **The "dedicated test" may be shared** (insights.md:2937-2940). Verified: `services/xstockstrat-ingest/tests/test_extractor.py` contains only orphan tests (whole-file delete is safe). `services/xstockstrat-config/src/__tests__/configWatcher.test.ts` imports only the orphan.
- **`"app.extractors.noop"` fixture strings** stay valid as opaque `extractor_module` column values. Renaming them is out of scope (scope creep).
- **AC-2 has no build-RED.** A pre-deletion tree is green. The honest RED→GREEN is a construct-scoped presence check per item (insights.md:2941-2944).
- **AC-1 RED.** Under pgxmock, the current `GetSnapshot` panics on nil `r.pool` (`portfolio_repo.go:217`). The new test is RED before the swap and GREEN after. Pair it with `CountPositions` and `UpdatePositionBracket` cases so that all three swaps are pinned. pgxmock proves the handle and the SQL shape, not the live SQL semantics (insights.md:1963).
- **Peer overlap in this batch** (from the sdd-review overlap scan, in `context.md`): sequence merges or expect trivial rebases.
  - `configWatcher.ts` and `alpaca/client.go` with 322 `fix-retired-surface-proto-cleanup`
  - `portfolio_repo.go` with 311 `fix-position-fold-correctness`
  - ledger/notify `package.json` with 324 `fix-ci-enforcement-gaps`
- Not found:
  - Any runtime caller of any item 1–4, 6 or 8 subject.
  - Any `sandbox_*` accessor in analysis/ingest (item 5).
  - A repository-level test of the three `r.pool` methods.
  - A recon of the notify and ledger Docker build itself (not run, read-only).
  - The enumeration of `Pool()` callers beyond the `WatchlistRepo` comment (`portfolio_repo.go:53-54`).

## Recommended Scope

Advisory step boundaries:

1. **portfolio:** swap `r.pool` → `r.db` at `portfolio_repo.go:217,241,341`, plus pgxmock tests for `GetSnapshot`, `CountPositions` and `UpdatePositionBracket` (`Covers: AC-1`). Gate: `GOWORK=off go test ./... && golangci-lint`.
2. **config:** delete `src/services/configWatcher.ts` and `src/__tests__/configWatcher.test.ts`, remove `scripts/config-wiring.json:52-55`, and retire the config `context-constitution*.md` rows. Gate: `pnpm build && pnpm test` plus `check-config-wiring.mjs --final`.
3. **Node package hygiene:**
   - Remove notify's `jsonwebtoken`/`bcrypt`/`@types/*`.
   - Remove the `migrate` script and the `node-pg-migrate` devDependency from ledger (and from config, identity and notify if design widens the scope).
   - Regenerate the **root** `pnpm-lock.yaml`.
   - Retire the banner and findings rows.
   - Gates: `pnpm install --frozen-lockfile` at the root, `pnpm build && pnpm test:coverage` per touched leaf, and `docker compose build ledger notify`.
4. **marketdata:** delete `AlpacaAsset` (`client.go:652-661`) and resolve findings row `:33`. Gate: `GOWORK=off go build ./... && go vet ./...`.
5. **ingest:** delete `example_simple_email.py`, `noop.py` and `tests/test_extractor.py`, trim the five dataclasses and narrow `RawInput` to `McpClientInput`, then update findings row `:24`. Gate: `uv run pytest --cov=app --cov-fail-under=40` plus `ruff`.
6. **agent:** delete `app/prompts/signal_extraction.md` and resolve findings row `:34`. Gate: `uv run pytest` (includes `tests/test_config_watcher.py`, `Covers: AC-3`).
7. **ui (item 9):** add a ≤2-line constraint comment at `PortfolioPanel.tsx:85` naming when the combined view renders (no active account, or a failed fetch). No behavior change, and `@AC-30` is preserved. Gate: `next build` plus `offline-pnl.spec.ts`.
8. **AC-2 discharge:** a construct-scoped presence check (each deleted path is absent from `git ls-files`, and `grep` for `AlpacaAsset`, `node-pg-migrate` and `jsonwebtoken` in the notify manifest returns nothing) as a named verification step. Item 5 is recorded as no-op with its grep evidence.
