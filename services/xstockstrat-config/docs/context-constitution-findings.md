# xstockstrat-config — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24. For triage/fixing, not
governance. Repeated defects (dead `middleware/propagation.ts`, Node-20 drift) live in the root
findings log.

## Documentation that lies (docs claim behavior the code lacks)

| What the docs say | What the code does | Evidence | Suggested action |
|---|---|---|---|
| Service CLAUDE.md WatchConfig-flow: DELTA = "changed keys only" | Code sends the full namespace with all keys in `changedKeys` (CONFIG-1) | `CLAUDE.md:47` vs `configServiceImpl.ts:196` | ✓ **RESOLVED** (2026-08-02 refresh) — CLAUDE.md WatchConfig-flow now states DELTA "carries the FULL namespace … a wholesale replace" |
| Service CLAUDE.md pg_notify payload documented as `{namespace, key}` | Code emits `{namespace, key, environment, user_id}` and depends on env+overlay scope (CONFIG-4) | `CLAUDE.md` § WatchConfig Flow vs `configServiceImpl.ts:503-505` | ✓ **RESOLVED** (2026-08-02 refresh; re-grounded 2026-08-27) — feature 147 removed the `trading_mode` field from the payload; it is now `pg_notify('config_changed', {namespace, key, environment, user_id})` |
| Root CLAUDE.md lists `analysis.scoring.shrinkage_days`/`min_evidence_symbols`/`min_evidence_days` (feature 065) as config keys | No migration seeds them (grep for `shrinkage`/`min_evidence` = zero; only `scoring.signal_decay_half_life_hours` is seeded, by `migration 019`; highest migration is now `020`) | root `CLAUDE.md` vs `migrations/` | Seed them, or note they are runtime-registered |

## Latent bugs (looks broken, not merely non-obvious)

| Issue | Impact | Evidence |
|---|---|---|
| **Server reads request fields as snake_case (`req.trading_mode`, `req.client_id`) while the ts-proto client sends camelCase (`tradingMode`, `clientId`).** The same file's encode-side comment states ts-proto uses camelCase. If so, `req.trading_mode` is always `undefined` → `resolveMode(undefined)` → `'all'`, so paper/live-scoped rows never reach subscribers and SetConfig always writes `trading_mode='all'`. Self-consistent (read+write both collapse) which masks it. | Trading-mode config scoping may silently collapse to the `'all'` bucket in production | ✓ **RESOLVED (feature 078, confirmed 2026-08-02; re-grounded 2026-08-27)** — `resolveEnv` accepts the ts-proto string form (`configServiceImpl.ts:81-86`), covered by the real-wire test `src/__tests__/scopeResolution.test.ts`; enshrined as constitution CONFIG-5. Note: feature 147 later removed the whole `trading_mode` scope axis, so `resolveMode` no longer exists — the string-decode care now applies to `resolveEnv` + `requestUserId` |
| Unit tests hand-build snake_case requests (`{ trading_mode: 1 }`) that don't match the ts-proto wire shape, giving false confidence in the bug above | The scoping bug is untested against the real wire form | ✓ **RESOLVED (feature 078)** — `src/__tests__/scopeResolution.test.ts` drives a real gRPC connection asserting the bound SQL params |
| **Dead `src/middleware/propagation.ts` still present** — feature 074 added `src/grpc/authz.ts` and deliberately did **not** revive or delete this file: it is 1 of 4 identical copies across the Node services, so removing only this one would make the root findings rows ("in all 4 Node services") half-true. It is exempted in `.eslintrc.json`'s `no-restricted-syntax` override for the same reason. The 4-service deletion remains open at the root findings doc. | Dead code persists; the eslint exemption must be removed with it | `src/middleware/propagation.ts` (zero importers); `src/grpc/authz.ts`; `.eslintrc.json` overrides |
| **Audit trigger fires on UPDATE only** — ~~a brand-new key's INSERT path writes no audit row~~ **RESOLVED (feature 091):** migration `010_config_audit_insert_trigger` adds a dedicated `config_value_audit_insert` `AFTER INSERT` trigger so key creation writes one `config_audit` row (author + value, `old_value` NULL). A dedicated `AFTER INSERT` trigger (not a widened `BEFORE INSERT OR UPDATE`) avoids double-firing on the `ON CONFLICT DO UPDATE` path. Creation is also now gated: `SetConfig` refuses an unregistered scope `NOT_FOUND` unless `create_key=true`. | ~~New-key creation is unaudited~~ Resolved | `migrations/010_config_audit_insert_trigger.up.sql`; `configServiceImpl.ts` `setConfig` existence gate |

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
