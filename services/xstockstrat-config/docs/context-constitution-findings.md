# xstockstrat-config — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24. For triage/fixing, not
governance. Repeated defects (dead `middleware/propagation.ts`, Node-20 drift) live in the root
findings log.

## Documentation that lies (docs claim behavior the code lacks)

| What the docs say | What the code does | Evidence | Suggested action |
|---|---|---|---|
| Service CLAUDE.md WatchConfig-flow: DELTA = "changed keys only" | Code sends the full namespace with all keys in `changedKeys` (CONFIG-1) | `CLAUDE.md:47` vs `configServiceImpl.ts:160-164` | Correct the doc |
| Service CLAUDE.md pg_notify payload documented as `{namespace, key}` | Code emits `{namespace, key, environment, trading_mode}` and depends on env+mode (CONFIG-4) | `CLAUDE.md:54` vs `configServiceImpl.ts:266` | Correct the doc |
| Root CLAUDE.md lists `analysis.scoring.shrinkage_days`/`min_evidence_symbols`/`min_evidence_days` (feature 065) as config keys | No migration seeds them (highest is `008`; grep for `scoring`/`shrinkage` = zero) | root `CLAUDE.md` vs `migrations/` | Seed them, or note they are runtime-registered |

## Latent bugs (looks broken, not merely non-obvious)

| Issue | Impact | Evidence |
|---|---|---|
| **Server reads request fields as snake_case (`req.trading_mode`, `req.client_id`) while the ts-proto client sends camelCase (`tradingMode`, `clientId`).** The same file's encode-side comment states ts-proto uses camelCase. If so, `req.trading_mode` is always `undefined` → `resolveMode(undefined)` → `'all'`, so paper/live-scoped rows never reach subscribers and SetConfig always writes `trading_mode='all'`. Self-consistent (read+write both collapse) which masks it. | Trading-mode config scoping may silently collapse to the `'all'` bucket in production | reads `configServiceImpl.ts:194-195,233,253,277`; client send `configWatcher.ts:42-48`; camelCase comment `configServiceImpl.ts:16-20` |
| Unit tests hand-build snake_case requests (`{ trading_mode: 1 }`) that don't match the ts-proto wire shape, giving false confidence in the bug above | The scoping bug is untested against the real wire form | `configServiceImpl.test.ts:51,81` |
| **Dead `src/middleware/propagation.ts` still present** — feature 074 added `src/grpc/authz.ts` and deliberately did **not** revive or delete this file: it is 1 of 4 identical copies across the Node services, so removing only this one would make the root findings rows ("in all 4 Node services") half-true. It is exempted in `.eslintrc.json`'s `no-restricted-syntax` override for the same reason. The 4-service deletion remains open at the root findings doc. | Dead code persists; the eslint exemption must be removed with it | `src/middleware/propagation.ts` (zero importers); `src/grpc/authz.ts`; `.eslintrc.json` overrides |
| **Audit trigger fires on UPDATE only** (`BEFORE UPDATE`, gated on value change) — a brand-new key's INSERT path (`ON CONFLICT … DO UPDATE`) writes no audit row, contradicting "all changes are written to config_audit automatically" | New-key creation is unaudited | `migrations/001_config_tables.up.sql:49-51`, `configServiceImpl.ts:256-263`; `CLAUDE.md:71` |

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
