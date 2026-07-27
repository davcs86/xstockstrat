# Design: strategy-partial-update

**Created**: 2026-07-26
**From**: recon.md + product-spec.md
**Rounds**: 1 proposer round + 1 adversary pass (verdict NEEDS WORK, no Floor breach; every
objection resolved below). Termination: approved after correction.

---

## Chosen Approach

Add `google.protobuf.FieldMask update_mask = 3` to `ManageStrategyRequest`
(`packages/proto/analysis/v1/analysis.proto:255-258`, next free field is **3**), importing
`google/protobuf/field_mask.proto` alongside the existing imports at `:7-9`.

**Semantics for `STRATEGY_OPERATION_UPDATE`:** a **present** mask ⇒ merge (only listed top-level
`StrategyDefinition` paths are taken from the request; every other key is copied verbatim from the
stored row). An **absent/empty** mask ⇒ full replace — byte-for-byte today's behavior. The mask is
ignored for REGISTER/DEACTIVATE. Allowed paths are flat and closed: `display_name`, `components`,
`entry_rule`, `exit_rule`, `signal_params`, `cooldown_days`. `strategy_id` / `active` /
`live_enabled` in a mask ⇒ `INVALID_ARGUMENT`, honoring the column-authoritative overlay
(`servicer.py:1818-1823`).

### 1. The merge rule (adversary-corrected — one uniform rule, not two)

Round 1 proposed reading masked *scalars* off the proto object but `components` from the dict. The
adversary proved that silently no-ops three of the six allowed paths, because `MessageToDict` omits
default-valued no-presence fields: a masked `components: []` never appears in the dict, so a
deliberate component clear does nothing (breaking AC-6), and a masked-unset `signal_params` read off
the proto yields an empty `Struct`, persisting `signal_params: {}` where today the key is absent —
which changes the key set and therefore `_definition_fingerprint` (`servicer.py:1787-1790`).

**Decided — AIP-161 clear semantics, one rule for every path:**

```python
full = json_format.MessageToDict(request.definition, preserving_proto_field_name=True)
for p in mask_paths:
    if p in full:
        base[p] = full[p]
    else:
        base.pop(p, None)          # masked-but-absent == clear
```

This is presence-correct for both explicit-presence fields (`optional cooldown_days`,
`analysis.proto:245`; `signal_params` as a `Struct`) and preserves the canonical default-omitting
encoding the fingerprint depends on. **`always_print_fields_with_no_presence=True` is explicitly NOT
used here** — it prints only *no-presence* fields (so a masked `cooldown_days` clear still could not
be expressed) and would inject `params: {}` / `active: false` churn into `definition_json`.

**`cooldown_days` is not a one-way door.** Under the pop-rule, masking `cooldown_days` without
supplying it clears the key, reverting to the platform default
(`analysis.strategy.default_cooldown_days`). The MCP tool exposes this as an explicit
`clear_fields: list[str] | None` parameter folded into the mask, so the 069 explicit-presence
contract survives in *both* directions (insights.md 2026-07-24 records only the forward trap; this is
its inverse).

### 2. Server flow (replacing `servicer.py:1371-1398`)

`SELECT … FOR UPDATE` inside a transaction → `base = dict(row["definition_json"])` → apply the mask
rule above → rebuild the proto by feeding a synthetic row through the existing
`_row_to_strategy_definition` (`:1812-1824`) → `_validate_definition_proto(merged, context)`
**unchanged** (`:165-176`) so FR-2(a)'s orphan-ref check runs on the **merged** result → erasure
guard → persist → feature-065 recompute block (`:1385-1398`) unchanged.

**Atomicity (adversary objection).** Round 1's `get_by_id`-then-`update` is two statements on two
pool borrows, introducing a lost-update window that today's single-statement `UPDATE`
(`strategies.py:57-68`) does not have — a concurrent UI edit and agent tune would silently discard
one merge. `self._lock_for(sid)` (`:1086-1092`) is documented single-process-only. **Decided:** a new
repository method wraps the read and the write in one `conn.transaction()` with `SELECT … FOR
UPDATE`. A pure-SQL `definition_json || $3::jsonb` merge is not available, because FR-2(a) requires
validating the merged result in Python *before* the write, and `||` cannot delete keys.

**Persist what you validated (adversary objection).** Round 1 validated a proto rebuilt from `base`
via `ParseDict(..., ignore_unknown_fields=True)` but persisted `base` — so unknown keys are dropped
by the validator and kept by the writer, and `ParseDict` coerces (`map<string,double> params`,
`analysis.proto:230`, accepts `"10"` → `10.0`). **Decided:** persist
`json_format.MessageToDict(merged, preserving_proto_field_name=True)`. Fingerprint impact is nil —
the three keys the overlay adds are exactly `_FINGERPRINT_EXCLUDED_KEYS` (`:1772`), and
`strategy_id` is always present with the same value.

### 3. FR-2(b) — "erasure is explicitly requested" == the path is in the mask

`_guard_erasure` rejects `INVALID_ARGUMENT` when a previously non-empty `components` becomes empty,
or a previously non-empty `entry_rule`/`exit_rule` becomes blank, and that path is **not** in the
mask. It **deliberately applies to maskless UPDATE too**, so the reported incident fails closed even
against a completely unpatched client.

**This is a deliberate, documented backward-incompatible narrowing** of a shipped RPC. Full caller
enumeration (verified repo-wide): UI BFF `insightsBff.ts:42-54` → `StrategyWizard.tsx:136-160` and
`strategies/page.tsx:39` (DEACTIVATE); agent `client.py:248-308`; `scripts/integration-test.sh:346`
(REGISTER only); `e2e/mock-backend.ts:644` (mock); docs `mcp-tools.md:308`,
`indicator-builder.md:286`. **No legitimate maskless-UPDATE erasing caller exists** —
`StrategyWizard.tsx:127-134` `canAdvance` structurally requires `components.length >= 1` and
non-blank rules. What it does remove is the ability of a non-mask client (grpcurl, ops scripts) to
clear rules + components in one UPDATE. The rejection message names the mask as the escape hatch, and
a servicer test proves it. Recorded in `design.md` and `mcp-tools.md` rather than left implicit.

### 4. Three-layer fabrication fix

- **Tool** (`tools.py:289-354`): optional params default to `None`; the mask is built from supplied
  kwargs plus `clear_fields`; an empty mask on `update` raises `ValueError`. The MCP path therefore
  **can never emit a maskless update**. Generalizes the existing `cooldown_days is not None`
  precedent (`tools.py:347-350`) to every optional field, replacing the fabrication block at
  `:338-344`.
- **Client** (`client.py:248-308`): presence-honest proto construction; **drop**
  `active=definition.get("active", True)` (`:289`) — nothing reads it (`strategies.py:54-68` never
  writes the column; `servicer.py:1821` overlays it) and it would inject an unrequested key into the
  merged `definition_json`.
- **Server**: as above.

### 5. New `get_strategy` MCP tool (14th)

A thin non-admin `@server.tool()` copying the `get_backfill_status` shape (`tools.py:494-521`) over
the already-shipped `client.get_strategy` (`:311-321`). **Do not admin-scope the RPC** — `GetStrategy`
(`servicer.py:1410-1413`) has no admin gate by design and the non-admin detail page depends on it
(`strategies/[id]/page.tsx:42`; BFF uses `forward`, not `forwardAdmin`, `insightsBff.ts:55`).

`client.get_strategy` switches to snake_case `MessageToDict(..., preserving_proto_field_name=True,
always_print_fields_with_no_presence=True)`. Justification is *not* merely "zero in-repo callers" —
it is that the only consumer is the new tool, so **no shipped contract exists to break**, and the
tool's purpose is fetch → edit → resend into snake_case `manage_strategy`. Verified against the 069
trap: `always_print_fields_with_no_presence=True` applies only to fields *without* presence, so
`optional int32 cooldown_days` stays absent when unset and a round-trip cannot fabricate an explicit
`0`. The tool test asserts `components: []` / `entry_rule: ""` / `active: false` are now emitted.

### 6. OQ-2 — the feature-065 evidence wipe is ACCEPTED, not avoided

Round 1's answer was wrong. "The merge cannot churn key presence ⇒ identical fingerprint ⇒ grade
reinstated" holds only when the masked path is fingerprint-excluded (`display_name`). The motivating
case — a `cooldown_days=45` tune — **does** change `definition_json`, so `_definition_fingerprint`
changes and `:1385-1398` still clears the grade and recomputes to empty.

**Accepted, with reason:** `cooldown_days` gates re-entry via `app/services/cooldown.py`, so it is
genuinely scoring-relevant; evidence earned under one cooldown regime must not score another.
`_FINGERPRINT_EXCLUDED_KEYS` (`:1772`) is **not** extended. What the merge *does* fix is *spurious*
key churn — today's `MessageToDict`-of-a-fabricated-proto full replace changes the key set on every
edit, so even a rename resets evidence. Surfaced in the `manage_strategy` docstring so an operator is
not surprised.

---

## Rejected Alternatives

- **`STRATEGY_OPERATION_PATCH = 4`** — cheaper (no proto import, no mask-path validation) and leaves
  `UPDATE` byte-identical for every existing client. **Decisively rejected** on a security argument
  the adversary supplied: `insightsBff.ts:46-49` is an **exhaustive allow-list** over
  `StrategyOperation` (`REGISTER || UPDATE || DEACTIVATE`). A fourth enum value falls through as
  non-mutating and **skips `requireAdminScope`** — defense-in-depth collapses to analysis's own
  `_has_admin_scope` (`servicer.py:1352`) alone. This is a direct instance of ledger fail
  2026-07-21/067 ("appending a proto enum value is not backend-only"). PATCH also still cannot
  express "clear components" without a mask, so the mask gets reinvented inside PATCH.
- **Merging in the repository layer** (`definition_json || $3::jsonb`) — atomic and one round trip,
  but FR-2(a) needs the merged dict in Python before the write, `||` cannot delete keys (breaks clear
  semantics), and recon confirms there is **no repository test file at all**, so the SQL would ship
  untested (C-08). Its atomicity argument is recycled into the `conn.transaction()` wrapper above.
- **Two-rule merge (scalars from proto, repeated/message from dict)** — see §1; silently no-ops
  component clear and churns `signal_params`.
- **Mask-only erasure guard** — preserves today's contract exactly for non-mask callers, but forfeits
  the fail-closed property that makes the server fix independently sufficient against an unpatched
  client. Weighed explicitly; the compatibility cost is documented in §3 rather than denied.
- **Merge-by-default `update` + an in-band clear sentinel** (`entry_rule: "__CLEAR__"`) — zero proto
  change, but an unauditable sentinel inside a JSON-rule string field that collides with legitimate
  content.

## Open Risks

| Risk | Mitigation | Target step |
|---|---|---|
| **AC-1's "end-to-end through the MCP tool path" has no working harness.** The only cross-service `ManageStrategy` round trip is `scripts/integration-test.sh:338-360` (§7b) — REGISTER only, **not wired into any workflow** (zero `integration-test` hits under `.github/workflows/`), and **stale**: it posts to `${ANALYSIS_URL}/xstockstrat.analysis.v1.AnalysisService/…` Connect-HTTP paths removed with the 80xx servers | Add the UPDATE-with-mask case to §7b *and* record its staleness. The layered substitute (tool-level mask capture + client wire capture + servicer merge test) is recorded here as a **documented gap**, per P-03 — not a silent substitution | Step 6 |
| Every existing UPDATE test drives `AsyncMock` repos with no `get_by_id` behavior, so `dict(row["definition_json"])` yields a `MagicMock` and fails obscurely rather than raising | Named step: update `TestManageStrategy.test_update_path` (`tests/test_analysis_servicer.py:607`) and the `_update_req`/`_updated_row` helpers (`:1707`/`:1717`) — not a mid-execute deviation | Step 2 |
| `SELECT … FOR UPDATE` adds a held transaction on a 2-connection pool (F-06 budget) | Transaction spans one read + one write, no RPC inside it (the `GetFormula` validation fetch happens **before** the transaction opens) | Step 2 |
| ts-proto emits a per-WKT file, so `gen/ts/google/protobuf/field_mask.ts` + its `dist/` output is a **new committed artifact** or `proto-freshness` fails | Run `./scripts/buf-gen.sh` and commit the generated file in the proto step (C-09) | Step 1 |

## Constitution Rules Touched

| ID | How honored |
|---|---|
| **C-01** | Every step cites `path:line`; bare filenames from the product spec expanded to full repo paths (`app/handlers/servicer.py`, `app/services/evaluator.py`) |
| **C-04** | No new enum value — the `PATCH=4` alternative was rejected partly on enum-consumer grounds |
| **C-08 / P-06** | Each service step pairs with a test; existing UPDATE tests fixed as a named step |
| **C-09** | `buf lint` + `buf breaking` on the additive field 3; `./scripts/buf-gen.sh` must commit the new `field_mask` TS artifact. Verified: FieldMask is a WKT shipped with buf, reachable by `grpc_tools` (`buf-gen.sh:54-55`), Go → `fieldmaskpb`, protoc-gen-es → `@bufbuild/protobuf/wkt` (already a dep, `gen/ts/package.json:18`). **No blast radius** on the verbatim-persisted-bytes warning at `analysis.proto:60-63` — that governs `BacktestResult`/`BarDiagnostic`, not `ManageStrategyRequest` |
| **C-10** | **Six** surfaces, not five — the adversary caught the same miss feature 066 recorded: the *operational runbook* `docs/runbooks/indicator-builder.md:255,286` tells an operator to use `manage_strategy`/`ManageStrategy` and must gain the partial-update note + `get_strategy` pointer. Plus `mcp-tools.md:3`, `:29`, `:308-318`, `tools.py:4`, agent `CLAUDE.md:26`, `docs/runbooks/CLAUDE.md:17`, and `tests/test_tools_endpoint.py:23-37`. Also `e2e/mock-backend.ts:644-652`, which merely echoes `req.definition` and models no merge — no UI-side partial-update assertion is possible until it changes |
| **C-12** | `e2e/mock-backend.ts:654-675` `getStrategy` is an inline literal catalogued as not-yet-centralized (`e2e/fixtures/INVENTORY.md:49`); the step touching it owes a fixture module + catalog row in the same step |
| **F-06** | No pool change; the transaction holds one connection briefly with no RPC inside |
| **P-03** | The AC-1 harness gap, the maskless-UPDATE contract narrowing, and the OQ-2 evidence wipe are all recorded as explicit accepted risks rather than silently substituted |

## Build Order

1. **Proto** — import `field_mask.proto`; add `update_mask = 3` with a comment stating absent = full
   replace. `./scripts/buf-gen.sh`; commit the new TS WKT artifact.
2. **Analysis server** — `_merge_definition` (AIP-161 pop-rule) + `_guard_erasure` + the
   transactional `select_for_update`-and-write repo method + rewritten UPDATE branch. Fix the
   existing UPDATE tests' `get_by_id` stubs. Tests in `TestManageStrategy`
   (`tests/test_analysis_servicer.py:577`) and `TestHeadlineTriggers` (`:1727`).
3. **Agent client** (`client.py:248-308`) — presence-honest build, drop `active`, attach
   `update_mask`; snake_case `get_strategy` (`:311-321`). Wire-capture tests
   (`tests/test_client.py:71-135`) asserting `HasField` + `update_mask.paths`.
4. **Agent tool** (`tools.py:289-354`) — `None` defaults, mask build, `clear_fields`, empty-mask
   `ValueError`, docstring; new `get_strategy` tool.
5. **Docs / inventory** — the six surfaces above + `test_tools_endpoint.py:23-37`; analysis
   `CLAUDE.md` merge + evidence semantics.
6. **UI** — e2e regression only (no production change): `mock-backend.ts` merge modelling + C-12
   fixture centralization; add the UPDATE-with-mask case to `integration-test.sh` §7b and record its
   staleness.
