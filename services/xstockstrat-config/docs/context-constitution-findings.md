# xstockstrat-config — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24; refreshed 2026-09-02 (branch
`claude/loaded-plugins-list-d120nl` @ `82a0549`); re-verified 2026-10-14 (branch `ccr-fe84109f-0lwin8` @ `09ec8d9`). For triage/fixing, not
governance. Repeated defects (dead `middleware/propagation.ts`, Node-20 drift) live in the root
findings log.

## Documentation that lies (docs claim behavior the code lacks)

| What the docs say | What the code does | Evidence | Suggested action |
|---|---|---|---|
| Service CLAUDE.md WatchConfig-flow: DELTA = "changed keys only" | Code sends the full namespace with all keys in `changedKeys` (CONFIG-1) | `CLAUDE.md:47` vs `configServiceImpl.ts:196` | ✓ **RESOLVED** (2026-08-02 refresh) — CLAUDE.md WatchConfig-flow now states DELTA "carries the FULL namespace … a wholesale replace" |
| Service CLAUDE.md pg_notify payload documented as `{namespace, key}` | Code emits `{namespace, key, environment, user_id}` and depends on env+overlay scope (CONFIG-4) | `CLAUDE.md` § WatchConfig Flow vs `configServiceImpl.ts:503-505` | ◐ **PARTIAL** (2026-08-02 fixed the prose; **the ASCII diagram literal was missed** — 2026-09-02): the service CLAUDE.md **WatchConfig-Flow diagram block** still writes `pg_notify('config_changed', {namespace, key, environment, trading_mode})`, but the code emits `{namespace, key, environment, user_id}` (`configServiceImpl.ts:503-504`; `trading_mode` removed by feature 147). Fix the diagram literal `trading_mode` → `user_id` |
| Service `CLAUDE.md` banner still advertises the "pg_notify env+mode requirement" and the "camelCase/snake_case trading-mode scoping collapse" defect; the **Webhooks** section says `SetConfig` "requires the ADMIN scope bit" | Both defects were resolved (features 078/147); the write gate is scope-branched (admin for global, owner-only for per-user, internal-caller allowlist — Critical Invariants #5/#7) | `services/xstockstrat-config/CLAUDE.md` banner and §Webhooks vs `src/grpc/authz.ts` | Update the banner and §Webhooks |

## Latent bugs (looks broken, not merely non-obvious)

| Issue | Impact | Evidence |
|---|---|---|
| **Server reads request fields as snake_case (`req.trading_mode`, `req.client_id`) while the ts-proto client sends camelCase (`tradingMode`, `clientId`).** The same file's encode-side comment states ts-proto uses camelCase. If so, `req.trading_mode` is always `undefined` → `resolveMode(undefined)` → `'all'`, so paper/live-scoped rows never reach subscribers and SetConfig always writes `trading_mode='all'`. Self-consistent (read+write both collapse) which masks it. | Trading-mode config scoping may silently collapse to the `'all'` bucket in production | ✓ **RESOLVED (feature 078, confirmed 2026-08-02; re-grounded 2026-08-27)** — `resolveEnv` accepts the ts-proto string form (`configServiceImpl.ts:81-86`), covered by the real-wire test `src/__tests__/scopeResolution.test.ts`; enshrined as constitution CONFIG-5. Note: feature 147 later removed the whole `trading_mode` scope axis, so `resolveMode` no longer exists — the string-decode care now applies to `resolveEnv` + `requestUserId` |
| Unit tests hand-build snake_case requests (`{ trading_mode: 1 }`) that don't match the ts-proto wire shape, giving false confidence in the bug above | The scoping bug is untested against the real wire form | ✓ **RESOLVED (feature 078)** — `src/__tests__/scopeResolution.test.ts` drives a real gRPC connection asserting the bound SQL params |
| **Seed-migration numbers are pre-assigned in `merge-order.md`; a late-merging LOWER number never applies on persistent dev/prod DBs** (golang-migrate runs only versions > current). `025` merged before `024`, forcing `024`→`026` (a permanent intentional gap). A future feature that reserves a low number but merges late will silently no-op on already-migrated databases. | A never-applied config seed migration → keys silently absent in prod despite an "applied" branch | `services/xstockstrat-config/migrations/026_analysis_engine_blend_keys.up.sql:13-17`, `025_ingest_mcp_client_keys.up.sql:6-11` (may be covered by the root golang-migrate forward-only rule — reconcile before promoting to a rule) |
| **Audit trigger fires on UPDATE only** — ~~a brand-new key's INSERT path writes no audit row~~ **RESOLVED (feature 091):** migration `010_config_audit_insert_trigger` adds a dedicated `config_value_audit_insert` `AFTER INSERT` trigger so key creation writes one `config_audit` row (author + value, `old_value` NULL). A dedicated `AFTER INSERT` trigger (not a widened `BEFORE INSERT OR UPDATE`) avoids double-firing on the `ON CONFLICT DO UPDATE` path. Creation is also now gated: `SetConfig` refuses an unregistered scope `NOT_FOUND` unless `create_key=true`. | ~~New-key creation is unaudited~~ Resolved | `migrations/010_config_audit_insert_trigger.up.sql`; `configServiceImpl.ts` `setConfig` existence gate |

## Resolved

| Finding | Resolved | How confirmed |
|---|---|---|
| Root `CLAUDE.md` lists `analysis.scoring.shrinkage_days` / `min_evidence_*` as config keys with no seed | 2026-10-14 | grep of root `CLAUDE.md` for `shrinkage_days` / `min_evidence_symbols` → zero hits; migrations also zero (other docs not re-checked) |
| Dead `src/middleware/propagation.ts` (+ `.eslintrc.json` exemption) | 2026-10-14 | `src/middleware/*` glob empty; `.eslintrc.json` overrides list only `authz.ts`; feature 175 |

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
