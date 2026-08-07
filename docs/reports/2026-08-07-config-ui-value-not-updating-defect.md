# Config UI: Editing a Value Never Displays the Save — 2026-08-07

**Status: fixed in this report's companion PR** (`claude/editing-configs-ui-bug-jz1hk4`).
GitHub Issues are disabled on this repo, so this report is the audit trail per
`docs/runbooks/bug-triage.md` Track C (SEV-2 — config-ui's edit flow was non-functional from the
operator's point of view; no live-trading path was affected).

## Report

User-reported via a screen recording of `/config-ui/marketdata?env=dev&mode=paper` (dev
deployment): editing any key — e.g. `marketdata.fmp.enabled` (`—` → `true`) or
`marketdata.fmp.cache_ttl_hours` (`24` → `25`, with a typed reason) — shows the input, accepts
the new value, and closes back to read-only on Save with no error banner. The row's Value column
then shows the **original, unedited value**. Repeating the edit reproduces the same result every
time. The Audit Log page (`/config-ui/audit`) showed zero entries for the whole session, which
is consistent with (but not itself proof of) the writes never landing.

## Root cause

`ConfigKeyMeta` (`ListKeys`' response row) carried only `default_value` — per constitution
**CONFIG-2**, this is *seed metadata the runtime read path never uses*; `SetConfig` writes to a
separate `value_data` column and never touches `default_value`. `ListKeys` had no field for the
live value at all.

`NamespaceEditor.tsx` (the config-ui edit table) nonetheless displayed `k.defaultValue` as the
"Value" column and used it to prefill the edit input — the only "value"-shaped field `ListKeys`
exposed. So the write path was fine (`SetConfig` did persist to `value_data`), but there was no
way for the UI to ever observe it: every `ListKeys` refetch after a save kept returning the same
unedited `default_value`, making every save look like a silent no-op.

The same defaultValue-as-value assumption also affected `useSignalSources.ts`, which parses
`analysis.signals.source_weights`' `defaultValue` as JSON to populate the Sources page's Weight
column — an admin-edited weight map never showed up there either.

## Fix

- `packages/proto/config/v1/config.proto`: added `ConfigKeyMeta.current_value` (field 9) — the
  row's live `value_data`, distinct from the existing `default_value` seed-metadata field.
- `services/xstockstrat-config/src/grpc/configServiceImpl.ts` `listKeys`: SELECT `value_data`
  alongside `default_value`; map it to `currentValue` in the response.
- `services/xstockstrat-ui/src/app/config-ui/[namespace]/NamespaceEditor.tsx`: Value column
  display and edit-prefill now read `k.currentValue`, not `k.defaultValue`.
- `services/xstockstrat-ui/src/app/config-ui/hooks/useSignalSources.ts`: parses
  `weightKey.currentValue`, not `weightKey.defaultValue`.

## Tests added

- `services/xstockstrat-config/src/__tests__/listKeysCurrentValue.test.ts`: asserts the SQL
  SELECT reads `value_data` and that `currentValue` reflects it independently of `defaultValue`
  (RED-verified against the pre-fix `listKeys`).
- `services/xstockstrat-config/src/__tests__/{listKeysWire,listKeysDedup}.test.ts`: extended with
  `currentValue` assertions alongside the existing `defaultValue` coverage.
- `services/xstockstrat-ui/e2e/config-ui/value-persists-after-save.spec.ts` (new): edits
  `platform.trading_state` and asserts the Value column shows the saved value (not the seed
  default) and re-prefills from it; edits `platform.maintenance_mode` and asserts the saved value
  survives a full page reload; edits `analysis.signals.source_weights` and asserts the Sources
  page Weight column reflects it.
- `services/xstockstrat-ui/e2e/config-ui/api-smoke.spec.ts`: new `currentValue` field-contract
  assertions, plus a regression case proving a `SetConfig` write is visible to the next
  `ListKeys`. While adding it, found and fixed a second, unrelated latent bug in the shared
  `setConfigPayload()` fixture: its `value` field used protobuf-es's in-memory `{ case, value }`
  oneof accessor shape instead of the Connect JSON *wire* shape (`{ stringVal: '...' }`) that a
  raw `fetch()`-posted JSON body actually needs — the malformed shape decoded as an empty oneof,
  so every BFF smoke test using it wrote nothing despite a 200 response. Purely a test-fixture
  defect (the real config-ui UI always goes through the properly-encoding `configClient` SDK, so
  production behavior was never affected); fixed alongside since the new regression test needed
  it to actually write.
- `services/xstockstrat-ui/e2e/mock-backend.ts`'s `ConfigService.listKeys`/`setConfig` mocks are
  now stateful (a `configValueOverrides` map keyed by config key, mirroring `value_data` vs.
  `default_value` on the real service) so e2e tests can actually exercise a save-then-redisplay
  round trip; the static key list moved to `e2e/fixtures/configKeys.ts` (`CONFIG_KEY_FIXTURES`)
  per the test-data-inventory convention.

## Not in scope

- The Audit Log being empty on the reporter's deployment is not reproduced or explained by this
  fix — the audit route (`config-ui/api/audit/route.ts`) silently returns `{ entries: [] }` when
  `DATABASE_URL` is unset, which looks like a deployment/environment-configuration question, not
  a code defect in this path. Worth checking on that dev deployment separately if audit entries
  are still missing after this fix ships.
