# Implementation Spec: wire-signal-confidence-to-position-sizing

**Status**: `done`
**Created**: 2026-08-31
**Feature**: `docs/roadmap/features/110-wire-signal-confidence-to-position-sizing/feature.md`
**Total Steps**: 8
**Feature Branch**: `feature/wire-signal-confidence-to-position-sizing`

---

## Execution Summary

Threads the raw per-signal `ExternalSignal.conviction` to the live signal-detail order ticket via a
single additive `analysis.Opportunity` field, populated from the reducer the opportunity queue already
computes, and gives **only** that ticket a scoped blank-qty affordance routing into feature 023's
`qty <= 0` auto-sizing path. Order: proto field (1) → codegen (2) → analysis populate + paired test
(3–4) → UI `OrderForm` prop (5) → UI render-site wiring (6) → orphan deletion + e2e spec updates (7) →
UI e2e behavior tests (8). `xstockstrat-ingest` (source) and `xstockstrat-trading` (023's consumer)
need **no** code change — confirmed at recon (`trading.go:457-490` already reads `confidence` on
`qty <= 0`). No migration (the value rides the existing `readiness_json` JSONB column — OR-3 resolved
to the no-column path). No config key.

**Consumer surface (C-14):** the named surface is the `/trader` unified symbol page's `OrderForm`
(`services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx:342`) — reached by Steps 5–6. The
plain `/trader` and `/trader/orders` forms mount the same component **without** the prop and are
deliberately unchanged (FR-3). The Agent surface is explicitly out of scope (no order-placement tool
exists — product-spec § Out of Scope). No new page/route, so no `NAV_GROUPS` registration is needed
(the symbol page already exists and is nav-reachable).

### Scenario Coverage (Constitution C-15)

| Scenario | Covered by step(s) |
|---|---|
| AC-1 (real per-signal confidence flows, read distinct from ordinal) | Step 4 (producer), Step 8 (UI) |
| AC-2 (higher confidence auto-sizes larger) | Step 8 (distinct confidence values reach PlaceOrder; monotonic sizing is 023's launched contract — see note in Step 8) |
| AC-3 (blank qty → coerced to 0, PlaceOrder qty≤0 + confidence) | Step 8 |
| AC-4 (ordinal conviction not used as the sizing probability) | Step 4 (producer keeps them separate), Step 8 (UI sends the ExternalSignal value) |
| AC-5 (plain /trader form still requires a quantity) | Step 8 |
| AC-6 (/trader/orders keeps required-qty behavior) | Step 8 |
| AC-7 (explicit qty overrides auto-sizing) | Step 8 |
| AC-8 (symbol-page reaches PlaceOrder auto-size path; plain form does not) | Step 8 |
| AC-9 (orphan component + route stub removed, nothing imports) | Step 7 |

## Step Dependencies

- **Step 2 requires Step 1** — codegen regenerates stubs for the new proto field.
- **Step 3 requires Step 2** — analysis needs the generated Python `Opportunity.signal_confidence` field.
- **Step 4 requires Steps 2 + 3** — the parity RED (`test_mapper_covers_every_proto_field`) is provable
  once the field exists in the descriptor (Step 2) and before the mapper carries it (Step 3); the passing
  run follows Step 3.
- **Steps 5 + 6 require Step 2** — the TS stub must expose `signalConfidence?: number`.
- **Step 6 requires Step 5** — the render site passes the prop `OrderForm` gains in Step 5.
- **Step 8 requires Steps 5, 6, 7** — the e2e behavior tests exercise the wired ticket, the plain-form
  scoping, and the removed route.
- **OR-4 (proto field number) — 110 is blocked by feature 095 in the merge-order** (`merge-order.md:66`).
  At the current tree `analysis.Opportunity` maxes at `muted = 12`; 095 (status `implementation-ready`,
  not yet merged) pre-assigns fields 13-18. In the `/sdd-execute … sequential` cohort 095's steps precede
  110's, so Step 1 must **re-derive the next-free field number from the merged tree** (expected `19`).
  Do not hardcode `19` blind: if 095's block shifted, take the next free number after it; if 110 is ever
  executed standalone before 095, the number is `13` and 095 must then rebase above it.

---

### Step 1 — proto: add `signal_confidence` to `analysis.Opportunity`

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/analysis/v1/analysis.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness per message, no breaking change, `buf lint`/`buf breaking` pass; xstockstrat-analysis — no look-ahead / producer contract; xstockstrat-ui — Trading UI correctness (the field's consumer)

**Codebase Evidence**:
- `Opportunity` message: `packages/proto/analysis/v1/analysis.proto:542-555`; current max field is
  `bool muted = 12;` (`:554`). `conviction = 3` (`:545`) is doc-commented "a deterministic ordinal …
  NOT a probability" (`:539-541`) — the field this feature must **not** repurpose.
- Merge-order blocker: `docs/roadmap/features/merge-order.md:66` — 110 adds its field at the next free
  number **after** 095's 13-18 block; `buf breaking` is per-branch and cannot see 095's uncommitted claim.

**TDD**: `N/A (proto)`

**Covers**: —

**Instructions**:
- Add, after `bool muted = 12;` (`:554`), inside the `Opportunity` message:
  ```proto
  // feature 110 — the raw max per-signal ExternalSignal.conviction (0.0–1.0) among the
  // symbol's active signals; the real probability that feeds trading PlaceOrder's confidence
  // sizing. Explicit-presence optional: UNSET means "no active signal for this symbol" (never a
  // fabricated 0.0). Deliberately NAMED signal_confidence and kept distinct from the ordinal
  // `conviction = 3` (NOT a probability) and the decayed/weighted signal_axis.
  optional double signal_confidence = 19;
  ```
- Re-derive `19` from the merged tree per OR-4 (see § Step Dependencies) — it is the next free number
  after feature 095's enrichment block; only `19` if 095 landed with 13-18 unchanged.
- Explicit-presence `optional` (mirrors 095's fields) so absence is a genuine unset (P-03).

**Verification**:
```bash
cd packages/proto && buf lint && buf breaking --against ".git#branch=feature/wire-signal-confidence-to-position-sizing"
```
Both pass (additive field → non-breaking). Confirm no other `Opportunity` field reuses the chosen number.

---

### Step 2 — proto-gen: regenerate stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/**`, `packages/proto/gen/python/**`, `packages/proto/gen/ts/**` — modify (generated)

**Reviewers**: Proto Reviewer — field number uniqueness per message, no breaking change, `buf lint`/`buf breaking` pass; xstockstrat-analysis; xstockstrat-ui (inherited from Step 1)

**Codebase Evidence**:
- Codegen entrypoint: `./scripts/buf-gen.sh` (root `CLAUDE.md` § Generating Proto Stubs — generates TS,
  Python, Go and compiles the TS package).
- Freshness gate: CI `proto-freshness` job diffs `packages/proto/gen/` (root `CLAUDE.md`).

**TDD**: `N/A (proto-gen)`

**Covers**: —

**Instructions**:
- Run `./scripts/buf-gen.sh` from repo root.
- Commit the proto source (Step 1) and all regenerated stubs together in this step's PR.

**Verification**:
```bash
./scripts/buf-gen.sh && git diff --exit-code packages/proto/gen/
```
Empty diff after a second run (stubs match the `.proto`). The Python `Opportunity` message now carries
`signal_confidence`; the TS typed client exposes `signalConfidence?: number`.

---

### Step 3 — service: populate `Opportunity.signal_confidence` in analysis

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: xstockstrat-analysis — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Reducer already computed: `c["_best_sig_conv"]` initialized `-1.0` (`servicer.py:3140`); updated to the
  **max raw** `sig.conviction` across the symbol's active signals (`:3275-3276`, comment "thesis/direction
  on RAW conviction"). This is the platform's established "the raw conviction for this symbol" — reuse it,
  do not invent a second per-symbol reducer (C-10(b); recon § Patterns to REUSE).
- Candidate row build for persistence: `servicer.py:3392-3404` — the `rows.append({...})` dict; `c` is in
  scope (already reads `c["signal_axis"]`, `c["provenance"]`, `c["thesis"]`). `readiness` here is a
  per-candidate dict (`_empty_readiness(sym)` at `:3340` or `evaluate_conditions_traced(...)` at `:3376`),
  stored under key `"readiness_json"` (`:3399`) — safe to add a key without cross-row bleed.
- Persistence carrier: `analysis.opportunities` has **no** `signal_confidence` column; `readiness_json`
  is JSONB and round-trips (`repositories/opportunities.py:56-57` INSERT `readiness_json::jsonb`, `:97-98`
  SELECT, `:24-32` `_to_dict` JSON-decodes it). This is the same JSONB-ride feature 132's `muted` uses via
  `provenance` — OR-3 resolved to **no migration, no DBA gate**.
- Read→proto mapper (single producer↔reader↔UI contract point): `_row_to_opportunity`
  (`servicer.py:3855-3880`) — reads `readiness = row.get("readiness_json")` (`:3860`) and builds the
  `Opportunity`; `muted` is the precedent for a JSONB-derived field (`:3873-3875`).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
- In the candidate row build (`servicer.py:3392-3404`), stash the raw max conviction into the persisted
  `readiness` dict **only when a signal is present**, before it is stored under `"readiness_json"`:
  ```python
  # feature 110 — carry the raw max ExternalSignal.conviction (JSONB-ride via readiness_json,
  # no column). _best_sig_conv stays -1.0 when the symbol had no active signal → leave unset so
  # the Opportunity field is a genuine explicit-presence unset (P-03), never a fabricated 0.0.
  if c["_best_sig_conv"] >= 0.0:
      readiness["signal_confidence"] = c["_best_sig_conv"]
  ```
  (Mutate the per-candidate `readiness` dict before/at the `rows.append` so it persists in the
  `"readiness_json"` value — do not add a top-level row key, which `replace_for_user`'s fixed INSERT column
  list would silently drop.)
- In `_row_to_opportunity` (`servicer.py:3860-3876`), after the existing `Opportunity(...)` construction,
  set the field only when present (explicit-presence — mirrors how `valid_until` is conditionally set at
  `:3877-3879`):
  ```python
  sig_conf = readiness.get("signal_confidence")
  if sig_conf is not None:
      opp.signal_confidence = float(sig_conf)
  ```
- Do **not** touch `signal_axis` (`:3400`, `:3274`) or `conviction` (`:3398`, `:3865`) — they keep their
  existing meanings; the new field is parallel and post-ranking (absent from `opportunities.py:114`
  `ORDER BY`).

**Verification**: covered by Step 4 (paired test). Also `cd services/xstockstrat-analysis && ruff check . && ruff format --check .`.

---

### Step 4 — test: analysis signal_confidence producer + mapper

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify

**Reviewers**: xstockstrat-analysis — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Descriptor-parity guard (the natural RED): `TestOpportunityRowParity` (`test_analysis_servicer.py:4847-4877`)
  asserts `_MAPPED | _INTENTIONALLY_UNSET == set(Opportunity.DESCRIPTOR.fields_by_name)` (`:4868-4871`).
  `_MAPPED` (`:4852-4865`) lists every mapped field incl. `"muted"`; `signal_axis` is intentionally NOT
  present (it is a row key, not an `Opportunity` proto field) — confirming `signal_confidence` is a
  genuinely new exposed field. Adding field 19 (Step 2) makes `test_mapper_covers_every_proto_field` FAIL
  until `_MAPPED` gains `"signal_confidence"` AND the mapper carries it (Step 3).
- Mapper unit test shape to extend: `test_mapper_populates_all_fields` (`:4879-4899`) constructs a `row`
  dict incl. `"readiness_json": {...}` and asserts fields off `_row_to_opportunity(row)`.
- C-13 (test data): domain literals are inline in this file today; a single new inline row is compliant —
  no `conftest.py` fixture home move is triggered (state this verdict in the step).

**TDD**: `red-green required`

**Covers**: AC-1, AC-4

**Instructions**:
- Add `"signal_confidence"` to `TestOpportunityRowParity._MAPPED` (`:4852-4865`) — this is the passing side
  of the parity RED once Step 3's mapper carries the field.
- Extend `test_mapper_populates_all_fields` (or add a sibling test): a `row` whose
  `readiness_json` contains `{"signal_confidence": 0.82, ...}` yields `opp.HasField("signal_confidence")`
  and `abs(opp.signal_confidence - 0.82) < 1e-9`; a `row` whose `readiness_json` omits it yields
  `not opp.HasField("signal_confidence")` (explicit-presence unset). **(AC-1: the real value flows and is
  read distinctly from the ordinal.)**
- Add a compute-selection test over `_compute_opportunities` (mirror the existing feature-132 muted-row
  tests around `:4536-4645` that drive the compute path): for a symbol with **two** active signals of raw
  conviction 0.30 and 0.90, the persisted candidate's `readiness_json["signal_confidence"]` is `0.90`
  (max raw), and it is **independent of** the ordinal `conviction` on that row. **(AC-4: the ordinal is
  not the sizing probability; the raw ExternalSignal value is.)** Also assert a candidate whose symbol has
  **no** active signal leaves `signal_confidence` absent from its `readiness_json`.
- Author each assertion to fail against the pre-Step-3 tree (red-before-green, P-06).

**Verification**:
```bash
cd services/xstockstrat-analysis && pytest --cov=app --cov-fail-under=40 && ruff check . && ruff format --check .
```
Confirm ≥ 40% and the new tests pass. C-13 verdict: the new row literal is single-consumer inline —
compliant, no `conftest.py` move.

---

### Step 5 — service: `OrderForm` scoped `signalConfidence` prop

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/trader/OrderForm.tsx` — modify

**Reviewers**: xstockstrat-ui — Trading UI correctness, Connect-RPC call safety

**Codebase Evidence**:
- Props interface + scoping precedent: `OrderFormProps` (`OrderForm.tsx:41-53`); `allowOfflineRecord?: boolean`
  (`:52`) is the existing explicit-prop scoping precedent, deliberately **not** keyed on `initialSymbol`
  (`:47-51` comment) because the `/trader` symbol page also passes `initialSymbol`.
- Qty input carrying `required`: `<Input type="number" min="0.0001" step="any" placeholder="Quantity" … required />`
  (`OrderForm.tsx:206-214`).
- Submit maps qty: `qty: parseFloat(qty)` (`:108`) inside `handleSubmit` → `placeOrder({...})` (`:101-120`).
  `usePlaceOrder()` at `:96`. The request object (`:102-120`) currently sends no `confidence`.
- NaN-qty trap (recon Risk): `parseFloat('')` = `NaN`, and Go's `NaN <= 0` is **false**
  (`services/xstockstrat-trading/internal/service/trading.go:457`), so a blank qty must be coerced to a
  real `0`, never sent as `NaN`.
- Trading-mode gate: `handleSubmit` already forwards `tradingMode` (`OrderForm.tsx:117`) — this feature does
  **not** change paper/live gating; the backend gate is unaffected (023 consumer at `trading.go` is unchanged).
- Backend contract: `PlaceOrderRequest.confidence = 16` `optional double`
  (`packages/proto/trading/v1/trading.proto:121-123`) — "Unset → 1.0; out-of-range → InvalidArgument";
  read only when `req.Qty <= 0` (`trading.go:457,483-490`). The typed browser client is generated
  camelCase (`confidence?: number`).

**TDD**: `red-green required` (behavioral proof is the e2e step, Step 8 — no unit coverage threshold for `xstockstrat-ui`)

**Covers**: —

**Instructions**:
- Add `signalConfidence?: number;` to `OrderFormProps` (after `:52`), with a comment stating it is the
  scoped signal-detail affordance and mirrors the `allowOfflineRecord` explicit-prop precedent (never keyed
  on `initialSymbol`).
- Destructure it in the component signature (`:55`).
- Compute a gate once: `const hasSignalConfidence = typeof signalConfidence === 'number' && Number.isFinite(signalConfidence) && signalConfidence >= 0 && signalConfidence <= 1;`
  (belt-and-suspenders finite in-[0,1] per recon Risk "Range/validity"; the backend re-guards `[0,1]` at
  `trading.go:487`).
- Qty input (`:206-214`): make `required` conditional — `required={!hasSignalConfidence}` — so the field
  stays required on every mount **without** the prop (FR-3), and only the signal-detail mount can leave it
  blank.
- In `handleSubmit` (`:101-120`): when `hasSignalConfidence`, coerce a blank/NaN qty to `0` and attach
  `confidence`. Concretely: compute `const parsedQty = parseFloat(qty); const submitQty = hasSignalConfidence && !(parsedQty > 0) ? 0 : parsedQty;`
  use `submitQty` for the request `qty`, and add `confidence: hasSignalConfidence ? signalConfidence : undefined`
  to the request object (an `undefined` optional is omitted by the typed client → unset → backend default
  1.0, exactly today's behavior for the plain forms). Do **not** send `NaN`.
- Add a helper affordance visible only when `hasSignalConfidence` (C-17: existing `ui/*` primitives +
  design-role tokens, no hardcoded color, unique accessible text), e.g. helper text
  "Leave quantity blank to auto-size at {Math.round(signalConfidence*100)}% confidence." near the qty input.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint
```
Passes. Behavioral verification is Step 8 (e2e). Confirm by inspection that a mount **without**
`signalConfidence` renders a byte-identical required qty field and sends no `confidence`.

---

### Step 6 — service: wire `signalConfidence` at the symbol-page render site

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx` — modify

**Reviewers**: xstockstrat-ui — Trading UI correctness, Connect-RPC call safety

**Codebase Evidence**:
- The page already reads the queue: `useOpportunities(0)` → `symbolOpportunities` memo filtered by symbol
  (`page.tsx:185-189`). No new fetch/RPC is needed — the new proto field rides the `Opportunity` the page
  already has.
- The render site: `<OrderForm mode={mode} initialSymbol={symbol} allowOfflineRecord={false} />`
  (`page.tsx:342`), inside the "Trade {symbol}" card (`:330-344`).
- Existing per-symbol Opportunity consumption + ordinal-conviction display to preserve unchanged:
  `symbolOpportunities.map(...)` (`:352`) and the conviction render `Math.round(opportunity.conviction * 100)`
  (`:863`, `:884`) — the ordinal rendering must not change (AC-4 second clause).

**TDD**: `red-green required` (behavioral proof is Step 8)

**Covers**: AC-1

**Instructions**:
- Derive a single finite in-[0,1] confidence from the already-computed `symbolOpportunities` (the field is
  per-symbol — the producer sets the same max-raw value on every row for the symbol — so any matched row's
  `signalConfidence` is equivalent). E.g.:
  ```ts
  const signalConfidence = symbolOpportunities
    .map((o) => o.signalConfidence)
    .find((c): c is number => typeof c === 'number' && Number.isFinite(c) && c >= 0 && c <= 1);
  ```
  (Undefined when no matched opportunity carries a signal — a held/watchlist-only or off-queue symbol —
  so the ticket falls back to the ordinary required-qty form; 023's rejected full-risk footgun cannot occur.)
- Pass it into the render site (`:342`): `<OrderForm mode={mode} initialSymbol={symbol} allowOfflineRecord={false} signalConfidence={signalConfidence} />`.
- Do not alter the ordinal `conviction` rendering (`:863,:884`) or the opportunity panels (`:352`).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit
```
Passes (the typed `Opportunity` now exposes `signalConfidence?: number` after Step 2). Behavioral
verification is Step 8.

---

### Step 7 — service: delete the orphaned `SignalOrderTicket` + redirect stub; update coupled e2e specs

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/insights/SignalOrderTicket.tsx` — delete
- `services/xstockstrat-ui/src/app/insights/market/[symbol]/page.tsx` — delete
- `services/xstockstrat-ui/src/components/trader/OrderForm.tsx` — modify (remove stale comment)
- `services/xstockstrat-ui/e2e/nav-reachability.spec.ts` — modify
- `services/xstockstrat-ui/e2e/trader/offline-accounts.spec.ts` — modify

**Reviewers**: xstockstrat-ui — Trading UI correctness, Connect-RPC call safety

**Codebase Evidence**:
- `SignalOrderTicket.tsx` has **zero importers** — repo-wide grep for `SignalOrderTicket` returns only its
  own definition (`components/insights/SignalOrderTicket.tsx:25`), a stale doc-comment in
  `OrderForm.tsx:71`, and a comment in `e2e/trader/offline-accounts.spec.ts:265` (no `import`).
- Redirect-only route: `insights/market/[symbol]/page.tsx:1-22` — `redirect('/trader/positions/${symbol}…')`
  (feature 125), no chart/component render.
- e2e coupling to the route (both `goto` the stub):
  - `e2e/nav-reachability.spec.ts:117-126` — test "the retired Signal-detail route redirects…" `page.goto('/insights/market/AAPL?strategy=strat-live-001')` (`:122`) and asserts the redirect (`:123-125`).
  - `e2e/trader/offline-accounts.spec.ts:257-274` — `@AC-1` test `page.goto('/insights/market/AAPL', …)` (`:266`) asserting the offline-account broker ticket (not "Record Offline Order") renders (`:270-273`); comment at `:265` names `SignalOrderTicket → OrderForm`.
- Comment-only references (no functional coupling — leave untouched): `e2e/mobile-overflow.spec.ts:14`,
  `e2e/trader/position-detail.spec.ts:294`.

**TDD**: `N/A (deletion + test-file update; the AC-9 structural assertion is verified below and by Step 8's suite staying green)`

**Covers**: AC-9

**Instructions**:
- Delete `components/insights/SignalOrderTicket.tsx` and `app/insights/market/[symbol]/page.tsx`.
- Remove the stale doc-comment referencing `SignalOrderTicket` in `OrderForm.tsx:71` (reword to reference
  the live signal-detail mount, or drop the parenthetical).
- `nav-reachability.spec.ts`: the redirect test (`:117-126`) asserts behavior that no longer exists —
  **remove that test** (the route 404s after deletion; the sibling test at `:95-115` already covers the
  live `/trader/positions/[symbol]` reachability and Book-tab active state). Also drop the now-inaccurate
  `:121` comment.
- `offline-accounts.spec.ts`: retarget the `@AC-1` test's navigation (`:266`) from `/insights/market/AAPL`
  to `/trader/positions/AAPL` (the live surface that now mounts `OrderForm` with `allowOfflineRecord={false}`,
  `page.tsx:342`); update the `:265` comment to drop `SignalOrderTicket`. The heading assertions (`:270-273`)
  hold unchanged — this preserves the offline-ticket business rule on the live surface (C-16: rule preserved,
  relocated; deleting dead code regresses no live behavior).

**Verification**:
```bash
cd services/xstockstrat-ui && \
  test ! -e src/components/insights/SignalOrderTicket.tsx && \
  test ! -e "src/app/insights/market/[symbol]/page.tsx" && \
  ! grep -rn "SignalOrderTicket" src e2e && \
  ! grep -rn "insights/market" e2e/nav-reachability.spec.ts e2e/trader/offline-accounts.spec.ts && \
  pnpm run lint
```
All checks pass — no source or spec references `SignalOrderTicket`, and neither updated spec navigates to
the deleted route (AC-9).

---

### Step 8 — test: Playwright e2e for the scoped confidence ticket

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/trader/` — create a new spec (e.g. `signal-confidence-ticket.spec.ts`)
- `services/xstockstrat-ui/e2e/fixtures/opportunities.ts` — modify (add `signalConfidence` to the CAPR rows)
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify (note the new field on the Opportunity fixture)

**Reviewers**: xstockstrat-ui — Trading UI correctness, Connect-RPC call safety

**Codebase Evidence**:
- Fixtures (C-12): `OPPORTUNITIES` in `e2e/fixtures/opportunities.ts`, proto shape
  `xstockstrat.analysis.v1.Opportunity`, includes **two `CAPR` rows** (`quality-dip-buy`/`momentum`, source
  `watchlist`) — `e2e/fixtures/INVENTORY.md:25`. `CAPR` is exactly the symbol the AC scenarios use — extend
  these existing rows, do not inline a new literal.
- Mock backend serves the queue + captures orders: `listOpportunities` filters by min_conviction
  (`e2e/mock-backend.ts:665-671`); `placeOrder` (`:193-209`) stores each request keyed by `clientOrderId`
  in the in-memory `placeOrderIntents` map — the seam to assert the submitted `qty`/`confidence`.
- Auth helper (never re-implement JWT): `addAuthCookie` from `e2e/helpers/auth.ts` (used throughout, e.g.
  `nav-reachability.spec.ts:97`, `offline-accounts.spec.ts:263`).
- Plain-form mounts to prove unchanged (FR-3): `/trader` `src/app/trader/page.tsx` and `/trader/orders`
  `src/app/trader/orders/page.tsx` both `<OrderForm mode={mode} />` (recon Codebase Map) — no
  `signalConfidence` prop.

**TDD**: `red-green required` (authored to fail against the pre-Steps-5/6 tree — the confidence is not
attached and blank qty is not accepted on the symbol page)

**Covers**: AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8

**Instructions**:
- Extend the two `CAPR` rows in `e2e/fixtures/opportunities.ts` with `signalConfidence` (Connect-JSON
  camelCase), and add scenario rows/values as needed: one CAPR context with `signalConfidence: 0.82` and
  ordinal `conviction: 0.95` (AC-3/AC-4), and two symbols with `signalConfidence: 0.9` vs `0.3` (AC-2).
  Where a scenario needs a distinct ordinal-vs-confidence pair beyond the shared fixture, use a
  `{ ...ROW, signalConfidence, conviction }` spread override (scenario one-off — C-12 exempt). Add an
  `INVENTORY.md` note that the Opportunity fixture now carries `signalConfidence` (feature 110).
- Import fixtures and `addAuthCookie` from the canonical homes — no inline JWT, no inline domain literals.
- Author these tests, asserting against the `placeOrder` capture (`mock-backend.ts:193-209`) via a
  per-test `page.route()` or the shared mock's stored intents:
  - **AC-3**: open `/trader/positions/CAPR`, leave qty blank, submit → a `PlaceOrder` request is sent with
    `qty <= 0` (coerced `0`, never `NaN`) and `confidence === 0.82`.
  - **AC-4**: with ordinal `conviction 0.95` + `signalConfidence 0.30` on CAPR, blank-submit → the
    `confidence` sent is `0.30`, not `0.95`; and the page's ordinal conviction render (`page.tsx:884`,
    "N/M conditions"/strength bars) is unchanged.
  - **AC-7**: same ticket, enter qty `50`, submit → `PlaceOrder` sent with `qty === 50` (the `confidence`
    may be present but the override wins — no auto-size).
  - **AC-2**: the `signalConfidence 0.9` symbol and the `0.3` symbol each blank-submit → the two
    `PlaceOrder` requests carry `confidence 0.9` and `0.3` respectively (both `qty <= 0`). **Note:** the
    "strictly larger quantity" (AC-2's monotonic sizing) is feature 023's launched `ComputePositionSize`
    contract (`trading.go:483-490,3165`) which the mock backend does not run; the discriminating **input**
    (distinct confidence to the auto-size path) is what the UI can prove here — assert that, and reference
    023's already-tested sizing monotonicity for the downstream quantity.
  - **AC-5**: open the plain `/trader` order form (no `signalConfidence` prop), leave qty blank, submit →
    HTML5 required-field validation blocks it and **no** `PlaceOrder` request is captured.
  - **AC-6**: same for `/trader/orders`.
  - **AC-8**: assert the pair together — the `/trader/positions/CAPR` blank submit sends a `PlaceOrder`
    routing into the auto-size path (`qty <= 0` + real confidence), while the plain `/trader` blank submit
    sends none (rejected by required validation).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm test:e2e -- signal-confidence-ticket
grep -n "from '../fixtures'\|from '../../fixtures'\|helpers/auth" e2e/trader/signal-confidence-ticket.spec.ts
```
The new spec passes on chromium; the grep confirms fixtures + auth are imported from the canonical homes
(C-12); `INVENTORY.md` updated for the new `signalConfidence` field. `xstockstrat-ui` has no coverage
threshold — e2e coverage applies (spec-template § coverage table).

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
