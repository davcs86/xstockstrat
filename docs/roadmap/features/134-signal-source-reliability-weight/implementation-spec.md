# Implementation Spec: signal-source-reliability-weight

**Status**: `pending`
**Created**: 2026-08-14
**Feature**: `docs/roadmap/features/134-signal-source-reliability-weight/feature.md`
**Total Steps**: 11
**Feature Branch**: `feature/signal-source-reliability-weight`

---

## Execution Summary

The change flows proto → codegen → ingest DB/service/tests → analysis service/tests → UI
service/tests → config-key description migration → docs, because every downstream surface depends on
the regenerated `SignalSource.reliability_weight` field. The proto field and its stubs (Steps 1–2)
must land first; the ingest write path (Steps 3–5) makes the field persistable and readable; the
analysis read path (Steps 6–7) applies it to `signal_axis` and — per design.md's genuine-replace
resolution of FR-4 — repoints `ScreenSymbols` off `analysis.signals.source_weights` onto the same
new `_drain_source_weights` helper; the `/config-ui` surface (Steps 8–9) is the named C-14 consumer
(the existing Sources-page weight column becomes read/write). Step 10 reword-migrates the now-inert
config key's registered description, and Step 11 fixes the two doc-drift sites the replace falsifies.

## Step Dependencies

- Step 2 (proto-gen) requires Step 1 (proto): stubs regenerate the new field.
- Step 3 (ingest migration) is independent of proto but must land before Step 5's tests exercise the
  column; group it with the ingest service step.
- Step 4 (ingest service) requires Steps 2 + 3: reads `src.reliability_weight` off the regenerated
  message and writes the new DB column.
- Step 5 [test] covers Step 4 [service] (ingest).
- Step 6 (analysis service) requires Step 2 (regenerated `ListSignalSourcesResponse` carrying
  `reliability_weight`). It does **not** require Step 4 at compile time, but the end-to-end weighting
  is only observable once Step 4 persists non-default weights.
- Step 7 [test] covers Step 6 [service] (analysis).
- Step 8 (UI service) requires Step 2 (regenerated TS `SignalSource.reliabilityWeight` +
  `ManageSignalSourceRequest`).
- Step 9 [test] covers Step 8 [service] (UI, Playwright e2e).
- Step 10 (config description migration) must land **after** the Step 6 repoint (the description
  says the key is now unread — false until the repoint lands). No compile dependency.
- Step 11 (docs) depends on the Step 6 repoint being the source of truth (the doc lines it fixes
  assert the key is still read).
- **Consumer surface (C-14):** the product spec names `/config-ui` (Sources page weight column) as
  the only consumer surface — covered by Steps 8–9. The Opportunities queue (`/insights`) ranking
  shift is an existing-display-path consequence with no new UI element (design.md § Consumer
  surface), so no `/insights` step is required. `022-signal-time-decay` is the named follow-up that
  composes decay into this feature's `signal_axis` expression (FR-6; `merge-order.md`), explicitly
  deferred — not omitted.
- **Cross-service `uv.lock` trap** (fails.md 2026-08-05, feature 007): Step 2 re-checks `uv.lock` in
  `xstockstrat-analysis`, `xstockstrat-indicators`, and `xstockstrat-ingest` after regenerating
  stubs, because a `grpcio` floor bump in the regenerated stubs surfaces only at test-import time.

---

### Step 1 — proto: Add `reliability_weight` field to `ingest.SignalSource`

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/ingest/v1/ingest.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness per message, no breaking change without deprecation, `buf lint`/`buf breaking`; `xstockstrat-ingest` owner — newsletter source schema stability

**Codebase Evidence**:
- Confirmed via `sed -n '135,160p' packages/proto/ingest/v1/ingest.proto`: `message SignalSource`
  declares fields `slug=1 … signals_fed=11`; **field 12 is free, no `reserved` block**.
- Explicit-presence precedent for a `[0,1]` double: `ExternalSignal.conviction = 4` (`ingest.proto`,
  `// 0.0 – 1.0 confidence`). design.md requires `optional` (explicit presence) so an omitted field
  on the create form is distinguishable from an explicit `0.0` and `HasField` is callable — the
  register/update merge in Step 4 depends on it.

**TDD**: `N/A (proto)`

**Instructions**:
1. In `message SignalSource`, after `int64 signals_fed = 11;`, add a commented, explicit-presence field:
   ```proto
   // reliability_weight ∈ [0.0, 1.0] — per-source ranking multiplier applied to signal
   // conviction (feature 134). optional (explicit presence) so an omitted create-form field is
   // distinguishable from an explicit 0.0. DB default 1.0 (neutral).
   optional double reliability_weight = 12;
   ```
2. Do **not** touch fields 1–11 or reorder anything (additive-only).

**Verification**:
```bash
cd packages/proto && buf lint && buf breaking --against ".git#branch=feature/signal-source-reliability-weight"
```
Both pass (additive field is non-breaking). `grep -n "reliability_weight" packages/proto/ingest/v1/ingest.proto` shows the new `= 12` field.

---

### Step 2 — proto-gen: Regenerate stubs and re-verify Python lockfiles

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/**` — modify (generated; do not hand-edit)
- `services/xstockstrat-ingest/uv.lock`, `services/xstockstrat-analysis/uv.lock`, `services/xstockstrat-indicators/uv.lock` — modify only if `uv lock --check` reports drift

**Reviewers**: Proto Reviewer — field number uniqueness, `buf` passes; `xstockstrat-ingest` owner (inherited from Step 1)

**Codebase Evidence**:
- Generator entry point: `scripts/buf-gen.sh` (root CLAUDE.md § Generating Proto Stubs — "generates
  TypeScript, Python, and Go stubs and compiles the TS package").
- Trap: fails.md 2026-08-05 (feature 007, `signal-source-weighting`) — regenerated stubs required
  `grpcio>=1.80.0` while three Python services' `uv.lock` lagged at `1.78.0`, surfacing only at
  test-import time across `analysis`/`indicators`/`ingest`.

**TDD**: `N/A (proto-gen)`

**Instructions**:
1. Run `./scripts/buf-gen.sh` from repo root.
2. Confirm the only Go/Python/TS stub diff is the additive `reliability_weight` accessor/field on
   `SignalSource` (no unrelated churn).
3. In each of `services/xstockstrat-ingest`, `services/xstockstrat-analysis`,
   `services/xstockstrat-indicators`, run `uv lock --check`. If it fails, run `uv lock` in that
   service and commit the updated `uv.lock` in this step (per the root CLAUDE.md Python uv lock rule
   and the feature-007 grpcio trap).

**Verification**:
```bash
./scripts/buf-gen.sh
git status --porcelain packages/proto/gen/ | head          # only reliability_weight-related changes
for s in ingest analysis indicators; do (cd services/xstockstrat-$s && uv lock --check); done
```
`uv lock --check` exits 0 in all three services (or the regenerated `uv.lock` is committed here).

---

### Step 3 — migration: Add `reliability_weight` column to `ingest.signal_sources`

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/migrations/010_add_signal_source_reliability_weight.up.sql` — create
- `services/xstockstrat-ingest/migrations/010_add_signal_source_reliability_weight.down.sql` — create

**Reviewers**: DBA — migration NNN numbering (no gaps/conflicts), up+down pair present, column default correctness; `xstockstrat-ingest` owner — signal-source schema stability

**Codebase Evidence**:
- Confirmed via `ls services/xstockstrat-ingest/migrations/`: highest is `009_signal_dedup_keys` →
  next is `010`. **Re-verify `010` is still free immediately before `/sdd-execute` runs** (no
  sibling in-flight feature claimed it), per feature-workflow.md § Feature Numbering.
- Additive-`ALTER TABLE` template: `migrations/008_signal_source_health.up.sql` (feature 083 added
  `last_seen_at`/`last_error`/`signals_fed` the same way).
- DB `CHECK` precedent for a `[0,1]` double: `conviction` carries `CHECK (conviction BETWEEN 0 AND
  1)` (`migrations/001_newsletter_signals.up.sql:14`; confirmed via `grep -n conviction …/001…`).
  design.md § Chosen Approach keeps the CHECK as defense-in-depth against any write path outside
  `ManageSignalSource`.

**TDD**: `N/A (migration)`

**Instructions**:
1. `010_add_signal_source_reliability_weight.up.sql`:
   ```sql
   ALTER TABLE ingest.signal_sources
     ADD COLUMN reliability_weight DOUBLE PRECISION NOT NULL DEFAULT 1.0
       CHECK (reliability_weight BETWEEN 0 AND 1);
   ```
2. `010_add_signal_source_reliability_weight.down.sql`:
   ```sql
   ALTER TABLE ingest.signal_sources DROP COLUMN reliability_weight;
   ```
   (Dropping the column removes the CHECK with it.)

**Verification** (offline, no DB):
```bash
ls services/xstockstrat-ingest/migrations/010_add_signal_source_reliability_weight.up.sql \
   services/xstockstrat-ingest/migrations/010_add_signal_source_reliability_weight.down.sql
```
Read both: the `.up` `ADD COLUMN` is reversed by the `.down` `DROP COLUMN`. The real apply/rollback runs in CI/deploy.

---

### Step 4 — service: Persist and return `reliability_weight` in the ingest write/read paths

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/handlers/servicer.py` — modify
- `services/xstockstrat-ingest/app/repositories/signal_sources.py` — modify

**Reviewers**: `xstockstrat-ingest` owner — signal normalization correctness, idempotent ingestion, newsletter source schema stability

**Codebase Evidence**:
- Mask constants: `servicer.py:41` `_SS_MASKABLE_PATHS = frozenset({...})` (confirmed via grep);
  `_use_req(field)` helper at `servicer.py:1132`.
- Register branch: `servicer.py:1082-1108` — resolves `cfg_dict`/`merged_cred`, calls
  `insert_source(self._db, slug=…, active=True)` with **keyword** args.
- Update branch: `servicer.py:1109-1174` — mask-gated merges (`merged_display = src.display_name if
  _use_req("display_name") else stored["display_name"]`, etc.), then `update_source(self._db, …)`.
- `ManageSignalSourceResponse` row build: `servicer.py:1178` `result = ingest_pb2.SignalSource(slug=…,
  config_json=cfg_out)` — reached by all four operation branches.
- `ListSignalSources` row build: `servicer.py:1027` `source = ingest_pb2.SignalSource(… health=…,
  signals_fed=…)`.
- Repo: `insert_source` (`signal_sources.py:94`) INSERT columns `(slug, display_name, source_type,
  extractor_module, credentials_ref, config_json, active)` with positional args
  `query(0)…config_param(6), active(7)`; `update_source` (`signal_sources.py:125`) SET list;
  `list_all_sources` (`signal_sources.py:43`) explicit `cols` string ending `…last_error,
  signals_fed`. `get_source` (`signal_sources.py:88`) is `SELECT *` — auto-picks the new column.
- Reject-at-write precedent (chosen over the config blob's read-time clamp): `conviction` at
  `servicer.py:719-725` (`if not (0.0 <= signal.conviction <= 1.0): abort(INVALID_ARGUMENT, …)`).

**TDD**: `red-green required`

**Instructions**:
1. **Repo `insert_source`** (`signal_sources.py:94`): add a required kwarg `reliability_weight: float`
   (place it **last**, after `active`, in the signature). Extend the INSERT column list to
   `(…, config_json, active, reliability_weight)` and add `$8`, passing `reliability_weight` as the
   **last positional arg after `active`** — this keeps the existing test's `call_args[0][6]`
   (config_param) index valid (design.md Open Risk; test at `test_signal_sources.py:277`).
2. **Repo `update_source`** (`signal_sources.py:125`): add required kwarg `reliability_weight: float`;
   extend the SET clause with `reliability_weight = $7` and pass it as the trailing positional arg.
3. **Servicer register branch** (`servicer.py:1082-1108`): before calling `insert_source`, resolve a
   concrete float — **never `None`** (a bound `NULL` on the `NOT NULL` column raises
   `NotNullViolationError` because the column is named in the INSERT; design.md Rejected Alternatives):
   ```python
   weight = _resolve_reliability_weight(src)  # HasField → validated value; else 1.0
   ```
   where the resolver rejects out-of-range with `INVALID_ARGUMENT` (mirror `conviction`,
   `servicer.py:719-725`): `if src.HasField("reliability_weight") and not (0.0 <= src.reliability_weight <= 1.0): abort`.
   Pass `reliability_weight=weight` to `insert_source`.
4. **Servicer update branch** (`servicer.py:1109-1174`): add `"reliability_weight"` to
   `_SS_MASKABLE_PATHS` (`servicer.py:41`) as a pure additive entry. Compute the masked merge:
   ```python
   merged_weight = (
       _validate_weight(src.reliability_weight) if src.HasField("reliability_weight")
       else stored["reliability_weight"]
   ) if _use_req("reliability_weight") else stored["reliability_weight"]
   ```
   Pass `reliability_weight=merged_weight` to `update_source`. Reject an out-of-range explicit value
   with `INVALID_ARGUMENT`.
5. **Both row builds** — add `reliability_weight=row["reliability_weight"]` to the
   `ingest_pb2.SignalSource(...)` construction at `servicer.py:1178` (ManageSignalSource) **and**
   `servicer.py:1027` (ListSignalSources), so the post-save/read UI state carries the field without a
   refetch (design.md § Ingest write path).
6. **`list_all_sources` cols** (`signal_sources.py:43`): append `reliability_weight` to the `cols`
   string so the SELECT returns it for `ListSignalSources`.
7. Keep the reject/validate logic as an inline helper — do **not** extract a shared range-validator
   module (design.md Rejected Alternatives: scope-creep guard; `conviction` is also inline).

**Verification** (see Step 5 for tests):
```bash
cd services/xstockstrat-ingest && ruff check . && ruff format --check .
grep -n "reliability_weight" app/handlers/servicer.py app/repositories/signal_sources.py
```
No new outbound gRPC call is added in this step (header propagation N/A). Behavioral/coverage assertions run in Step 5.

---

### Step 5 — test: ingest write-path + zero-weight persistence coverage

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/test_signal_sources.py` — modify (repo-layer tests)
- `services/xstockstrat-ingest/tests/` — modify/add servicer-layer tests (register/update reliability_weight)

**Reviewers**: `xstockstrat-ingest` owner — idempotent ingestion, signal-source schema stability

**Codebase Evidence**:
- Existing repo tests needing the new required kwarg at their `insert_source`/`update_source` call
  sites (confirmed via grep): `test_insert_is_a_plain_insert_no_conflict` (`:245`),
  `test_insert_config_json_passed_as_json_text` (`:265`, asserts `db.fetchrow.call_args[0][6]` =
  config_param — index preserved because Step 4 appends `reliability_weight` after `active`),
  `test_update_writes_merged_columns_and_never_active` (`:282`).
- C-13 (non-frontend fixtures): this service's canonical home is `tests/conftest.py`. Only add a
  fixture there if a domain literal gains a **second** consumer this step; otherwise inline is
  compliant — record that verdict.

**TDD**: `red-green required`

**Instructions**:
1. Update the three existing repo tests to pass `reliability_weight=` at their `insert_source`/
   `update_source` call sites (kwarg is now required). Confirm `call_args[0][6]` still resolves to
   config_param in `test_insert_config_json_passed_as_json_text`.
2. Add the two named regression tests design.md § Open Risks (Test churn) mandates, guarding the
   explicit-zero trap the `optional` field exists to prevent:
   - `test_manage_signal_source_register_explicit_zero_weight_persists_as_zero` — a register with an
     explicit `reliability_weight=0.0` persists `0.0` (not the `1.0` default).
   - `test_manage_signal_source_update_explicit_zero_weight_persists_as_zero` — a masked update to
     `reliability_weight=0.0` persists `0.0`.
   These fail red before Step 4 (the field/kwarg does not exist) and pass green after.
3. Add a servicer test that an out-of-range explicit weight (e.g. `1.5`) is rejected with
   `INVALID_ARGUMENT`, and that a register **without** the field defaults to `1.0`.
4. State the C-13 verdict explicitly (single- vs second-consumer) for any signal-source literal used.

**Verification**:
```bash
cd services/xstockstrat-ingest && ruff check . && ruff format --check . && pytest --cov=app --cov-fail-under=40
```
Coverage ≥ 40%; the two zero-weight tests and the out-of-range test are green (and were red before Step 4).

---

### Step 6 — service: Apply `reliability_weight` in the analysis read paths (genuine FR-4 replace)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Signal-axis write: `servicer.py:2163` `c["signal_axis"] = max(c["signal_axis"], sig.conviction)`
  inside `_compute_opportunities` (confirmed via grep). `propagation_meta` is in scope here (the
  sibling `_drain_active_signals(propagation_meta)` etc. are called at `servicer.py:2098-2100`).
- Fresh-fetch-per-call pattern to mirror: `_drain_active_signals` (`servicer.py:2358-2380`) —
  best-effort `self._ingest.QuerySignals(…, metadata=propagation_meta)` wrapped in
  `try/except grpc.RpcError → log.warning → return out`.
- Ingest stub already wired: `self._ingest = ingest_pb2_grpc.IngestServiceStub(ingest_channel)`
  (`servicer.py:132`); `ListSignalSources` is **not** called anywhere in analysis today (confirmed —
  only `QuerySignals` at `:2366,:2447`). No new channel/edge.
- `ScreenSymbols` current config-blob read: `servicer.py:1890-1901` builds `source_weights` from
  `self._cfg.get_str("analysis.signals.source_weights", …)` and passes it to `ScreenerEngine(…,
  source_weights)`; `propagation_meta` already built at `servicer.py:1885`.
- Weight consumer: `scoring.compute_signal_score(…, source_weights)` clamps with
  `(source_weights or {}).get(source, 1.0)` (`scoring.py:23`); called from `screener.py:235-236`.
  `sig.source`/the `signals_map` source key is the source **slug** — the same key as
  `SignalSource.slug`.
- Cardinal-field re-confirmation (fails.md 2026-08-05, `023-position-sizing-engine`): the multiplied
  input `sig.conviction` here is `ExternalSignal.conviction` (`ingest.proto`, `// 0.0 – 1.0
  confidence`) — the correct cardinal field, **not** `Opportunity.conviction` (ordinal).
- **Header propagation (C-03):** the new `ListSignalSources` call reuses the same
  `metadata=propagation_meta` mechanism as the adjacent `QuerySignals` calls (Python per-method
  metadata; `docs/patterns/header-propagation.md`), forwarding `x-user-id`/`x-access-scope`/`x-trace-id`.

**TDD**: `red-green required`

**Instructions**:
1. Add a `_drain_source_weights(self, propagation_meta) -> dict[str, float]` helper shaped exactly
   like `_drain_active_signals` (`servicer.py:2358`): a single, unpaginated
   `self._ingest.ListSignalSources(ingest_pb2.ListSignalSourcesRequest(include_inactive=True),
   metadata=propagation_meta)` call, best-effort (`except grpc.RpcError: log.warning(...); return
   {}`), returning `{src.slug: src.reliability_weight for src in resp.sources}`.
2. In `_compute_opportunities`, fetch the weight map once alongside the other `_drain_*` calls
   (near `servicer.py:2098-2100`): `weights = await self._drain_source_weights(propagation_meta)`.
   Change the `signal_axis` write at `servicer.py:2163` to
   `c["signal_axis"] = max(c["signal_axis"], sig.conviction * weights.get(sig.source, 1.0))` — the
   `.get(source, 1.0)` neutral default mirrors `scoring.py:23`.
3. **FR-4 genuine replace** in `ScreenSymbols` (`servicer.py:1890-1901`): remove the
   `self._cfg.get_str("analysis.signals.source_weights", …)` read + JSON parse/clamp block and set
   `source_weights = await self._drain_source_weights(propagation_meta)` instead, then pass that into
   `ScreenerEngine(self._marketdata, self._indicators, self._ingest, self._cfg, source_weights)`
   unchanged. Both read paths now share the one helper (design.md § Analysis read path). Do **not**
   change `scoring.py`/`screener.py` — the dict shape they consume is unchanged.

**Verification** (see Step 7 for tests):
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check .
grep -n "reliability_weight\|_drain_source_weights\|ListSignalSources\|metadata=propagation_meta" app/handlers/servicer.py
grep -n "source_weights" app/handlers/servicer.py   # confirm the analysis.signals.source_weights config read is gone
```
The new `ListSignalSources` call carries `metadata=propagation_meta` (header propagation confirmed). No `self._cfg.get_str("analysis.signals.source_weights"…)` remains.

---

### Step 7 — test: analysis weighting + repoint coverage

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/` — modify/add servicer tests
- `services/xstockstrat-analysis/tests/conftest.py` — modify only if a signal-source literal gains a second consumer (C-13)

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility, strategy scoring determinism

**Codebase Evidence**:
- Acceptance Criterion 2: a source weighted `0.5` contributes half the `signal_axis` of an otherwise
  identical `1.0`-weighted source, all else equal (product-spec.md AC-2). Target: the `signal_axis`
  expression at `servicer.py:2163` via `_compute_opportunities`.
- `_drain_source_weights` mirrors `_drain_active_signals` (`servicer.py:2358`) — test the best-effort
  empty-on-RpcError contract like existing drain tests.
- C-13 home: `tests/conftest.py` (Python). Add a fixture only on a second consumer this step.

**TDD**: `red-green required`

**Instructions**:
1. Test `_drain_source_weights`: returns `{slug: weight}` from a mocked `ListSignalSources`, and
   returns `{}` on `grpc.RpcError` (best-effort), asserting the queue still computes.
2. Test AC-2: with a mocked ingest returning one source at `reliability_weight=0.5` and an
   otherwise-identical signal, the candidate's `signal_axis` is half of the `1.0`-weighted case
   (`sig.conviction * 0.5`). This fails red before Step 6 (raw `sig.conviction`, no weight) and
   passes green after.
3. Test the ScreenSymbols repoint: `ScreenSymbols` no longer reads
   `analysis.signals.source_weights` from config and instead sources weights from
   `ListSignalSources` (assert the `ScreenerEngine` receives the ingest-derived map; assert the
   config getter is not called for that key).
4. State the C-13 single-vs-second-consumer verdict for any signal-source literal used.

**Verification**:
```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check . && pytest --cov=app --cov-fail-under=40
```
Coverage ≥ 40%; AC-2 half-weight test and the repoint test are green (and were red before Step 6).

---

### Step 8 — service: `/config-ui` Sources page weight column becomes read/write against `reliability_weight`

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/config-ui/hooks/useSignalSources.ts` — modify
- `services/xstockstrat-ui/src/app/config-ui/sources/page.tsx` — modify

**Reviewers**: `xstockstrat-ui` owner — config mutation safety, Connect-RPC call safety, no direct DB access

**Codebase Evidence**:
- `useSignalSources.ts` currently `Promise.all`s `ingestClient.listSignalSources(...)` **and**
  `configClient.listKeys({namespace:'analysis',…})`, parsing `analysis.signals.source_weights`'s
  `currentValue` JSON into a `weights: Record<string,number>` map (confirmed by reading the file).
- Weight cell: `sources/page.tsx:344` `<TableCell>{weights[src.slug] ?? 1.0}</TableCell>` — read-only.
- Masked-update precedent already in this file: `sources/page.tsx:229-243` builds
  `updateMask.paths: ['display_name','source_type','extractor_module','config_json', …credentials_ref]`
  for the edit form (snake_case backend field names).
- Mutation wrapper: `useSignalSourceMutations.ts` `useManageSignalSource()` — generic
  `ingestClient.manageSignalSource(req)` typed off the client param, `invalidateQueries(['signal-sources'])`
  on success. Supports arbitrary fields; no hardcoded list.
- Inline-edit shell to reuse (shell only): `config-ui/[namespace]/NamespaceEditor.tsx` — `useState`
  editing-key/value (`:63-65`), `<Input>` (`:9,:182,:199`), Save/Cancel buttons (`:252,:265`).
  **Do not** reuse `validateFloatMap` (`:39`) — it `JSON.parse`s a map and cannot validate a bare
  scalar (design.md Rejected Alternatives); write a 2-line `[0,1]` scalar check instead.
- Regenerated field name (Step 2): protobuf-es camelCase → `src.reliabilityWeight`; backend mask path
  is snake_case `reliability_weight`.

**TDD**: `red-green required` (verified via the Step 9 Playwright e2e)

**Instructions**:
1. `useSignalSources.ts`: drop the `configClient.listKeys(...)` combine step and the `weights`
   map/parse. Return just `sources` from `ingestClient.listSignalSources({includeInactive:true})`;
   the weight now lives on each `SignalSource` as `reliabilityWeight`. Update the hook's return type
   (remove `weights`).
2. `sources/page.tsx`: replace the read-only weight cell (`:344`) with a click-to-edit inline control
   reusing only the `NamespaceEditor` shell shape (local editing-slug + edit-value `useState`,
   `<Input>`, Save/Cancel). Display `src.reliabilityWeight ?? 1.0` when not editing.
3. Add a bespoke scalar validator (reject non-numeric or outside `[0,1]`) — a ~2-line check, not
   `validateFloatMap`.
4. On Save, call `useManageSignalSource().mutate` with `operation:'update'`, `source:{slug, reliabilityWeight: parsed}`,
   and `updateMask:{paths:['reliability_weight']}` — following the existing masked-update pattern at
   `:229-243`. `onSuccess` already invalidates `['signal-sources']`, so the cell re-reads the saved value.
5. Leave `formFromSource`/`FormState` (the full edit modal) untouched — the weight is edited only via
   the inline cell (design.md § Consumer surface; scope guard).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint
grep -n "reliabilityWeight\|reliability_weight" src/app/config-ui/sources/page.tsx src/app/config-ui/hooks/useSignalSources.ts
grep -n "source_weights\|listKeys" src/app/config-ui/hooks/useSignalSources.ts   # config-blob combine removed
```
Behavioral proof runs in Step 9 (Playwright).

---

### Step 9 — test: `/config-ui` Sources weight inline-edit e2e + fixture centralization (C-12)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/config-ui/sources.spec.ts` — modify (add inline-edit-weight test)
- `services/xstockstrat-ui/e2e/fixtures/signalSources.ts` — create (C-12 fixture module)
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify (catalog row)
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify (`listSignalSources`/`manageSignalSource` carry `reliabilityWeight`)

**Reviewers**: `xstockstrat-ui` owner — analytics/config display accuracy, Connect-RPC call safety

**Codebase Evidence**:
- Existing spec + pattern to extend: `e2e/config-ui/sources.spec.ts` already drives
  Actions→Edit→Save→`page.waitForRequest((r) => r.url().includes('/ManageSignalSource') …)`
  (`:195-201,:237-238`; feature 088) — the closest DRY fit for the new inline-edit test
  (design.md Rejected Alternatives explicitly rejects placing it in `value-persists-after-save.spec.ts`).
- Signal-source mock is inline today: `e2e/mock-backend.ts:882` `async listSignalSources()` /
  `:910 manageSignalSource()`, with `signalsFed: BigInt(128)` inline literals.
- C-12: `INVENTORY.md:60` currently lists Signal sources as `e2e/mock-backend.ts (…)` — "not yet
  centralized". This feature is the **second** consumer of that domain (edit-weight cell), which
  forces centralization into `e2e/fixtures/signalSources.ts` + an updated `INVENTORY.md` row in this
  same step (design.md § Open Risks C-12; recon.md Risks).

**TDD**: `red-green required`

**Instructions**:
1. Create `e2e/fixtures/signalSources.ts` exporting the signal-source fixture objects currently
   inline in `mock-backend.ts:882-923` (Connect-JSON camelCase shape), including a
   `reliabilityWeight` field (e.g. one source at `0.5`, one at default `1.0`). Distinct values so the
   assertion is meaningful (insights.md 2026-07-27 — a fixture whose fields all equal each other
   tests nothing).
2. Update `mock-backend.ts` `listSignalSources`/`manageSignalSource` to import from the new fixture
   module and echo the saved `reliabilityWeight` back on `manageSignalSource` (so the round-trip is
   observable).
3. Update `INVENTORY.md:60` to point Signal sources at `e2e/fixtures/signalSources.ts`.
4. Add a `sources.spec.ts` test: open the weight cell inline editor, change the value, Save, assert a
   `waitForRequest('/ManageSignalSource')` whose body carries `updateMask.paths:['reliability_weight']`
   and the new `reliabilityWeight`, then assert the cell re-renders the saved value on reload. Import
   fixtures from `../fixtures` and auth from `e2e/helpers/auth.ts` (no inline domain literals).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint
grep -n "from '../fixtures'\|from '../../fixtures'\|helpers/auth" e2e/config-ui/sources.spec.ts
grep -n "signalSources" e2e/fixtures/INVENTORY.md e2e/mock-backend.ts
pnpm test:e2e -- sources.spec.ts    # inline-edit-weight test passes (was red before Step 8)
```
The new test is green after Step 8 and red before it; `INVENTORY.md` points at the new fixture module.

---

### Step 10 — migration: Mark `analysis.signals.source_weights` description as superseded (config service)

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/migrations/016_deprecate_analysis_signal_source_weights_desc.up.sql` — create
- `services/xstockstrat-config/migrations/016_deprecate_analysis_signal_source_weights_desc.down.sql` — create

**Reviewers**: DBA — migration NNN numbering (no gaps/conflicts), up+down pair present; `xstockstrat-config` owner — config key naming, WatchConfig stream stability

**Codebase Evidence**:
- Confirmed via `ls services/xstockstrat-config/migrations/`: highest is `015_marketdata_finnhub` →
  next is `016`. **Re-verify `016` is still free immediately before `/sdd-execute`.**
- The key is seeded by `003_analysis_signal_source_weights.up.sql` (dev + production rows,
  `ON CONFLICT DO NOTHING`) with description `'JSON object mapping signal source name to reliability
  weight in [0.0, 1.0]. Empty object means all sources use weight 1.0 (neutral).'`. **F-01 forbids
  editing the applied `003` migration** — add a new numbered UPDATE migration instead.
- Design intent (design.md § Config-key deprecation): the key is retained (Out-of-Scope forbids
  deletion) but genuinely unread after Step 6's repoint; only its registered description changes to
  say so. Editable-but-inert is an accepted trade-off (Open Risks), documented via the description,
  never a suppression mechanism.

**TDD**: `N/A (migration)`

**Instructions**:
1. `016_..._desc.up.sql`: `UPDATE config.config_values SET description = '<superseded text>' WHERE
   namespace='analysis' AND key='signals.source_weights';` — new text states the weight now lives on
   `ingest.SignalSource.reliability_weight` (feature 134) and this key is no longer read by any
   service (still editable but inert).
2. `016_..._desc.down.sql`: `UPDATE … SET description = '<original text from 003>' WHERE …` restoring
   the exact original description.
3. Do not change `value_type`/`value_data`/bounds (fails.md 2026-08-06 — never change a key's
   `value_type` in place; here nothing but the description changes).

**Verification** (offline, no DB):
```bash
ls services/xstockstrat-config/migrations/016_deprecate_analysis_signal_source_weights_desc.up.sql \
   services/xstockstrat-config/migrations/016_deprecate_analysis_signal_source_weights_desc.down.sql
```
Read both: the `.up` UPDATE is reversed by the `.down` UPDATE (original description restored). Real apply/rollback runs in CI/deploy.

---

### Step 11 — docs: Fix the two doc-drift sites the FR-4 replace falsifies

**Status**: `pending`
**Service**: `docs` / `xstockstrat-analysis`
**Files**:
- `docs/patterns/config-governance.md` — modify
- `services/xstockstrat-analysis/CLAUDE.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `docs/patterns/config-governance.md` (feature-097 section, confirmed via grep): "`analysis.signals.source_weights`
  is **unchanged** (stays the screener's)" — false once Step 6 repoints `ScreenSymbols` off it.
- `services/xstockstrat-analysis/CLAUDE.md:169`: the `analysis.signals.source_weights` config-key
  table row ("…Values outside [0.0, 1.0] are clamped at read time.") — false after the replace (the
  key is no longer read; weights now come from `ingest.SignalSource.reliability_weight`, reject-at-write).
  `:192` also references it ("stays the screener's").
- Repo teardown rule (root CLAUDE.md): a session that changes behavior a context/doc describes must
  reconcile the doc in the **same PR**; run `/context-scrubber scan` scoped to what was touched.

**TDD**: `N/A (docs)`

**Instructions**:
1. Reword the `config-governance.md` feature-097 line so it no longer claims
   `analysis.signals.source_weights` is unchanged/still the screener's; state it is superseded by
   `ingest.SignalSource.reliability_weight` (feature 134) and now inert.
2. Update `services/xstockstrat-analysis/CLAUDE.md:169` (and the `:192` mention): the screener and
   Opportunities queue now weight signals by `ingest.SignalSource.reliability_weight` (validated
   reject-at-write in `[0,1]`), and `analysis.signals.source_weights` is retained-but-unread. Fix the
   "clamped at read time" claim.
3. Run `/context-scrubber scan` scoped to the touched docs (or, if the context-forge plugin is
   unavailable in the session, note that in the PR body per the teardown rule) and fix grounded findings.

**Verification**:
```bash
grep -n "unchanged\|stays the screener" docs/patterns/config-governance.md
grep -n "source_weights\|reliability_weight\|clamped at read time" services/xstockstrat-analysis/CLAUDE.md
```
Neither file still asserts `analysis.signals.source_weights` is read/authoritative.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
