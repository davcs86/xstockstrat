# Context Log: fix-listkeys-wire-encoding

Append-only.

---

## Session 2026-07-29 — surfaced, verified, fixed

- Raised by the `/sdd-review` re-run on feature 073 as a blocker against FR-2 ("`list_config_keys`
  returns each key's `ConfigKeyMeta`"), which is undeliverable while the fields are dropped.
- **Verified by execution, not by reading**: stood up a real `grpc.Server` with the real service
  definition and the real impl, dialled it with the generated `ConfigServiceClient`, and printed
  what the client received. `isSecret` came back `false` for a row with `is_secret = TRUE`;
  `defaultValue`/`consumingService` were empty; both enums were `UNRECOGNIZED`.
- **This is my own incomplete fix from feature 075.** That feature fixed exactly this defect class
  in `toProtoSnapPayload`/`buildConfigValue` for `ConfigSnapshot`, and I did not check `listKeys`,
  which had the identical bug. Recording that plainly so the pattern is visible: when fixing a
  wire-encoding bug, sweep **every** handler that builds a proto message by hand.
- Fix mirrors 075: camelCase field names, `Environment.*`/`TradingMode.*` string enum constants,
  and `valueType`/`minValue`/`maxValue` inside `validation`.
- The pre-existing unit test asserted `k.validation.value_type` on the pre-encode object; it now
  asserts `valueType`, matching what the handler actually emits.
- New `src/__tests__/listKeysWire.test.ts` asserts over a real connection, because a pre-encode
  assertion is precisely what let this survive.

### Verification

| Gate | Result |
|---|---|
| red-before-green | 5 failures with the fix reverted → 31/31 with it |
| `pnpm test` | 31/31, terminates cleanly |
| `pnpm lint` | 0 errors |

### Security note

`/config-ui`'s secret-edit guard reads `isSecret` from `ListKeys`, so until this fix it never
fired — secret-flagged keys were editable in the UI. After feature 074 a non-admin can no longer
write config at all, so the practical exposure now requires an admin session; the guard is a
defence-in-depth affordance, restored here. `services/xstockstrat-config/CLAUDE.md` documents the
guard as working, which was true of the intent and not of the behavior.

## Session 2026-08-19 (status reconciliation)

- Feature was stalled at `code-completed` though its code is in production.
- Root cause: `ci-validate-feature-status.yml` only flips a feature to `launched` when a
  commit in the promotion delta matches the feature *slug* via `git log --grep`; this feature's
  merge commit message did not contain the slug, so the automation skipped it.
- Verified in production: main == main-dev @ 1d97c6c78caa532a24265dae2fa79c674b3b69dd. Merge reference: PR #806.
- Status updated: `code-completed` → `launched`; Launched date: 2026-08-19.
