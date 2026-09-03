# Design: watchlist-bulk-default-strategy

**Created**: 2026-09-03
**Rounds**: 4 (quick mode extended by operator to 4; termination: approved)
**Approved by**: user @ 2026-09-03T18:55Z
**Grounded in**: recon.md

---

## Chosen Approach

Five ordered, additive slices on `xstockstrat-portfolio` (Go, watchlist owner) plus proto, UI
(`/insights`), and agent MCP consumer surfaces.

**1. Proto (all additive → `buf breaking` green).** In `packages/proto/portfolio/v1/portfolio.proto`:
`Watchlist.default_strategy_id = 10`, `CreateWatchlistRequest.default_strategy_id = 5`,
`UpdateWatchlistRequest.default_strategy_id = 6` + `google.protobuf.FieldMask update_mask = 7`
(new `import "google/protobuf/field_mask.proto"`, reusing the platform precedent at
`analysis.proto:9`, `ingest.proto:10`, `indicators.proto:9`), and a new atomic RPC
`UpdateWatchlistBindings(UpdateWatchlistBindingsRequest{watchlist_id, repeated string symbols, string strategy_id})`
`returns (UpdateWatchlistBindingsResponse{repeated WatchlistBinding bindings /*changed only*/, google.protobuf.Timestamp updated_at})`,
mirroring the single-row `UpdateWatchlistBinding` shape (`portfolio.proto:318-326`).

**2. Migration 015.** `ALTER TABLE portfolio.watchlists ADD COLUMN IF NOT EXISTS default_strategy_id
TEXT NOT NULL DEFAULT ''` (mirrors `008_watchlist_symbol_strategy.up.sql:7-8`), paired down drops it.

**3. Add-time default (Fork 1 = Option B, MANUAL-only).** One `applyDefaultStrategy(bindings,
defaultStrategyID)` helper wraps **both** return branches of `requestBindings`
(`portfolio_service.go:1313`, branches `:1315`/`:1321`), filling a binding's `strategy_id` only when
it is `""` **and** `source != WATCHLIST_ENTRY_SOURCE_SIGNAL` (`normalizeBindings` preserves `Source`
at `:1303`). Callers: `CreateWatchlist` → `req.GetDefaultStrategyId()`; `AddWatchlistSymbols` → the
persisted `default_strategy_id` from the `loadOwned` row (`:1557`); the legacy `UpdateWatchlist`
replace-all path → `""` (never writes the default). Signal auto-adds (`source=SIGNAL`) therefore stay
unbound; MANUAL/UNSPECIFIED adds (incl. the agent `manage_watchlist_symbols add`) inherit.

**4. Field mask (Design B, scalar set).** `UpdateWatchlist` gates on mask **presence**
(`req.UpdateMask != nil`, mirroring ingest `servicer.py:1168` / analysis `servicer.py:2444`,
implemented natively in Go). Maskable paths = **{name, description, default_strategy_id}** via a
package-level **static `path→column` allowlist map** (columns never interpolated from the mask
string; values `$N`-parameterized). Mask-absent → the existing `WatchlistRepo.Update`
(`watchlist_repo.go:157-183`) runs **byte-for-byte unchanged** (replace-all name/description/bindings;
`default_strategy_id` is deliberately **not** in the legacy SET, so it is preserved-for-free on every
legacy edit). Mask-present → a new `WatchlistRepo.UpdatePartial` writes only the masked columns +
always `updated_at = now()`; the name-empty guard (`portfolio_service.go:1477`) fires only when
`"name"` ∈ mask; `description`/`default_strategy_id` may be cleared to `""`. Guards: unknown/unlisted
path (incl. `bindings`/`symbols`) → `InvalidArgument`; empty-but-present mask → `InvalidArgument`;
no-mask request carrying `default_strategy_id != ""` → `InvalidArgument("default_strategy_id requires
update_mask")` (loud-fail, no silent no-op).

**5. Bulk assign (Fork 2).** New repo `UpdateBindings(ctx, watchlistID, symbols, strategyID)` = one
set-based `UPDATE portfolio.watchlist_symbols SET strategy_id=$3 WHERE watchlist_id=$1 AND symbol =
ANY($2) RETURNING symbol, strategy_id, source` in an inline pgx tx (pattern `watchlist_repo.go:40-59`)
+ one `touchWatchlistTx` (`:351`). Servicer runs `normalizeSymbols` (uppercase/trim/dedup) first;
empty normalized set → `InvalidArgument`; `len(returned) != len(deduped requested)` → `NOT_FOUND` +
rollback (zero partial writes); ownership via `loadOwned` in the servicer (repo stays
ownership-agnostic — closes fails.md:1147). New `WatchlistStore.UpdateBindings` + `UpdatePartial`
interface methods + `fakeWatchlistStore`; two-layer handler (`PortfolioHandler` + `grpcPortfolioAdapter`,
mirroring `portfolio_handler.go:230`/`:391`).

**Consumer surfaces (C-14).** *UI `/insights`*: a multi-select checkbox column (`ui/checkbox.tsx`,
unique `aria-label="Select ${symbol}"`, header "Select all symbols") on the stateless
`WatchlistReadiness` rows; a bulk action bar (`ui/button.tsx` + design tokens) shown when a selection
exists — "Remove selected" → existing `RemoveWatchlistSymbols`, strategy `Select` + "Apply strategy"
→ new `useUpdateWatchlistBindings` hook (cache-patch, **no** `['watchlists']` invalidate); a
watchlist-level default-strategy `Select` (distinct `aria-label="Default strategy for new symbols"`)
firing `useUpdateWatchlist` with `updateMask: ['default_strategy_id']`. Selection state lifted into
`WatchlistDetail` (resets free via the `key={watchlistId}` remount, `page.tsx:198`); both bulk actions
honor `writeInFlight` + `anyWatchlistWriteInFlight`; one `forward()` BFF line; `watchlistMock.ts` gains
the new handler + `defaultStrategyId`. *Agent*: `manage_watchlist` gains `default_strategy_id` (create
sets the field; update attaches `update_mask=['default_strategy_id']`, keeping RMW for
name/description/bindings); a new `"assign"` verb on `manage_watchlist_symbols`; `client.py` gains an
`update_watchlist_bindings` wrapper + `_pb` builder; `docs/runbooks/mcp-tools.md` updated in the same
PR with a doc-parity test.

## Rejected Alternatives

- **Fork 1 Option A — default applies to SIGNAL adds too** — rejected: silently binds ingest-signal
  symbols to a user's manual default, a C-16 CHANGE to the signal-add contract needing sign-off; Option
  B (source-aware fill) removes the change entirely.
- **Single-row loop-in-tx for the bulk RPC** — rejected: N round-trips and a wider deadlock window
  (A-then-B vs B-then-A across concurrent bulk-assigns) vs one set-based `symbol = ANY($2)` statement
  that still detects absent symbols by return count.
- **Fold `default_strategy_id` into replace-all `UpdateWatchlist` (no mask)** — rejected: a default-only
  edit would clobber name/description/bindings unless every caller resent the full snapshot (wipe
  footgun); the field mask makes the surgical write first-class.
- **Dedicated `SetWatchlistDefaultStrategy` RPC** — rejected in favor of the field mask: the mask
  generalizes to name/description partial edits and reuses an established platform pattern rather than
  adding a single-purpose RPC.
- **Maskable = `{default_strategy_id}` only / or including `bindings`** — rejected the narrow one (no
  rename+default in one call) and the binding one (collides with the bulk RPC's empty-set semantics and
  the UI hook's always-sent `bindings:[]` would wipe the list); settled on scalar `{name, description,
  default_strategy_id}`.
- **Dedicated agent bulk tool** — rejected vs a new `"assign"` verb on `manage_watchlist_symbols`
  (avoids MCP tool-count churn across the six inventory surfaces; @AC-9 EXTEND).

## Open Risks

- [ ] **Bulk count-parity basis** — the `len(returned) != len(requested)` NOT_FOUND check must compare
  against the **post-`normalizeSymbols` (deduped)** count, else a duplicate symbol falsely trips
  NOT_FOUND. Assert in the bulk RED tests — to be addressed at the portfolio bulk-RPC step.
- [ ] **Legacy-path mask discipline** — existing UI/agent `UpdateWatchlist` flows must keep
  `update_mask` unset (nil) to stay on the byte-for-byte legacy path; add an explicit "existing update
  flows send no mask" assertion at the UI/agent steps.
- [ ] **`get_watchlist` read-surface echo (C-14)** — confirm the agent `get_watchlist` output surfaces
  the new watchlist-level `default_strategy_id` (it rides the `GetWatchlist` proto via
  `MessageToDict`, omitted when `""`); assert in the agent client test — to be addressed at the agent step.
- [ ] **Anti-rebind coverage is fake-modeled** — the no-retroactive-rebind guarantee rests on
  `insertBindingsTx` `ON CONFLICT (watchlist_id,symbol) DO NOTHING` (`watchlist_repo.go:368`), a
  SQL-level guard; portfolio ships no DB test harness, so it is modeled in an extended
  `fakeWatchlistStore.AddSymbols`. Record the "modeled, not DB-tested" caveat on the scenario so a
  future `DO UPDATE` change is flagged — to be addressed at the portfolio test step.

## Constitution Rules Touched

- `C-01` (evidence-cited, no invented paths) — honored: every design claim cites recon `path:line`;
  the dynamic mask SET uses a static allowlist, never invented/interpolated identifiers.
- `C-04` (enum-over-string) — N/A: `strategy_id`/`default_strategy_id` stay open bare strings
  (runtime-extensible, no cross-service FK); `WatchlistEntrySource` is already an enum.
- `C-07` / `F-01` — honored: migration `015` is a new additive `ADD COLUMN` (down present); no applied
  migration edited.
- `C-08` / `C-15` / `P-06` — honored: every service step is test-paired; each `@AC-*` maps to a RED
  assertion (9 mask tests + bulk tests + add-time-default tests + anti-rebind).
- `C-09` — honored: proto step runs `buf lint` + `buf breaking` (additive → green) and `buf-gen.sh`.
- `C-10` (integration completeness) — honored: `default_strategy_id` surfaces through `scanWatchlist`
  on every `Watchlist`-returning path (both SELECT sites `:92`/`:115` widened, list-parity test);
  agent + UI both reach the capability; `mcp-tools.md` updated in-PR.
- `C-14` (consumer surface) — honored: UI `/insights` + agent tools named and stepped (not backend-only).
- `C-16` — see below; no CHANGE, all PRESERVE/EXTEND.
- `C-17` — honored: `ui/*` primitives + tokens, unique accessible names on checkboxes and both Selects.
- `F-04` — honored: all cited symbols verified; `scanWatchlist` has exactly two SELECT consumers, both listed.
- `F-06` / `F-07` — N/A: no pool change, no config key (default is per-watchlist data).
- `P-01`/`P-02`/`P-03` — honored: single-orchestrator debate, mediated proposer/adversary, forks
  surfaced to the operator (Fork 1, write-path, mask scope), none guessed.

## Business Rules Touched (C-16)

- PRESERVE `@AC-2`/`@AC-8 feature-127` "SIGNAL source / provenance badge" (`services/xstockstrat-portfolio/acceptance/consolidate-watchlist-signal.feature`, `services/xstockstrat-ui/acceptance/consolidate-watchlist-signal.feature`) — not regressed: Option B fills only `source != SIGNAL`; `source` never in any new SET.
- PRESERVE `@AC-2..5 feature-167` "single-row rebind: absent→NOT_FOUND, non-owner denied, empty unbinds only that row" (`services/xstockstrat-portfolio/acceptance/watchlist-single-strategy-update.feature`) — not regressed: bulk RPC mirrors the same semantics set-wise; ownership via `loadOwned`.
- EXTEND `@AC-1 feature-167` "targeted single-row rebind" — new case: atomic plural `UpdateWatchlistBindings` added alongside; single-row RPC unaltered.
- PRESERVE `@AC-6 feature-167` (UI) "patch only changed rows, no whole-list invalidate" (`services/xstockstrat-ui/acceptance/watchlist-single-strategy-update.feature`) — not regressed: `useUpdateWatchlistBindings` cache-patches the returned changed rows.
- PRESERVE `@AC-6 feature-127` "EnsureSignalWatchlist idempotent, one system-managed/user" (`services/xstockstrat-portfolio/acceptance/consolidate-watchlist-signal.feature`) — not regressed: `EnsureSystemManaged` INSERT omits the new column (relies on DEFAULT `''`); partial-unique conflict path unaffected.
- PRESERVE `@AC-1/@AC-2 feature-154` "`ListAllWatchlistSymbols` distinct union + authz gate" (`services/xstockstrat-portfolio/acceptance/fundsignal-watchlist-universe.feature`) — not regressed: reads `watchlist_symbols` (different table); internal-caller gate untouched.
- PRESERVE `@AC-7 feature-127` (platform) "system-managed list: delete refused, add/remove-symbol enabled" (`docs/sdd/business-rules/platform.feature`) — not regressed: UI bulk-remove stays enabled on system-managed lists; no delete affordance added.
- EXTEND `@AC-4/@AC-5 feature-148` (agent) "manage_watchlist create / RMW-merge update never wipes symbols" (`services/xstockstrat-agent/acceptance/mcp-watchlist-tools.feature`) — new case: `default_strategy_id` on create + masked update; legacy no-mask path never writes the column so a name-only edit cannot drop it.
- EXTEND `@AC-9 feature-148` (agent) "unknown verb rejected before any RPC" — new case: allowed-verb set grows by `"assign"`; `"replace"`/unknown still reject.
- PRESERVE `@AC-2/@AC-7 feature-148` (agent) "get_watchlist returns bindings incl. strategy_id / add stamps MANUAL" — not regressed: `default_strategy_id` is additive, no read-time synthesis of per-symbol bindings; add keeps MANUAL source.
- CHANGE: none (all guarantees preserved or extended; no user sign-off required).
