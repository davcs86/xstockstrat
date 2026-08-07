# Implementation Spec: watchlist-screen-improvements

**Status**: `pending`
**Created**: 2026-08-07
**Feature**: `docs/roadmap/features/110-watchlist-screen-improvements/feature.md`
**Total Steps**: 9
**Feature Branch**: `feature/watchlist-screen-improvements`

---

## Execution Summary

Pure UI-composition change to `xstockstrat-ui`'s `/insights/watchlists` detail pane — no proto,
migration, or config touch. Steps land in the order design.md derived them: (1) the sentinel/
translation helper + relocated remove/rebind controls (FR-1/FR-2), each paired with its own e2e
step; (2) the add-time strategy picker (FR-3); (3) the whole-component remount + inline rename
(FR-4); (4) the two-layer concurrency guard, both layers paired with one closing e2e step. Step 8
also corrects one gap in design.md's own literal text — `useWatchlists()`'s declared return type
does not expose `isFetching`, which Layer 2 depends on (see Step 8 Codebase Evidence).

## Step Dependencies

- Step 2 [test] pairs with Step 1 [service] — repoints the chip-row-scoped e2e queries.
- Step 3 requires Step 1 — reuses `toApiStrategyId`/`UNBOUND` exported from `useWatchlists.ts`, and
  needs the chip row already gone so the add-picker sits directly under the input.
- Step 4 [test] pairs with Step 3.
- Step 5 requires Step 3 — the reset mechanism's rationale explicitly resets `addStrategyId`
  (introduced in Step 3) on a watchlist switch, alongside the new rename edit-state it introduces.
- Step 6 [test] pairs with Step 5.
- Step 7 requires Steps 1, 3, 5 — Layer 1's `writeInFlight` boolean disables the rebind/remove
  controls (Step 1), the add-row (Step 3), and the rename control (Step 5), so all three must exist
  first.
- Step 8 requires Step 5 — reuses the `key={selected.watchlistId}` remount already landed in
  `page.tsx` and adds the `useIsMutating` guard alongside it.
- Step 9 [test] pairs with **both** Step 7 and Step 8 (declared here per the template's
  "or declare it in Step Dependencies" option, since one e2e case exercises both layers together).
- No dedicated test step pairs with Step 1's sentinel/translation extraction in isolation — it has
  no independently observable behavior (the constant and function are relocated, not changed), so
  its correctness is proven transitively by Steps 2/4/6's passing e2e assertions on translated
  values. Recorded here explicitly rather than left implicit (P-03).
- Constitution C-14 (consumer surface): the product spec's only named surface is `xstockstrat-ui`
  `/insights/watchlists`, which every step below lands on directly — no additional surface-coverage
  step is required.

---

### Step 1 — service: Sentinel/translation helper + relocate remove/rebind controls into the readiness table (FR-1/FR-2)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/hooks/useWatchlists.ts` — modify
- `services/xstockstrat-ui/src/components/insights/WatchlistReadiness.tsx` — modify
- `services/xstockstrat-ui/src/components/insights/WatchlistDetail.tsx` — modify

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, analytics display accuracy,
Connect-RPC call safety, no secret values rendered in UI

**Codebase Evidence**:
- `UNBOUND` sentinel currently declared locally: `WatchlistDetail.tsx:39` (`const UNBOUND =
  '__unbound__';`), consumed at `:148-149,155`.
- Chip-row block to delete: `WatchlistDetail.tsx:126-165` (`data-testid="symbol-list"`, per-symbol
  `Badge` + remove `X` button at `:137-145` + strategy `Select` at `:147-162`).
- "No symbols" empty-state message currently inside the chip-row block:
  `WatchlistDetail.tsx:128` (`{bindings.length === 0 && <span>No symbols</span>}`).
- `setBinding` (full-bindings-replace pattern to reuse as-is): `WatchlistDetail.tsx:86-96`.
- Remove-symbol call to reuse as-is: `WatchlistDetail.tsx:140-142` (`removeSymbols.mutate({
  watchlistId: watchlist.watchlistId, symbols: [b.symbol] })`).
- `WatchlistReadiness` current signature: `WatchlistReadiness.tsx:46-52` (`{ bindings, inQueue }`).
- Bound row `<li>`: `WatchlistReadiness.tsx:111-115` (testid `readiness-row-${binding.symbol}` at
  `:114`); static `strategyId` span to remove: `:117-119` (`w-40 truncate font-mono text-[10px]`).
- Unbound row `<li>`: `WatchlistReadiness.tsx:154-158` (testid `readiness-row-${b.symbol}` at
  `:157`); existing "not evaluated" marker to keep: `:160-162` (`data-testid="unbound-${b.symbol}"`).
- `WatchlistReadiness` invocation to update: `WatchlistDetail.tsx:180`.
- `WatchlistDetail.tsx` current imports already include `Select`/`SelectContent`/`SelectItem`/
  `SelectTrigger`/`SelectValue` (`:8-14`) and `X` from `lucide-react` (`:4`) — both move to
  `WatchlistReadiness.tsx`, which does not yet import either (confirmed: `WatchlistReadiness.tsx:1-7`
  imports only `useQueries`, `cn`, `Badge`, `ConditionState`, `analysisClient`, `isFiring`/
  `rollupReadiness`).
- `Radix Select` forbids an empty-string item value (comment at `WatchlistDetail.tsx:38`) — the
  reason `UNBOUND`/translation exists at all; must be preserved verbatim in the relocated home.

**TDD**: `red-green required`

**Instructions**:
1. In `useWatchlists.ts`, add two exports near the top (after the existing `WatchlistBindingInput`
   type at `:14`):
   ```ts
   // Radix Select forbids an empty-string item value, so an unbound symbol uses this sentinel.
   export const UNBOUND = '__unbound__';
   export function toApiStrategyId(v: string): string {
     return v === UNBOUND ? '' : v;
   }
   ```
2. In `WatchlistReadiness.tsx`, add imports: `X` from `lucide-react`; `Select`, `SelectContent`,
   `SelectItem`, `SelectTrigger`, `SelectValue` from `@/components/ui/select`; `UNBOUND`,
   `toApiStrategyId` from `@/hooks/useWatchlists`. Add a local type alias mirroring the file's
   existing `Binding` convention (`:11`): `type StrategyDef = { strategyId: string; displayName?:
   string };`.
3. Add the stateless `BindingRowControls` subcomponent (no internal `useState` — matches the file's
   documented "never a fabricated binding" discipline at `:43`):
   ```tsx
   function BindingRowControls({
     symbol, strategyId, strategies, onRebind, onRemove, disabled,
   }: {
     symbol: string;
     strategyId: string;
     strategies: StrategyDef[];
     onRebind: (symbol: string, strategyId: string) => void;
     onRemove: (symbol: string) => void;
     disabled: boolean;
   }) {
     return (
       <div className="flex items-center gap-2">
         <Select
           value={strategyId || UNBOUND}
           onValueChange={(v) => onRebind(symbol, toApiStrategyId(v))}
           disabled={disabled}
         >
           <SelectTrigger className="h-7 w-32 text-xs" aria-label={`Strategy for ${symbol}`}>
             <SelectValue placeholder="Bind a strategy…">
               {strategies.find((s) => s.strategyId === strategyId)?.displayName || strategyId || undefined}
             </SelectValue>
           </SelectTrigger>
           <SelectContent>
             <SelectItem value={UNBOUND}>Unbound</SelectItem>
             {strategies.map((s) => (
               <SelectItem key={s.strategyId} value={s.strategyId}>{s.displayName || s.strategyId}</SelectItem>
             ))}
           </SelectContent>
         </Select>
         <button type="button" aria-label={`Remove ${symbol}`} onClick={() => onRemove(symbol)} disabled={disabled}>
           <X className="h-3 w-3" />
         </button>
       </div>
     );
   }
   ```
4. Update `WatchlistReadiness`'s exported signature (`:46-52`) to `{ bindings, inQueue, strategies,
   onRemoveSymbol, onRebindSymbol, disabled = false }` with `strategies: StrategyDef[]`,
   `onRemoveSymbol: (symbol: string) => void`, `onRebindSymbol: (symbol: string, strategyId: string)
   => void`, `disabled?: boolean`.
5. In the bound row (`:111-148`): delete the static `strategyId` span (`:117-119`) and insert
   `<BindingRowControls symbol={binding.symbol} strategyId={binding.strategyId}
   strategies={strategies} onRebind={onRebindSymbol} onRemove={onRemoveSymbol}
   disabled={disabled} />` in its place (same position in the flex row, right after the symbol span
   at `:116`).
6. In the unbound row (`:154-163`): insert the same `BindingRowControls` call (with
   `strategyId=""`) right after the existing `unbound-${b.symbol}` span (`:160-162`), before the
   closing `</li>` — added *alongside* the existing "not evaluated" text, not replacing it (preserves
   `e2e/insights/watchlists.spec.ts:72,84`'s existing assertions on that text).
7. In `WatchlistDetail.tsx`:
   - Remove the local `const UNBOUND = '__unbound__';` (`:39`) and its doc comment (`:38`); import
     `UNBOUND` from `@/hooks/useWatchlists` in the existing hook import block (`:15-20`).
   - Delete the entire chip-row block `:126-165` (the `data-testid="symbol-list"` div and its
     contents).
   - In its place, add a standalone empty-state check, kept independent of
     `WatchlistReadiness.tsx:87`'s own `bindings.length === 0` early-return: `{bindings.length ===
     0 && <p className="text-sm text-muted-foreground">No symbols</p>}` — placed immediately before
     the add-symbols input row (currently `:167`).
   - Remove the now-unused `Select`/`SelectContent`/`SelectItem`/`SelectTrigger`/`SelectValue`
     imports (`:8-14`) and the `X` import (`:4`) if nothing else in the file still uses them (Step 3
     re-adds `Select` imports for the add-time picker, so leave the import statement's `Select`
     members if Step 3 lands in the same PR — otherwise remove and let Step 3 re-add).
   - Update the `<WatchlistReadiness>` call (`:180`) to `<WatchlistReadiness bindings={bindings}
     inQueue={inQueue} strategies={strategies} onRemoveSymbol={(symbol) =>
     removeSymbols.mutate({ watchlistId: watchlist.watchlistId, symbols: [symbol] })}
     onRebindSymbol={setBinding} />` (no `disabled` prop yet — Step 7 adds it).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint
```
Confirm no TypeScript errors on `WatchlistReadiness.tsx` / `WatchlistDetail.tsx` / `useWatchlists.ts`
(`pnpm exec tsc --noEmit` if lint alone doesn't catch a type mismatch). Behavioral proof is Step 2.

---

### Step 2 — test: Repoint existing e2e coverage at the relocated readiness-row controls (FR-1/FR-2, AC-1)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/watchlists.spec.ts` — modify

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, Connect-RPC call safety

**Codebase Evidence**:
- `bindStrategy` helper to repoint: `watchlists.spec.ts:24-29` (currently
  `page.getByTestId(\`binding-${symbol}\`).getByLabel(...)`).
- Test 1 ("create a list, add two symbols, remove one, delete the list"): `watchlists.spec.ts:32-57`
  — asserts `getByTestId('binding-AAPL')` / `getByTestId('binding-MSFT')` at `:42-43,47-48`.
- Test 4 ("readiness rollup buckets buckets sum to the bound symbol count"): `watchlists.spec.ts:108-132`
  — uses only the `bindStrategy` helper, no direct `binding-${symbol}` testid reference; fixing the
  helper (this step) should make it pass unmodified — confirm, don't assume (P-03).
- Confirmed via `grep -rn "binding-\${|symbol-list" services/xstockstrat-ui/e2e/`: only
  `watchlists.spec.ts` references these testids — no other spec file (e.g.
  `e2e/insights/screener.spec.ts`) is affected by the chip-row removal.
- `Remove ${symbol}` button query is `getByRole('button', { name: 'Remove AAPL' })`
  (`watchlists.spec.ts:46`) — an `aria-label` query, unaffected by DOM relocation since
  `BindingRowControls` (Step 1) carries the identical `aria-label={\`Remove ${symbol}\`}`.
- `mockWatchlists` stateful mock (`e2e/helpers/watchlistMock.ts`) needs no change — already backs
  `UpdateWatchlist`/`AddWatchlistSymbols`/`RemoveWatchlistSymbols` (confirmed `:73-109`);
  `INVENTORY.md:23` already catalogs it for this spec (C-12 — no new fixture).
- Design.md round-4 finding: the relocated `Select` is capped at `w-32` (narrower than the deleted
  chip row's `w-48`) — an unmeasured estimate that must be verified, not assumed correct by code
  review alone.

**TDD**: `red-green required`

**Instructions**:
1. Update `bindStrategy` (`:24-29`) to scope off the relocated row instead of the deleted chip:
   ```ts
   async function bindStrategy(page: Page, symbol: string, optionName = 'Live Test Strategy') {
     const select = page.getByTestId(`readiness-row-${symbol}`).getByLabel(`Strategy for ${symbol}`);
     await select.click();
     await page.getByRole('option', { name: optionName }).click();
     await expect(select).toContainText(optionName, { timeout: 5000 });
   }
   ```
2. In the "create a list, add two symbols, remove one, delete the list" test (`:32-57`), replace
   `getByTestId('binding-AAPL')` / `getByTestId('binding-MSFT')` (`:42-43,47-48`) with
   `getByTestId('readiness-row-AAPL')` / `getByTestId('readiness-row-MSFT')`. Leave the `Remove
   AAPL` button query (`:46`) and the delete-watchlist flow (`:50-56`) unchanged.
3. Run the "readiness rollup buckets" test (`:108-132`) as-is after step 1's helper fix — do not
   edit it unless it fails; if it fails, report the exact assertion and repoint only that assertion
   (do not touch unrelated lines — CLAUDE.md § How to Act, touch only what the task requires).
4. Add a width/visibility check to the bound-row assertions (round-4 finding — the `w-32` estimate
   must be verified, not assumed): in the "per-symbol strategy binding" test (`:59-85`), after
   `bindStrategy(page, 'AAPL')`, assert the row's controls are all visible with no horizontal
   overflow, e.g.:
   ```ts
   const row = readiness.getByTestId('readiness-row-AAPL');
   await expect(row.getByLabel('Strategy for AAPL')).toBeVisible();
   await expect(row.getByLabel('Remove AAPL')).toBeVisible();
   const box = await row.boundingBox();
   expect(box).not.toBeNull();
   // The row must not overflow the readiness list's border container (no horizontal scroll forced).
   ```
   If this reveals actual overflow at the default Playwright viewport (1280×720,
   `playwright.config.ts`), the deviation (adjusting `w-32`) is recorded in the Deviation Log at
   execute time per F-09 — this step's Instructions text is not edited after the fact.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -- e2e/insights/watchlists.spec.ts
cd services/xstockstrat-ui && pnpm run lint
```
All 5 existing test cases in the file pass; the new width/visibility assertions pass.

---

### Step 3 — service: Add-time strategy picker (FR-3)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/insights/WatchlistDetail.tsx` — modify

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, Connect-RPC call safety

**Codebase Evidence**:
- `handleAddSymbol` to extend: `WatchlistDetail.tsx:72-82` — currently calls `addSymbols.mutate({
  watchlistId: watchlist.watchlistId, symbols }, { onSuccess: () => setSymbolInput('') })` with no
  `bindings`.
- `useAddWatchlistSymbols` already accepts optional `bindings`: `useWatchlists.ts:73-83`
  (`{ watchlistId: string; symbols: string[]; bindings?: WatchlistBindingInput[] }`) — no hook
  change needed.
- Add-symbols input row to extend: `WatchlistDetail.tsx:167-178` (`Input` + `Button`).
- `toApiStrategyId`/`UNBOUND` now exported from `@/hooks/useWatchlists` (Step 1) — reuse for the
  add-time picker's translation, same pattern as `BindingRowControls`.
- `strategies` list already available in this component: `WatchlistDetail.tsx:58-59`
  (`const { data: defs } = useStrategyDefinitions(); const strategies = defs?.definitions ?? [];`).

**TDD**: `red-green required`

**Instructions**:
1. Add local state next to `symbolInput` (`:61`): `const [addStrategyId, setAddStrategyId] =
   useState(UNBOUND);`.
2. In the add-symbols row (`:167-178`), add a `Select` beside the existing `Input`, using the same
   `UNBOUND` sentinel / `SelectItem` list pattern `BindingRowControls` uses (Step 1):
   ```tsx
   <Select value={addStrategyId} onValueChange={setAddStrategyId}>
     <SelectTrigger className="h-9 w-40 text-xs" aria-label="Strategy for new symbols">
       <SelectValue placeholder="Unbound" />
     </SelectTrigger>
     <SelectContent>
       <SelectItem value={UNBOUND}>Unbound</SelectItem>
       {strategies.map((s) => (
         <SelectItem key={s.strategyId} value={s.strategyId}>{s.displayName || s.strategyId}</SelectItem>
       ))}
     </SelectContent>
   </Select>
   ```
   Re-add the `Select`/`SelectContent`/`SelectItem`/`SelectTrigger`/`SelectValue` import if Step 1
   removed it.
3. Update `handleAddSymbol` (`:72-82`) to build `bindings` from the chosen strategy and pass it to
   the existing `addSymbols.mutate` call:
   ```ts
   function handleAddSymbol() {
     const raw = symbolInput.trim();
     if (!raw) return;
     const symbols = raw.split(/[\s,]+/).filter(Boolean);
     if (symbols.length === 0) return;
     const strategyId = toApiStrategyId(addStrategyId);
     addSymbols.mutate(
       {
         watchlistId: watchlist.watchlistId,
         symbols,
         bindings: symbols.map((s) => ({ symbol: s, strategyId })),
       },
       { onSuccess: () => setSymbolInput('') },
     );
   }
   ```
   `addStrategyId` is **not** reset in `onSuccess` — an explicit choice (design.md §3): a repeat add
   to the same watchlist keeps the user's active strategy choice. It is reset only by the Step 5
   watchlist-switch remount.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint
```
Behavioral proof is Step 4.

---

### Step 4 — test: New e2e case for the add-time strategy picker (FR-3, AC-2)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/watchlists.spec.ts` — modify

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, Connect-RPC call safety

**Codebase Evidence**:
- `createList` / `addSymbols` helpers to reuse: `watchlists.spec.ts:10-19`.
- `mockWatchlists`'s `AddWatchlistSymbols` route already honors `req.bindings` when present
  (`e2e/helpers/watchlistMock.ts:86-95`, `toBindings`/`normBindings` at `:31-45`) — no mock change
  needed (C-12).
- Existing "per-symbol strategy binding" test (`watchlists.spec.ts:59-85`) is the template for
  asserting a bound row via `readiness-row-${symbol}` / `unbound-${symbol}`.

**TDD**: `red-green required`

**Instructions**:
Add a new `test(...)` in `watchlists.spec.ts` after the existing "per-symbol strategy binding" test
(`:85`), asserting both branches of AC-2:
1. **Bound add**: create a list, select a strategy in the new add-time `Select` (`aria-label
   "Strategy for new symbols"`), enter a symbol, click Add — assert the symbol appears immediately
   as an *evaluated* row (`readiness-row-${symbol}` visible, `unbound-${symbol}` absent), proving
   the single-call add-already-bound path (no separate rebind step).
2. **Default unbound add**: in the same or a second list, leave the add-time `Select` on "Unbound",
   add a symbol — assert it appears as `unbound-${symbol}` (today's default behavior, unchanged).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -- e2e/insights/watchlists.spec.ts -g "add-time strategy"
cd services/xstockstrat-ui && pnpm run lint
```

---

### Step 5 — service: Whole-component reset mechanism + inline watchlist rename (FR-4)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/insights/watchlists/page.tsx` — modify
- `services/xstockstrat-ui/src/components/insights/WatchlistDetail.tsx` — modify

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, config mutation safety,
Connect-RPC call safety

**Codebase Evidence**:
- `<WatchlistDetail>` invocation to key: `page.tsx:143` (`<WatchlistDetail watchlist={selected}
  onDelete={handleDelete} />`).
- Global `staleTime: 5_000` on the `QueryClient`: `src/lib/queryClient.ts:14` — confirms a remount
  within 5s of the last fetch serves cached data with zero network calls (design.md §4 — "verified,
  not assumed, to be cheap").
- Header `<h2>` to make editable: `WatchlistDetail.tsx:102` (`<h2 className="font-semibold">
  {watchlist.name}</h2>`).
- `updateWatchlist` mutation hook already in scope: `WatchlistDetail.tsx:57`
  (`const updateWatchlist = useUpdateWatchlist();`).
- Full-bindings-replace pattern to copy (fails-080/feature-097 invariant): `setBinding`,
  `WatchlistDetail.tsx:86-96` — a rename must send the watchlist's **current** `description` and
  `bindings` unchanged, never a partial payload.
- No existing click-to-edit/pencil-icon pattern anywhere in `xstockstrat-ui` (recon.md, confirmed via
  `grep -ri "Pencil|Edit2|Edit3|contentEditable" services/xstockstrat-ui/src` → no matches) — this
  is the first instance, kept local (one consumer, no DRY extraction per recon.md).
- `lucide-react` is already a dependency used for icons in this file (`Trash2, X, Search` at
  `WatchlistDetail.tsx:4`) — `Pencil` is part of the same installed icon set.

**TDD**: `red-green required`

**Instructions**:
1. In `page.tsx:143`, add `key={selected.watchlistId}` to the `<WatchlistDetail>` element:
   `<WatchlistDetail watchlist={selected} onDelete={handleDelete} key={selected.watchlistId} />`.
   This forces a full remount on every watchlist switch, resetting `symbolInput`, `addStrategyId`
   (Step 3), and the rename edit-state (below) in one mechanism — replacing any need for a
   `useEffect`-based reset (rejected in design.md § Rejected Alternatives for a stale-frame flicker
   window).
2. In `WatchlistDetail.tsx`, add `Pencil` to the `lucide-react` import (`:4`).
3. Add local rename state near `symbolInput` (`:61`): `const [isEditingName, setIsEditingName] =
   useState(false); const [nameDraft, setNameDraft] = useState(watchlist.name);`.
4. Replace the header block (`:100-107`, the `<div><h2>...` wrapper) with a toggle: in display mode,
   render the existing `<h2>{watchlist.name}</h2>` plus a small icon button (`aria-label={\`Rename
   ${watchlist.name}\`}`, `<Pencil className="h-3.5 w-3.5" />`) that sets `isEditingName(true)` and
   seeds `nameDraft` from `watchlist.name`; in edit mode, render an `Input` bound to `nameDraft` with
   `aria-label="Watchlist name"`, auto-focused, that:
   - commits on Enter or blur — only if `nameDraft.trim()` is non-empty **and** differs from
     `watchlist.name` — calling `updateWatchlist.mutate({ watchlistId: watchlist.watchlistId, name:
     nameDraft.trim(), description: watchlist.description ?? '', bindings })` (the full current
     `bindings` array, copying `setBinding`'s invariant) and then `setIsEditingName(false)`;
   - is a no-op (just `setIsEditingName(false)`) on an unchanged or empty trimmed value;
   - cancels on Escape — resets `nameDraft` to `watchlist.name` and calls `setIsEditingName(false)`
     without mutating.
5. Leave the rest of the header (`Build from screener` link, delete button, `:108-123`) unchanged.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint
```
Behavioral proof is Step 6.

---

### Step 6 — test: New e2e case for inline rename + switch-reset (FR-4, AC-3)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/watchlists.spec.ts` — modify

**Reviewers**: xstockstrat-ui service owner — Trading UI correctness, config mutation safety

**Codebase Evidence**:
- `mockWatchlists`'s `UpdateWatchlist` route already applies `req.name` (`e2e/helpers/
  watchlistMock.ts:73-84`, `if (req.name !== undefined) wl.name = req.name;`) and preserves
  `req.description`/replaces `bindings` from the request — no mock change needed (C-12).
- Existing "master-detail: selecting a list swaps the detail pane" test (`watchlists.spec.ts:87-106`)
  is the template for the switch-reset half of this case.

**TDD**: `red-green required`

**Instructions**:
Add a new `test(...)` in `watchlists.spec.ts`:
1. Create a list with a bound symbol (reuse `createList` + `addSymbols` + `bindStrategy`), click the
   rename control (`aria-label` starting with `Rename `), type a new non-empty name, commit with
   Enter — assert the header now shows the new name (`getByRole('heading', { name: <newName>
   })`) and the previously-bound symbol's `readiness-row-${symbol}` is still visible (bindings
   survived the rename — the fails-080 invariant).
2. Assert cancel: open the rename control again, type a different draft, press Escape — assert the
   header still shows the committed name from step 1 (no mutation sent).
3. Assert switch-reset: create a second list, select it, then switch back to the first — assert the
   rename control is back in display mode (not stuck mid-edit) and the add-symbols strategy `Select`
   (Step 3/4) is back to "Unbound", proving the `key`-remount reset (Step 5) closes both state leaks.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -- e2e/insights/watchlists.spec.ts -g "rename"
cd services/xstockstrat-ui && pnpm run lint
```

---

### Step 7 — service: Concurrency guard, Layer 1 — intra-pane `writeInFlight`

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/insights/WatchlistDetail.tsx` — modify

**Reviewers**: xstockstrat-ui service owner — Connect-RPC call safety, config mutation safety

**Codebase Evidence**:
- Mutation hooks already in scope: `WatchlistDetail.tsx:55-57` (`addSymbols`, `removeSymbols`,
  `updateWatchlist`), each a `useMutation` result carrying `.isPending` (`@tanstack/react-query`
  standard field, already relied on elsewhere in this codebase, e.g. `page.tsx:92`
  `createWl.isPending`).
- `WatchlistReadiness`'s `disabled` prop, currently wired to a hardcoded implicit `false` (Step 1
  left no `disabled` prop passed at `WatchlistDetail.tsx:180`).
- Design.md § Rejected Alternatives — a per-symbol `pendingSymbols: Set<string>` guard was
  considered and rejected for closing only 1 of 4 write-pairings; a single boolean was chosen.

**TDD**: `red-green required`

**Instructions**:
1. After the mutation hook declarations (`:55-57`), add: `const writeInFlight = addSymbols.isPending
   || removeSymbols.isPending || updateWatchlist.isPending;`.
2. Pass `disabled={writeInFlight}` to the `<WatchlistReadiness>` call (`:180`, updated by Step 1).
3. Disable the rename control (Step 5): the edit-toggle icon button and the edit-mode `Input` both
   get `disabled={writeInFlight}`.
4. Disable the add-row (Step 3): the `Input`, the strategy `Select`, and the `Add` `Button` all get
   `disabled={writeInFlight}` (the `Button` already conditions on `symbolInput` truthiness — combine
   with `|| writeInFlight` via `disabled={writeInFlight || !symbolInput.trim()}` if the existing
   condition is present, otherwise add fresh).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint
```
Behavioral proof is Step 9.

---

### Step 8 — service: Concurrency guard, Layer 2 — cross-instance `mutationKey` + `useIsMutating`

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/hooks/useInvalidatingMutation.ts` — modify
- `services/xstockstrat-ui/src/hooks/useWatchlists.ts` — modify
- `services/xstockstrat-ui/src/app/insights/watchlists/page.tsx` — modify

**Reviewers**: xstockstrat-ui service owner — Connect-RPC call safety, config mutation safety

**Codebase Evidence**:
- `useInvalidatingMutation`'s current signature (no `mutationKey` support):
  `useInvalidatingMutation.ts:13-16` — `(mutationFn, invalidateKeys)`, forwarded into
  `useMutation<TResult, Error, TInput>({ mutationFn, onSuccess })` at `:18-27`. Confirmed no third
  parameter exists today, so this is an additive, backward-compatible change (existing callers —
  the order hooks, per this service's `CLAUDE.md` table row citing this file as their shared
  factory — are unaffected).
- `useAddWatchlistSymbols` / `useRemoveWatchlistSymbols` / `useUpdateWatchlist` call sites to update:
  `useWatchlists.ts:73-83`, `:85-91`, `:46-64` respectively.
- **Correction to design.md's literal text** (caught at spec time, not carried forward silently —
  P-03): design.md §5 Layer 2 specifies `page.tsx` computing `useWatchlists().isFetching`, but
  `useWatchlists`'s declared return type (`useWatchlists.ts:17-21`) is explicitly `{ data:
  ListWatchlistsResult | undefined; isLoading: boolean; error: Error | null; }` — **no
  `isFetching` field**. The function body returns the full `useQuery(...)` result (which does carry
  `isFetching` at runtime), but TypeScript only exposes what the annotated return type declares, so
  `useWatchlists().isFetching` as written would be a compile error. This step must widen the
  declared return type to include `isFetching: boolean` alongside `isLoading`/`data`/`error` — the
  design's underlying reasoning (the query-refetch-settling race) is correct and unaffected; only
  the return-type annotation was unverified.
- `page.tsx`'s master-list button block to add the guard to: `page.tsx:115-134` (the `<li>`/`<button>`
  loop; `cn(...)` call at `:121-126`).
- `Button` component's disabled-state convention to mirror on the raw `<button>`:
  `src/components/ui/button.tsx:7` (`disabled:pointer-events-none disabled:opacity-50`, part of the
  shared `buttonVariants` base classes) — the master-list `<button>` at `page.tsx:117` is a raw
  element, not the `Button` component, so it carries none of this styling today.
- `useIsMutating` is a standard `@tanstack/react-query` export, same package already imported for
  `useMutation`/`useQuery`/`useQueries` elsewhere in this codebase (e.g.
  `WatchlistReadiness.tsx:2`); confirmed via `grep -rn "useIsMutating" services/xstockstrat-ui/src`
  → no existing usage, so this is a new (not colliding) import.
- Screener page's own `useAddWatchlistSymbols` call: `src/app/insights/screener/page.tsx:68` — an
  **accepted, documented open risk** (design.md § Open Risks): tagging the shared
  `['watchlist-write']` key means a write started from Screener counts toward the Watchlists page's
  `useIsMutating` total too. No change required to `screener/page.tsx` in this feature.

**TDD**: `red-green required`

**Instructions**:
1. In `useInvalidatingMutation.ts`, add an optional third parameter and forward it:
   ```ts
   export function useInvalidatingMutation<TInput, TResult>(
     mutationFn: (input: TInput) => Promise<TResult>,
     invalidateKeys: QueryKey[] | ((input: TInput, result: TResult) => QueryKey[]),
     options?: { mutationKey?: QueryKey },
   ) {
     const queryClient = useQueryClient();
     return useMutation<TResult, Error, TInput>({
       mutationFn,
       mutationKey: options?.mutationKey,
       onSuccess: (result, input) => {
         const keys =
           typeof invalidateKeys === 'function' ? invalidateKeys(input, result) : invalidateKeys;
         for (const queryKey of keys) {
           queryClient.invalidateQueries({ queryKey });
         }
       },
     });
   }
   ```
2. In `useWatchlists.ts`, pass `{ mutationKey: ['watchlist-write'] }` as the third argument to
   `useAddWatchlistSymbols` (`:73-83`), `useRemoveWatchlistSymbols` (`:85-91`), and
   `useUpdateWatchlist` (`:46-64`) — **not** `useCreateWatchlist` or `useDeleteWatchlist` (those are
   whole-list operations outside this feature's scope; leave them on the default untagged key).
3. In the same file, widen `useWatchlists`'s declared return type (`:17-21`) to add `isFetching:
   boolean` alongside the existing `data`/`isLoading`/`error` fields (see Codebase Evidence
   correction above).
4. In `page.tsx`, import `useIsMutating` from `@tanstack/react-query`. After the existing
   `useWatchlists()` call (`:13`), compute:
   ```ts
   const anyWatchlistWriteInFlight = useIsMutating({ mutationKey: ['watchlist-write'] }) > 0 || isFetching;
   ```
   (destructure `isFetching` from the same `useWatchlists()` call at `:13`, alongside the existing
   `data, isLoading, error`).
5. On the master-list `<button>` (`:117-127`), add `disabled={anyWatchlistWriteInFlight}` and append
   `'disabled:pointer-events-none disabled:opacity-50'` to the `cn(...)` call (`:121-126`) — matching
   `button.tsx:7`'s convention exactly, since this is a raw `<button>`, not the shared `Button`
   component.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint
cd services/xstockstrat-ui && pnpm exec tsc --noEmit
```
`tsc --noEmit` is included explicitly here because this step's Codebase Evidence correction is a
type-level fix (`isFetching`) that a passing `pnpm run lint` (ESLint) would not by itself guarantee
catches. Behavioral proof is Step 9.

---

### Step 9 — test: New e2e case for the concurrency guard (Layers 1 and 2)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/watchlists.spec.ts` — modify

**Reviewers**: xstockstrat-ui service owner — Connect-RPC call safety, config mutation safety

**Codebase Evidence**:
- Playwright's `page.route(..., async (route) => { await new Promise(...); return route.fulfill(...)
  })` delay pattern is the standard way to hold a mocked RPC pending in this suite — reuse
  `mockWatchlists`'s existing route registration shape (`e2e/helpers/watchlistMock.ts:73-84` for
  `UpdateWatchlist`) as the base to wrap with a delay, per `page.route` interception order (last
  registered wins) — register the delaying override **after** calling `mockWatchlists(page)`.
- `anyWatchlistWriteInFlight`'s master-list button `disabled` attribute (Step 8) and
  `writeInFlight`'s row-control `disabled` attribute (Step 7) are both plain HTML `disabled`, so
  Playwright's `toBeDisabled()` matcher applies directly.

**TDD**: `red-green required`

**Instructions**:
Add a new `test(...)` in `watchlists.spec.ts`:
1. **Layer 1**: create a list with one bound symbol. Register a delayed `UpdateWatchlist` route
   override (e.g. a 2s delay before fulfilling) covering `mockWatchlists`'s existing route, then
   trigger a rebind via `bindStrategy` (without awaiting its internal `toContainText` assertion, or
   trigger the rename control's commit) — while the request is in flight, assert the add-row's
   `Input` and the bound row's remove button (`getByLabel('Remove <symbol>')`) are both
   `toBeDisabled()`. Await the delayed response, then assert both become enabled again.
2. **Layer 2**: with the same delayed-`UpdateWatchlist` write still in flight (or a fresh one),
   assert the master-list's *other* watchlist-select button(s) (`page.getByTestId('watchlist-master')
   .getByRole('button', ...)`) are `toBeDisabled()` while the write and its refetch are settling, and
   become enabled again once both resolve.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -- e2e/insights/watchlists.spec.ts -g "concurrency"
cd services/xstockstrat-ui && pnpm run lint
```
Full-file regression pass:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -- e2e/insights/watchlists.spec.ts
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
