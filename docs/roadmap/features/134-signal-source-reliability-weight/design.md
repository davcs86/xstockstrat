# Design: signal-source-reliability-weight

**Created**: 2026-08-13
**Rounds**: 4 (full; termination: approved)
**Approved by**: user @ 2026-08-13
**Grounded in**: recon.md

---

## Chosen Approach

**Proto.** Add `optional double reliability_weight = 12;` to `ingest.SignalSource`
(`recon.md` Codebase Map — `ingest.proto:142-156`, field 12 free, no `reserved` block). `optional`
(explicit presence) is required, not a style choice: proto3's bare-scalar zero-value would make an
omitted field on the create form indistinguishable from an explicit `0.0`, and the register-path fix
below depends on `HasField` being callable — the repo already uses this idiom elsewhere
(`trading.proto:110` `optional double confidence`).

**Ingest write path.** `ManageSignalSource`'s register/update handlers (`servicer.py:1058-1187`)
resolve a concrete `float` **in Python** before ever calling the repository layer — never a bare
`None`: `weight = clamp01(src.reliability_weight) if src.HasField("reliability_weight") else 1.0`
on register; a `HasField`-**and**-mask-gated variant on update
(`merged_weight = (clamp01(...) if src.HasField(...) else stored["reliability_weight"]) if
_use_req("reliability_weight") else stored["reliability_weight"]`), added to `_SS_MASKABLE_PATHS`
(`servicer.py:41-48`) as a pure additive entry. This is load-bearing, not cosmetic: `insert_source`/
`update_source` (`signal_sources.py:94-122,125-154`) list every column explicitly in their SQL, so a
bound `NULL` on a `NOT NULL` column does **not** fall through to the DB `DEFAULT` in Postgres — it
raises `NotNullViolationError`. Both repository functions gain a required `reliability_weight: float`
kwarg; every call site (2 production, 3 existing tests — see Open Risks) always passes a concrete
value. Validation is **reject-at-write** (`INVALID_ARGUMENT`), matching this service's own
established precedent for a `[0,1]`-bounded double (`conviction`, `servicer.py:719-727`) rather than
the config blob's read-time clamp it replaces — plus a DB `CHECK (reliability_weight BETWEEN 0 AND
1)` on migration `010_add_signal_source_reliability_weight` as defense-in-depth against any write
path outside `ManageSignalSource` (mirrors `conviction`'s own CHECK, `migrations/001_newsletter_signals.up.sql:14`).
Both `ListSignalSources`' and `ManageSignalSource`'s shared row-construction
(`servicer.py:1178-1187`, one `ingest_pb2.SignalSource(...)` build reached from all four
register/update/reactivate/deactivate branches) include `reliability_weight` — correct post-save UI
state without forcing a refetch.

**Analysis read path.** New `_drain_source_weights(propagation_meta) -> dict[str, float]` helper,
shaped exactly like the existing `_drain_active_signals`/`_drain_held_symbols` fresh-fetch-per-call
convention (best-effort `grpc.RpcError → log.warning → {}`, `servicer.py:2358-2410`) — a single,
unpaginated `ListSignalSources` call on the already-wired `self._ingest` stub
(`servicer.py:132`, no new channel). **FR-4 is resolved as a genuine replace, not a relabel**: both
`ScreenSymbols` (`servicer.py:1890-1902` → `screener.py:235-237,456-462` → `scoring.py:22-23`) and
`_compute_opportunities` (`servicer.py:2163`) call this same helper and stop reading
`analysis.signals.source_weights` entirely. `signal_axis`'s write becomes
`c["signal_axis"] = max(c["signal_axis"], sig.conviction * weights.get(sig.source, 1.0))` — the
`.get(source, 1.0)` neutral default mirrors the existing precedent at `scoring.py:23`, and confirms
(per the `023-position-sizing-engine` trap) that `sig.conviction` here is `ExternalSignal.conviction`
(cardinal), never `Opportunity.conviction` (ordinal).

**Consumer surface (C-14).** `xstockstrat-ui` `/config-ui` — the Sources page weight column
(`page.tsx:344`) becomes read/write: `useSignalSources.ts` drops its `ConfigService.ListKeys`
combine step and reads `reliability_weight` straight off each `SignalSource`; the cell becomes a
click-to-edit inline control reusing only the `Input`/Save/Cancel **shell** of
`NamespaceEditor.tsx:176-278` (not `validateFloatMap`, which validates a JSON map and cannot
validate a bare scalar — a bespoke 2-line `[0,1]` range check replaces it), saving via the existing
`useManageSignalSource` wrapper with `update_mask.paths=['reliability_weight']`
(`page.tsx:229-243`'s existing masked-update pattern). `formFromSource`/`FormState` stay untouched —
new sources get the DB default (`1.0`) at register time and are edited via the inline cell
thereafter. The Opportunities queue (`/insights`) surfaces the change only as a ranking-order shift
via the existing display path — no new UI element there.

**Config-key deprecation.** `analysis.signals.source_weights` is retained (product-spec's Out-of-Scope
forbids deletion) but becomes genuinely unread by any code path once the replace above lands — its
registered description is updated (new `xstockstrat-config` migration, after the repoint) to state
it. The key stays fully editable via the generic `NamespaceEditor` — **accepted as a deliberate
trade-off**, not built around (see Open Risks).

**FR-6.** Confirmed satisfied as written, no further action: `022-signal-time-decay`'s product spec
already depends on this feature landing first and multiplies its own decay factor into the same
`signal_axis` expression (`docs/roadmap/features/merge-order.md`), which is FR-6's "defer with a
named follow-up" branch.

## Rejected Alternatives

- **FR-4 as an override layer** (config value wins when present, source field otherwise) — rejected:
  recreates the exact "two silently-independent, possibly disagreeing numbers" FR-4 itself forbids;
  also contradicts the problem statement's framing that reliability is a property of the source, not
  an analysis-owned shadow copy.
- **Register-path `None` relying on the DB `DEFAULT`** — rejected: a bound `NULL` param on a
  `NOT NULL` column does not fall through to `DEFAULT` in Postgres when the column is named in the
  INSERT statement; this crashes every UI-driven registration (the create form never sets the field).
  Resolve the default in Python instead, always pass a concrete float.
- **Config-key "deprecation" via description-text update alone, with `ScreenSymbols` left untouched**
  — rejected: cosmetic; ships the dual-source anti-pattern FR-4 forbids. The description update is
  only meaningful as the finishing touch on an actual functional replace, not a substitute for one.
- **Deleting `analysis.signals.source_weights` outright** — rejected: explicitly out of scope per the
  product spec; the resulting "editable but inert" state is accepted, not built around.
- **Reusing `NamespaceEditor.tsx`'s `validateFloatMap` verbatim for the Sources page weight cell** —
  rejected: it validates a JSON *map* (`JSON.parse` + `typeof === 'object'`), not a bare scalar;
  calling it on a single number would make every edit permanently unsavable. Reuse the click-to-edit
  shell only; write a 2-line scalar validator.
- **A DB `CHECK` constraint on `reliability_weight` treated as dead-code and dropped** (round 3's
  position) — rejected on re-litigation (round 4): a `CHECK` is insurance against write paths
  *outside* `ManageSignalSource` (a future direct-DB script, a refactor bug in the clamp helper), the
  same rationale that justifies `conviction`'s own CHECK for the identical value shape.
- **Extending `formFromSource`/`FormState` (the full edit modal) to also carry the weight field** —
  rejected: FR-5's text targets only the existing weight column; keeping the diff to one interaction
  pattern (inline cell) matches "touch only what the task requires."
- **Adding the new inline-edit-weight e2e test to `value-persists-after-save.spec.ts`** (round 4's
  original placement) — rejected on round-4 adversary review: that file is explicitly scoped to
  CONFIG-2 regression coverage across two named consumers, one of which (`useSignalSources`' weight-
  map parse) ceases to exist once this feature lands; `sources.spec.ts` already has the
  Actions→Edit→Save→`waitForRequest('/ManageSignalSource')` pattern this test needs (feature 088) —
  a closer DRY fit.
- **A shared numeric-range-validator helper extracted in ingest** — rejected: no such helper exists
  today (the `conviction` precedent is an inline check); one more field doesn't justify a new
  abstraction (scope-creep guard).

## Open Risks

- [ ] **Zombie-editable config key** — `analysis.signals.source_weights` stays fully writable via the
  generic Namespace Editor with only a rewritten description as the "this is now inert" signal (no
  UI badge, no read-only lock). Accepted per Out-of-Scope; to be addressed at `/sdd-spec` time only
  as documentation (the description text), never as a suppression mechanism.
- [ ] **Test-fragility guardrail** — `test_insert_config_json_passed_as_json_text`
  (`test_signal_sources.py:277`) asserts on a positional index (`call_args[0][6]`) for `config_json`.
  Adding `reliability_weight` to `insert_source`'s param list must place it **last** (after `active`)
  so this index stays valid, or the assertion should be converted to name/keyword-based lookup — to
  be resolved in the `/sdd-spec` step that adds the kwarg.
- [ ] **Doc drift, must land in this feature's PR (not deferred)**: `docs/patterns/config-governance.md:168`
  ("`analysis.signals.source_weights` is unchanged — stays the screener's") and
  `services/xstockstrat-analysis/CLAUDE.md`'s config-key table row for the same key both become false
  once the replace lands — reword both in the same PR per the repo's teardown rule.
- [ ] **Test churn**: 3 existing repository tests (`test_signal_sources.py:250,268,285` —
  `test_insert_is_a_plain_insert_no_conflict`, `test_insert_config_json_passed_as_json_text`,
  `test_update_writes_merged_columns_and_never_active`) need `reliability_weight` added to their
  `insert_source`/`update_source` call sites in the same step that makes the kwarg required, plus 2
  new named regression tests (`test_manage_signal_source_register_explicit_zero_weight_persists_as_zero`,
  `test_manage_signal_source_update_explicit_zero_weight_persists_as_zero`) guarding the exact
  zero-value trap this design exists to prevent — a future DRY refactor of the near-identical
  register/update merge lines must not silently drop the `HasField` guard without these going red.
- [ ] **C-12 fixture obligation**: a new `e2e/fixtures/signalSources.ts` module + `INVENTORY.md:60`
  row update is required in the step that adds the new Sources-page edit e2e coverage — this feature
  is the second consumer of that domain (currently inline in `e2e/mock-backend.ts:882-923`, listed
  "Not yet centralized").

## Constitution Rules Touched

- `C-01` (zero-assumption / evidence-cited) — honored: every claim across 4 rounds is cited to
  `recon.md` `path:line`; the round-2 register-path bug and round-3's "genuine replace" gap were both
  caught by grep-verifying claims rather than trusting them.
- `C-05` (config key naming/conventions) — honored: no new config key; the existing
  `analysis.signals.source_weights` key's lifecycle (retain, deprecate description, never silently
  reinterpret its type) follows the pattern the ledger already flags as load-bearing
  (`fails.md` 2026-08-06, `100-account-trading-halt-and-kill-switch`).
- `C-07` (migration naming) — honored: `010_add_signal_source_reliability_weight` in
  `services/xstockstrat-ingest/migrations/`, next after `009_signal_dedup_keys`.
- `C-09` (proto verification) — honored: `buf lint`/`buf breaking` + `./scripts/buf-gen.sh` required
  at `/sdd-spec`/execute time for the new `optional double` field; `uv.lock` re-checked in
  analysis/indicators/ingest per the `fails.md` 2026-08-05 `grpcio` mismatch precedent.
- `C-10(b)` (parity across shared/duplicated surfaces) — honored: `signal_axis`'s only computation
  site is `_compute_opportunities` (confirmed no second computation path, `opportunities.py` is
  persistence-only); the replace ensures `ScreenSymbols` and the Opportunities queue read the *same*
  weight value instead of two independent ones.
- `C-12` (frontend test-data inventory) — honored: new `e2e/fixtures/signalSources.ts` +
  `INVENTORY.md` row tracked as an Open Risk, required in the same step as the new e2e coverage.
- `C-14` (name the consumer surface) — honored: `/config-ui` named and scoped explicitly (inline-edit
  cell only, not the full edit form); the Opportunities queue's ranking-order change is named as an
  existing-display-path consequence, not a new UI element.
- `P-01`/`P-02` (single-orchestrator authority, no lateral subagent coordination) — honored: all four
  rounds' proposer/adversary pairs were mediated exclusively through synthesized state passed by this
  orchestrator; no subagent wrote a file.
- `P-03` (no silent deviation) — honored: every fork (FR-4 replace-vs-override, clamp-vs-reject,
  in-call-memo-vs-fresh-fetch, DB CHECK) was surfaced and explicitly decided across the debate, none
  defaulted silently; round-4's proposer explicitly flagged its own uncertainty about un-resupplied
  prior-round text rather than confabulating continuity.
- `F-01`/`F-08` (migration/file-scope discipline) — honored: no applied migration edited;
  `010`/config-registration migrations are new numbered files.
- No `F-*` breach was flagged at any round.
