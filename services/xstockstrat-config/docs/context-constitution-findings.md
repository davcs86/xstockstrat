# xstockstrat-config — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24; refreshed 2026-09-02 (branch
`claude/loaded-plugins-list-d120nl` @ `82a0549`); re-verified 2026-10-14 (branch `ccr-fe84109f-0lwin8` @ `09ec8d9`); refreshed 2026-10-19 (branch `ccr-c386317f-6vt6t6` @ `a914f69` — line hints re-stamped; added dead `src/services/configWatcher.ts` and a cross-ref to the root cross-key deadline-bound gap; other findings re-checked still open). For triage/fixing, not
governance. Repeated defects (dead `middleware/propagation.ts`, Node-20 drift) live in the root
findings log.

## Documentation that lies (docs claim behavior the code lacks)

| What the docs say | What the code does | Evidence | Suggested action |
|---|---|---|---|
| Service CLAUDE.md WatchConfig-flow: DELTA = "changed keys only" | Code sends the full namespace with all keys in `changedKeys` (CONFIG-1) | `CLAUDE.md` § WatchConfig Flow (~L71) vs `configServiceImpl.ts#reloadNamespace` (`changedKeys` ~L214) | ✓ **RESOLVED** (2026-08-02 refresh) — CLAUDE.md WatchConfig-flow now states DELTA "carries the FULL namespace … a wholesale replace" |
| Service CLAUDE.md pg_notify payload documented as `{namespace, key}` | Code emits `{namespace, key, environment, user_id}` and depends on env+overlay scope (CONFIG-4) | `CLAUDE.md` § WatchConfig Flow (diagram ~L85) vs `configServiceImpl.ts#pg_notify('config_changed'` (~L509-511) | ◐ **PARTIAL** (2026-08-02 fixed the prose; **the ASCII diagram literal was missed** — 2026-09-02): the service CLAUDE.md **WatchConfig-Flow diagram block** still writes `pg_notify('config_changed', {namespace, key, environment, trading_mode})`, but the code emits `{namespace, key, environment, user_id}` (`configServiceImpl.ts#pg_notify('config_changed'` ~L509-511; `trading_mode` removed by feature 147). Fix the diagram literal `trading_mode` → `user_id` |
| Service `CLAUDE.md` banner still advertises the "pg_notify env+mode requirement" and the "camelCase/snake_case trading-mode scoping collapse" defect; the **Webhooks** section says `SetConfig` "requires the ADMIN scope bit" | Both defects were resolved (features 078/147); the write gate is scope-branched (admin for global, owner-only for per-user, internal-caller allowlist — Critical Invariants #5/#7) | `services/xstockstrat-config/CLAUDE.md` banner and §Webhooks vs `src/grpc/authz.ts` | Update the banner and §Webhooks |

## Latent bugs (looks broken, not merely non-obvious)

| Issue | Impact | Evidence |
|---|---|---|
| **Server reads request fields as snake_case (`req.trading_mode`, `req.client_id`) while the ts-proto client sends camelCase (`tradingMode`, `clientId`).** The same file's encode-side comment states ts-proto uses camelCase. If so, `req.trading_mode` is always `undefined` → `resolveMode(undefined)` → `'all'`, so paper/live-scoped rows never reach subscribers and SetConfig always writes `trading_mode='all'`. Self-consistent (read+write both collapse) which masks it. | Trading-mode config scoping may silently collapse to the `'all'` bucket in production | ✓ **RESOLVED (feature 078, confirmed 2026-08-02; re-grounded 2026-08-27)** — `resolveEnv` accepts the ts-proto string form (`configServiceImpl.ts#resolveEnv` ~L70), covered by the real-wire test `src/__tests__/scopeResolution.test.ts`; enshrined as constitution CONFIG-5. Note: feature 147 later removed the whole `trading_mode` scope axis, so `resolveMode` no longer exists — the string-decode care now applies to `resolveEnv` + `requestUserId` |
| Unit tests hand-build snake_case requests (`{ trading_mode: 1 }`) that don't match the ts-proto wire shape, giving false confidence in the bug above | The scoping bug is untested against the real wire form | ✓ **RESOLVED (feature 078)** — `src/__tests__/scopeResolution.test.ts` drives a real gRPC connection asserting the bound SQL params |
| **Seed-migration numbers are pre-assigned in `merge-order.md`; a late-merging LOWER number never applies on persistent dev/prod DBs** (golang-migrate runs only versions > current). `025` merged before `024`, forcing `024`→`026` (a permanent intentional gap). A future feature that reserves a low number but merges late will silently no-op on already-migrated databases. | A never-applied config seed migration → keys silently absent in prod despite an "applied" branch | `services/xstockstrat-config/migrations/026_analysis_engine_blend_keys.up.sql:13-17`, `025_ingest_mcp_client_keys.up.sql:6-11` (may be covered by the root golang-migrate forward-only rule — reconcile before promoting to a rule) |
| **Audit trigger fires on UPDATE only** — ~~a brand-new key's INSERT path writes no audit row~~ **RESOLVED (feature 091):** migration `010_config_audit_insert_trigger` adds a dedicated `config_value_audit_insert` `AFTER INSERT` trigger so key creation writes one `config_audit` row (author + value, `old_value` NULL). A dedicated `AFTER INSERT` trigger (not a widened `BEFORE INSERT OR UPDATE`) avoids double-firing on the `ON CONFLICT DO UPDATE` path. Creation is also now gated: `SetConfig` refuses an unregistered scope `NOT_FOUND` unless `create_key=true`. | ~~New-key creation is unaudited~~ Resolved | `migrations/010_config_audit_insert_trigger.up.sql`; `configServiceImpl.ts#setConfig` existence gate (~L441-466) |
| **Cross-key deadline bounds are not enforced** — `SCALAR_BOUNDS_REGISTRY` bounds each key alone, so the cross-key invariants its own comments state (e.g. portfolio quote deadline > marketdata cold budget; retention floor > lookback ceiling) are not checked at write time. Tracked as a ROOT finding — see `../../../docs/context-constitution-findings.md` § Latent bugs ("Cross-hop deadline ordering is documented but not enforced by per-key bounds"). (found 2026-10-19) | Cross-ref only | `src/grpc/configServiceImpl.ts#SCALAR_BOUNDS_REGISTRY` (feature 227/229 comments ~L128-139) |

## Dead / orphaned code

| What | Why it is dead | Evidence |
|---|---|---|
| `src/services/configWatcher.ts` — a full `ConfigWatcher` copy (with a stale `waitForSnapshot(timeoutMs = 10_000)` default) in the config service, which never subscribes to itself (CLAUDE.md Critical Invariant #1) (found 2026-10-19) | No runtime module imports it; the only importer is its own test. The live copies are in identity/ledger/notify (`waitForSnapshot` default `90_000`) | `rg -l configWatcher services/xstockstrat-config/src` → only `src/__tests__/configWatcher.test.ts`; `src/services/configWatcher.ts#waitForSnapshot` (~L96) |

## Resolved

| Finding | Resolved | How confirmed |
|---|---|---|
| Root `CLAUDE.md` lists `analysis.scoring.shrinkage_days` / `min_evidence_*` as config keys with no seed | 2026-10-14 | grep of root `CLAUDE.md` for `shrinkage_days` / `min_evidence_symbols` → zero hits; migrations also zero (other docs not re-checked) |
| Dead `src/middleware/propagation.ts` (+ `.eslintrc.json` exemption) | 2026-10-14 | `src/middleware/*` glob empty; `.eslintrc.json` overrides list only `authz.ts`; feature 175 |


## Filed as defect reports (2026-10-19)

The open rows above were re-verified against `1302e6d` and recorded as `docs/reports/` defects
(status sidecar `open`) for `/sdd-triage --from-report`. A row stays here until its report is resolved.

| Report | Title |
|---|---|
| [`2026-10-19-config-audit-author-caller-spoofable-defect`](../../../docs/reports/2026-10-19-config-audit-author-caller-spoofable-defect.md) | SetConfig audit author is caller-supplied free text, not the verified identity |
| [`2026-10-19-config-claude-md-drift-defect`](../../../docs/reports/2026-10-19-config-claude-md-drift-defect.md) | Config CLAUDE.md has a stale notify diagram, banner and write-gate text |
| [`2026-10-19-config-seed-migration-late-lower-nnn-defect`](../../../docs/reports/2026-10-19-config-seed-migration-late-lower-nnn-defect.md) | A late-merging lower-numbered config seed migration never applies |
| [`2026-10-19-cross-hop-deadline-bounds-unenforced-defect`](../../../docs/reports/2026-10-19-cross-hop-deadline-bounds-unenforced-defect.md) | Cross-hop read deadline ordering is not enforced by config bounds |
| [`2026-10-19-orphaned-code-defect`](../../../docs/reports/2026-10-19-orphaned-code-defect.md) | Orphaned modules, scripts and dependencies across services |

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
