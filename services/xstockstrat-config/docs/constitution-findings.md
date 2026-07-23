<!-- ⚠ AI-GENERATED TRIAGE — UNVERIFIED. Produced by constitution-forge (https://github.com/davcs86/agent-plugins) from static code + git-history analysis. These are CANDIDATE defects, doc-gaps, and security-boundary concerns flagged by automated analysis — NOT confirmed by a human or by running the code; some are explicitly open questions. Do not treat as authoritative: verify each (path:line/commit cited) before acting. Refresh by re-running /constitution. -->
# xstockstrat-config — Constitution Findings

Module-specific defects (repo-wide ones live in the root findings). `⚠` = security boundary; most-severe first.

## Latent bugs
- ⚠(platform-wide) **Inbound request fields read snake_case (`req.trading_mode`) but ts-proto decodes camelCase → always `undefined` → `resolveMode` forces `'all'`. Mode scoping is inert; paper/live-specific config rows are never served.** Tests mask it with hand-built snake_case. `configServiceImpl.ts:194-195,253`.
- `WEIGHT_KEY_REGISTRY` keyed `'analysis.signals.source_weights'` but DB row is `'signals.source_weights'` → validation never attaches. `:86` vs `migrations/003:8`.
- `all`-scoped delta never reaches paper/live subscribers (broadcast matches exact mode). `:122-127` vs `:173`.

## Documentation that lies
- "All changes written to `config_audit` automatically" — audit trigger is `BEFORE UPDATE` only; first INSERT of a key is unaudited. `migrations/001:49-51`.
- `json_val`/`value_type='json'` — no `json` case; a json row is served as a raw string. `:313-329`.
- audit trigger "fires pg_notify" — pg_notify is app-fired in `setConfig`. `:266`.

## Open questions
- Is the snake_case inbound read a known bug, or is there a `keepCase` loader path? (Determines whether paper/live scoping works at all.)
