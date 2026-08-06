# Context: fix-config-value-roundtrip  (archived 2026-08-06)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-06 — /sdd-archiver

**What**: Shipped a fix for two `xstockstrat-config` defects — `SetConfig` was storing the whole serialized `ConfigValue` message instead of the bare scalar, and `is_secret` was silently dropped on every read path — both blocking feature 073's redaction work. Fixed with a real-gRPC test suite (context.md:33-39); the backfill of already-corrupted rows was explicitly left undone.
**Why (irrecoverable rationale)**: Split into its own bug feature (not bundled into 073) because both defects are pre-existing and independent of whether 073 ships — 073 is just the first consumer that needs them correct (context.md:11-14, same precedent as feature 074 splitting off 073's FR-7). SEV-2 not SEV-1: defect 1 corrupts UI writes but causes no trading halt; defect 2 was latent because `/config-ui` happened to read `isSecret` from `ListKeys` rather than the snapshot, masking it without anyone recording the workaround (context.md:15-17, product-spec.md:39-41).
**Rejected alternatives**: - Backfill via data migration or tolerant reader for already-corrupted rows — deferred rather than chosen: row count "cannot be determined from the repo," needs real dev/prod data (context.md:48-55, product-spec.md:83-85). Left as a documented manual `SELECT ... LIKE '{%Val%}'` query instead.
**Scars & gotchas**:
- A hand-built snake_case test request would have hidden this exact bug (ts-proto wire shape is camelCase); the new test suite deliberately runs writes over a real gRPC connection to force the genuine wire shape — already logged as a false-confidence trap in the service's own findings doc (context.md:33-36).
- Feature 074's new DRY eslint rails (firing on `src/__tests__/**`) caught 13 lint errors in *074's own* test file because lint wasn't re-run after 074's step 3 added it — caught incidentally while fixing this feature, not by CI (context.md:41-46).
**Permanent deviations**: none — no recon.md/design.md exists for this feature (implemented as a direct fix, bypassing full SDD design phase per its bug-fix framing).
**Cross-feature signal**: A UI-level workaround (`/config-ui` reading `isSecret` from `ListKeys`) silently absorbed a backend defect for an unknown period without ever being flagged — worth watching for elsewhere: silent workarounds hide real defects until a new consumer trusts the "wrong" path.
**Deferred follow-ons**:
- AC-5 backfill of already-corrupted `config.config_values` rows, sized via `SELECT key, value_data FROM config.config_values WHERE value_data LIKE '{%Val%}'` per environment (feature.md:57-59).
- `trading_mode` snake/camel scoping collapse — same root cause family, explicitly out of scope here (product-spec.md:76-78).
**Ledger entries written**: insights.md (1), fails.md (1) — see the 2026-08-06 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none
**Pruned artifacts**: product-spec.md — last present at f871138.
