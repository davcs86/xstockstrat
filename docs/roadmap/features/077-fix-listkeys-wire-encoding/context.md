# Context: fix-listkeys-wire-encoding  (archived 2026-08-19)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-19 — /sdd-archiver

**What**: A SEV-2 wire-encoding bug in `xstockstrat-config`'s `ListKeys`: the handler hand-built each `ConfigKeyMeta` with snake_case keys and numeric enums, but the ts-proto grpc-js encoder (`snakeToCamel` + `stringEnums=true`) reads camelCase field names and string enum constants, so every field except `key`/`description` silently encoded to proto defaults over the wire. Same defect class feature 075 fixed for `ConfigSnapshot` and did not sweep into `listKeys`. Direct bug-track edit (no design/recon/spec artifacts).

**Why (irrecoverable rationale)**: The bug survived because both existing test layers exercised the wrong surface — the unit test asserted on the handler's pre-encode object (where snake_case looks correct) and the config-ui e2e ran against `e2e/mock-backend.ts` which returns its own already-camelCase shape; neither ran the real ts-proto encoder. The fix was verified by execution: a real `grpc.Server` + real service definition + generated client, printing what the client actually received. `src/__tests__/listKeysWire.test.ts` asserts over a real connection precisely because a pre-encode assertion is what let this survive. Security dimension: `/config-ui`'s secret-edit guard gates editability on `k.isSecret` from `ListKeys`; because that field always encoded `false`, the guard was inert since it was written (secret-flagged keys were always editable). Blast radius was later narrowed by feature 074 (non-admins can't write config at all), leaving the guard as restored defence-in-depth; the service's `CLAUDE.md` documented the guard as working — true of intent, false of behavior.

**Rejected alternatives**: none debated — bug-track direct fix.

**Scars & gotchas**: Pre-encode unit assertions and camelCase mock backends both mask ts-proto snake/camel encoding bugs completely; only a real-connection round-trip catches them. When any handler builds a proto message by hand, ts-proto grpc-js requires camelCase field names + string enum constants (`Environment.*`/`TradingMode.*`), with `valueType`/`minValue`/`maxValue` nested under `validation` — snake_case or numeric enums encode to defaults with no error.

**Permanent deviations**: none — no design.md existed.

**Cross-feature signal**: Third instance of the ts-proto hand-built-message snake/camel encoding trap in `xstockstrat-config` (075 fixed `ConfigSnapshot`/`getConfig`/`watchConfig`; 077 fixes `listKeys`). A wire-encoding fix that does not sweep every hand-built message leaves latent duplicates.

**Deferred follow-ons** (both out of scope, logged in the config service findings doc): request-side `trading_mode` snake/camel collapse (`configServiceImpl.ts` reads `call.request.trading_mode`, same root cause on the request path); `buildConfigValue` has no `'json'` case, so a `json`-typed value reads back as a string.

**Ledger entries written**: insights.md (1), fails.md (1) — see the 2026-08-19 `fix-listkeys-wire-encoding` entries. (A third candidate — pre-encode/camelCase-mock trap — was a DUP of the fails.md 2026-07-27 entry and skipped.)

**Runtime-invariant recommendations (→ /context-constitution)**: config service still carries two unfixed siblings of the ts-proto encoding class (request-side `call.request.trading_mode` collapse; `buildConfigValue` missing `'json'`) — verify they landed in the config service findings doc. Doc-drift candidate: `services/xstockstrat-config/CLAUDE.md` documented the secret-edit guard as working; verify it reflects that the guard depended on this fix.

**Pruned artifacts**: product-spec.md — last present at 1d97c6c.
