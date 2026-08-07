# Design: watchlist-screen-improvements

**Created**: 2026-08-07
**Rounds**: 6 (debate cap explicitly extended from the mode-mandated 1 to 7 by user instruction,
mid-debate, once the design reached "pass with warnings" territory rather than a Floor breach —
converged at round 6, within the extended cap)
**Termination reason**: approved after round 6 — every objection raised across all 6 rounds was
either fixed in the design below or is recorded as an explicit, bounded, non-Floor open risk.

---

## Chosen Approach

Pure UI-composition change to `xstockstrat-ui`'s `/insights/watchlists` detail pane. No proto,
migration, config, or new service touchpoint (recon.md Dependencies).

### 1. Sentinel + translation (single source of truth)

`services/xstockstrat-ui/src/hooks/useWatchlists.ts` exports:
```ts
export const UNBOUND = '__unbound__';
export function toApiStrategyId(v: string): string {
  return v === UNBOUND ? '' : v;
}
```
Both the relocated rebind `Select` (in `BindingRowControls`, below) and the add-symbols `Select`
call `toApiStrategyId(v)` before mutating — the **one** place the Radix-`Select`-forbids-empty-string
sentinel is translated to the wire-level `strategyId: ''`. Prevents the literal string
`'__unbound__'` from ever reaching `WatchlistBindingInput` (round 1 finding).

### 2. Relocate remove/rebind controls into the readiness table (FR-1/FR-2)

`services/xstockstrat-ui/src/components/insights/WatchlistDetail.tsx:126-165` (the
`data-testid="symbol-list"` chip-row block: `Badge` + remove `X` + strategy `Select` per symbol) is
**deleted**. Its "No symbols" empty-state message (`WatchlistDetail.tsx:128`) is **preserved**,
relocated to its own independent `{bindings.length === 0 && <p>No symbols</p>}` check in
`WatchlistDetail.tsx`, before the add-symbols row — kept separate from
`WatchlistReadiness.tsx:87`'s own `bindings.length === 0` early-return so an empty/newly-created
watchlist still shows a message instead of rendering nothing (round 3 finding).

`services/xstockstrat-ui/src/components/insights/WatchlistReadiness.tsx` gains a new **stateless**
local subcomponent (no internal `useState` — pure props, mirroring the "never a fabricated binding"
discipline this file already documents at `WatchlistReadiness.tsx:43`):

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
          {/* Explicit fallback children — round 6 finding: a bound-but-not-yet-loaded or
              orphaned strategyId (deleted elsewhere) must still show *something* identifying
              the row, not render blank while `strategies` hasn't resolved or lacks a match. */}
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

Used in **both** row branches:
- Bound row (`WatchlistReadiness.tsx:110-115`): existing conviction-bar/state-label/`in-queue`
  badge/`blockingCondition` markup is **unchanged**. The existing **static** `strategyId` text span
  (`WatchlistReadiness.tsx:117-119`, `w-40 truncate font-mono text-[10px]`) is **removed** — the new
  interactive `Select` supersedes it and reclaims the row's width budget (round 5 finding; left
  ambiguous through round 4, resolved explicitly here rather than left to the implementer per C-01).
  `BindingRowControls`'s `Select` is capped at `w-32` (narrower than the old chip row's `w-48`) to
  fit the existing dense flex row (`w-14` symbol + conviction bar + state label + optional badge +
  `ml-auto truncate` blocking-condition text) — **`/sdd-spec`'s implementation step for this piece
  must include an explicit width/visibility verification (manual or Playwright), not code review
  alone** (round 4 finding: a layout claim in a dense flex row is not self-evidently correct).
- Unbound row (`WatchlistReadiness.tsx:153-158`): the existing `data-testid="unbound-${symbol}"`
  "not evaluated — bind a strategy" text is **kept**; `BindingRowControls` is added alongside it,
  not replacing it (round 2 finding — preserves two existing e2e assertions,
  `e2e/insights/watchlists.spec.ts:72,84`).

`WatchlistReadiness`'s prop signature gains `{strategies, onRemoveSymbol, onRebindSymbol, disabled}`.
Each row's `key={binding.symbol}` (`WatchlistReadiness.tsx:112,155`) is **unchanged** — safe because
`BindingRowControls` is stateless, so no per-row leak-across-switch concern applies to it.

**Test hooks**: `BindingRowControls` carries **no new `data-testid`**. e2e repoints for FR-1/FR-2
scope off the existing `readiness-row-${symbol}` `<li>` id plus the preserved
`Strategy for ${symbol}` / `Remove ${symbol}` `aria-label`s (identical strings to today's chip row)
— `/sdd-spec` must verify, not assume, that `e2e/insights/watchlists.spec.ts`'s `bindStrategy`
helper (`:24-29`) and the `Remove ${symbol}` button queries (global `getByTestId`/`getByRole`
locators, unaffected by DOM relocation) pass unmodified (round 2 finding).

### 3. Add-time strategy picker (FR-3)

The add-symbols row in `WatchlistDetail.tsx` gains a strategy `Select` beside the existing `Input`,
using the same `UNBOUND`/`toApiStrategyId` pattern. `handleAddSymbol` builds
`WatchlistBindingInput[]` from `toApiStrategyId(addStrategyId)` for every symbol entered and passes
it to the existing `useAddWatchlistSymbols({ ..., bindings })` call (the hook already accepts
`bindings?` — `useWatchlists.ts:73-83`, no hook change needed). On success, **only** `symbolInput`
resets (mirrors the existing `onSuccess: () => setSymbolInput('')` idiom,
`WatchlistDetail.tsx:78-81`) — `addStrategyId` is **not** reset on success (an explicit, stated
choice: a repeat add to the *same* watchlist should keep the user's active strategy choice, not
force a re-pick every time); it *is* reset on a watchlist switch (see §4).

### 4. Reset mechanism for all of `WatchlistDetail`'s local state (FR-3/FR-4 switch-safety)

`services/xstockstrat-ui/src/app/insights/watchlists/page.tsx:143`:
```tsx
<WatchlistDetail watchlist={selected} onDelete={handleDelete} key={selected.watchlistId} />
```//
A single `key={selected.watchlistId}` forces a full remount of `WatchlistDetail` on every watchlist
switch, resetting **all** of its local state (`symbolInput`, `addStrategyId`, the FR-4 rename
edit-state) in one mechanism — this **replaces** two earlier, more complex per-piece-of-state
fixes considered and rejected during the debate (a `useEffect`-based reset — rejected for a
stale-frame flicker window; separate hand-rolled `key`-scoped `AddSymbolsRow`/`WatchlistNameEditor`
subcomponents — rejected as unnecessary complexity once the single outer `key` was shown to close
every leak at once). **Verified, not assumed, to be cheap**: `src/lib/queryClient.ts:14` sets a
global `staleTime: 5_000` on the `QueryClient`; `useOpportunities`, `useStrategyDefinitions`, and
`WatchlistReadiness`'s `useQueries` (`evaluateReadiness` calls) all lack per-query overrides, so a
remount within 5s of the last fetch serves cached data with **zero** network calls (react-query's
cache is keyed by query key, not component instance) — no meaningful cost increase over today's
behavior.

The FR-4 rename control (a plain click-to-edit `<h2>`/`Input` toggle with local `useState`, directly
inside `WatchlistDetail` — no separate keyed subcomponent needed once the outer `key` covers it)
commits on Enter/blur (non-empty + trimmed + changed only) or cancels on Escape, and calls
`useUpdateWatchlist` with the watchlist's **current** `description`/`bindings` unchanged (the
fails-080/feature-097 full-bindings-replace invariant — see §5).

### 5. Concurrency guard, two layers

**Layer 1 — intra-pane, while `WatchlistDetail` stays mounted on the same watchlist:**
```ts
const writeInFlight = addSymbols.isPending || removeSymbols.isPending || updateWatchlist.isPending;
```
Disables: the rename input/toggle, every row's `BindingRowControls` (`Select` + remove button, via
`WatchlistReadiness`'s `disabled` prop), and the add-row's `Input`/`Select`/`Button`. Closes all 4
same-instance write-pairings (rebind/rebind, rebind/rename, rebind/remove, rename/remove) — a single
boolean was chosen over a per-symbol `Set` after the debate found the `Set` closed only 1 of the 4
pairings (round 2 finding).

**Layer 2 — cross-instance, across a watchlist switch (round 5 finding: the `key`-remount in §4
discards `writeInFlight`'s owning instance, so a write left in flight on watchlist A when the user
switches away is no longer locally visible, and a second write from the freshly-mounted instance
— on a switch back to A before the first settles — can race it, last-writer-wins on the full
`bindings` array):**
- `services/xstockstrat-ui/src/hooks/useInvalidatingMutation.ts` gains a new, **optional** third
  parameter: `useInvalidatingMutation<TInput, TResult>(mutationFn, invalidateKeys, options?: {
  mutationKey?: QueryKey })`, forwarded into the inner `useMutation({ mutationFn, mutationKey:
  options?.mutationKey, onSuccess })`. Backward-compatible — existing callers (the order hooks,
  which this factory is shared with per `services/xstockstrat-ui/CLAUDE.md`'s own table row) are
  unaffected since the param is optional.
- `useAddWatchlistSymbols`, `useRemoveWatchlistSymbols`, `useUpdateWatchlist`
  (`useWatchlists.ts`) each pass `{ mutationKey: ['watchlist-write'] }` — **one shared, non-per-watchlist
  key** (not `['watchlist-write', watchlistId]`), because `watchlistId` is only known at
  `.mutate(input)` call time, not at hook-definition time.
- `page.tsx` computes `const anyWatchlistWriteInFlight = useIsMutating({ mutationKey:
  ['watchlist-write'] }) > 0 || useWatchlists().isFetching` and passes `disabled={anyWatchlistWriteInFlight}`
  to each master-list watchlist-select button (`page.tsx:117-132`), which also gains
  `disabled:pointer-events-none disabled:opacity-50` (the exact convention the shared `Button`
  component already uses, `src/components/ui/button.tsx:7`) so the block is visible, not silent
  (round 6 finding — the raw `<button>` here carries no `Button` component styling).
  - **The `|| useWatchlists().isFetching` clause is load-bearing, not decorative**: `useIsMutating`
    tracks mutation-pending status, not query-refetch completion. `useInvalidatingMutation`'s shared
    `onSuccess` (`useInvalidatingMutation.ts:20-26`) calls `queryClient.invalidateQueries(...)`
    without awaiting it, so a mutation can report "no longer pending" before the invalidated
    `['watchlists']` query has actually refetched — without this clause, a switch back to A could
    still land on stale `bindings` inside that (narrower) window. Scoped to the watchlist hooks only
    (not made `async` inside the shared factory itself), so the order hooks' `onSuccess` timing is
    untouched — a broader fix was considered and rejected as unnecessarily wide blast radius for
    this feature's scope (round 6 finding/alternative).
  - This closes the race by **preventing its trigger** (a user cannot leave watchlist A while any
    watchlist write, anywhere, is in flight or its refetch is settling) rather than detecting it
    after the fact.

## Rejected Alternatives

- **Per-symbol `pendingSymbols: Set<string>` guard** (round 2) — disables only the clicked row
  against a second click on itself; leaves 3 of 4 write-pairings (rebind-vs-rename,
  rebind-vs-remove-on-another-row, rename-vs-remove) completely unguarded. Rejected for a single
  `writeInFlight` boolean: simpler code, closes all 4 pairings, and the UX cost (all controls
  disabled during any one write) is acceptable on a low-frequency management screen.
- **`useEffect` keyed on `watchlist.watchlistId` to reset rename edit-state** (round 1) — React's
  documented anti-pattern for this exact scenario: the effect runs *after* commit, so for one paint
  the header can render the *old* edit buffer against the *new* watchlist's other data. Rejected for
  a `key`-based remount, which resets synchronously with the prop change.
- **Per-piece-of-state keyed subcomponents** (`WatchlistNameEditor` alone in round 3, then
  `AddSymbolsRow` also in round 4) instead of one outer `key` — the round-3/4 debate found this
  pattern kept reproducing the *same* leak-across-switch bug class in every new piece of local state
  added (first the add-picker, then the rename draft), because each fix only covered the one state
  variable it was written for. Rejected once the debate confirmed (via `queryClient.ts:14`'s 5s
  staleTime) that keying the whole `WatchlistDetail` instance closes the entire bug class in one
  line at bounded, verified-cheap cost.
- **Lifting the three mutation hooks to `page.tsx`** so `writeInFlight` survives the `key` remount
  by construction (round 6 alternative) — closes the cross-instance race without a `mutationKey`,
  but re-widens the prop surface `WatchlistDetail` was simplified away from, and partially reverses
  the "no per-piece plumbing" simplification the `key` approach was adopted for. Rejected in favor of
  `mutationKey` + `useIsMutating`, which keeps mutation ownership local to `WatchlistDetail`.
- **Per-watchlist `mutationKey` scoping** (`['watchlist-write', watchlistId]`, disabling only the
  currently-selected/leaving button) — narrower UX cost (browsing to an unrelated watchlist stays
  free during another watchlist's write) but requires threading `watchlistId` into the watchlist
  hooks' call signature, a bigger surface change than the optional-third-param approach. Rejected as
  overbuilt for a low-frequency admin screen; recorded as the fallback if the coarse block ever
  proves user-visibly annoying in practice.
- **Making `useInvalidatingMutation`'s shared `onSuccess` `async`/awaited globally** (round 6
  alternative) — would close the refetch-settling race at the root for every consumer (including the
  order hooks), but changes when mutation "success" resolves for `usePlaceOrder`/`useCancelOrder`/
  `useReplaceOrder` too, a wider blast radius than this feature's scope justifies. Rejected for the
  narrower `useWatchlists().isFetching` clause, scoped to the watchlist hooks only.

## Open Risks

- **Cross-page `mutationKey` coupling (accepted, documented, non-Floor)**: `useAddWatchlistSymbols`
  is also called from `services/xstockstrat-ui/src/app/insights/screener/page.tsx:68` (add
  screener results to a watchlist). Once tagged `mutationKey: ['watchlist-write']`, a write started
  from the Screener page counts toward the global `useIsMutating` count on the Watchlists page too —
  a user navigating from Screener (having just fired an add) to Watchlists within that RPC's flight
  window would see the master-list briefly disabled for an unrelated write. Low-probability given
  normal navigation timing; accepted rather than narrowing to a per-caller key (see Rejected
  Alternatives). **Target for follow-up if it ever proves observable**: scope the key
  per-caller/per-watchlist.
- **`writeInFlight`-briefly-true-on-a-freshly-switched-watchlist UX papercut**: even with Layer 2,
  there remains a narrow window where a just-mounted `WatchlistDetail` for watchlist B shows disabled
  controls because a stale write against watchlist A (started before the switch was possible, or
  during the brief window before Layer 2's guard engaged) is still resolving. Self-resolving within
  the RPC/refetch round-trip; not data loss.
- **`w-32` `Select` width is a starting estimate, not a measured value** (round 4's own stated
  residual risk) — `/sdd-spec`'s implementation step must include the width/visibility verification
  called out in §2, and may need to adjust the value.
- **Two small `Select`+`UNBOUND` JSX call sites** (the add-row picker, `BindingRowControls`) are
  accepted as legitimate duplicates, not extracted into a shared component — recon.md already
  establishes this precedent (reuse the *pattern*, not a shared component, at two call sites); flag
  to `dry-reviewer` at execute time if it disagrees, don't pre-empt it.

## Constitution Rules Touched

| ID | How honored |
|---|---|
| **C-01** (zero-assumption, evidence-cited) | Every design claim above cites real `path:line` from recon.md or a live re-read of the file during the debate (e.g. `useInvalidatingMutation.ts`, `queryClient.ts:14`, `button.tsx:7`, `screener/page.tsx:68`) — no invented API shape or symbol. |
| **C-10** (integration completeness) | Not triggered — no new UI route/page (existing `/insights/watchlists`, already in `PLATFORM_SUBNAV`, recon.md Codebase Map), no authoritative-value duplication, no new seeded resource. |
| **C-12** (frontend test-data inventory) | No new fixtures needed — the existing stateful mock (`e2e/helpers/watchlistMock.ts`) already backs every RPC this feature touches (recon.md Patterns to REUSE); confirmed again at round 2. |
| **C-14** (consumer surface named) | UI `/insights/watchlists`, named in product-spec.md and unchanged by design — no new surface introduced. |
| **P-01/P-02** (orchestrator authority, mediated exchange) | Every round's proposer and adversary output was synthesized by the orchestrator before being passed forward; neither saw the other's raw output. |
| **P-03** (no silent deviation) | The bound row's redundant static `strategyId` span (left ambiguous through round 4) was explicitly resolved (removed) rather than left to the implementer, per an adversary objection citing this exact rule. |
| **P-04** (phase-gate approval, recorded) | Debate ran 6 rounds; the mode-mandated cap (1 for `quick`) was explicitly extended to 7 by the user mid-debate once the design reached warnings-not-Floor territory — recorded here and in `context.md`. |
| **F-11** (Floor rejection halts) | No Floor breach was found in any of the 6 rounds — every objection was a Commandment/quality-level fix, never a non-overridable rule. |
| fails-080 (feature 097, in-code convention — not a numbered `fails.md` ledger entry) | The full-bindings-replace-on-every-write invariant is preserved for rebind, rename, *and* the new add-time picker; Layer 2's concurrency guard exists specifically because this class of bug reopened twice more during the debate (via `key`-remount timing, not payload shape) before being closed. |

## Rounds

**6 rounds**, `quick` mode's 1-round minimum extended by explicit user instruction to a 7-round cap
once the debate reached "pass with warnings, not Floor breach" territory. Termination: approved at
round 6 — the round-6 adversary's four objections (residual refetch-settling race, cross-page
`mutationKey` coupling, missing disabled-state styling, static-span-removal fallback) were folded
into the design above rather than requiring a 7th round.
