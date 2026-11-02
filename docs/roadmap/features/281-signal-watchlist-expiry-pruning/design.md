# Design: signal-watchlist-expiry-pruning

**Created**: 2026-10-31
**Rounds**: 4 (quick mode, user-extended; termination: approved)
**Approved by**: user @ 2026-10-31 (AskUserQuestion design gate, round 4)
**Grounded in**: recon.md

---

## Chosen Approach

Remove `source=SIGNAL` entries from a user's system-managed signal watchlist once every **agent-recorded watchlist-direction signal** backing the entry has expired, using a side table plus an in-process portfolio prune loop. No new service edge, no ingest/analysis code change.

**Why not a simple "delete where expired"**: a SIGNAL entry stores only `(watchlist_id, symbol, strategy_id, source, added_at)` (`recon.md` Premise Verdict; `migrations/007:16-21`, `008:7-8`, `011:31-32`) and the agent's add call never passes `valid_until`/`signal_id` (`tools.py:642` vs `:686-696`; `client.py:319-327`). The entry must be given a link before it can be pruned. Scope is **portfolio only**: analysis opportunities already exclude expired rows (`opportunities.py:226`) and ingest signal rows are passive-by-design (`recon.md`).

### 1. Data — portfolio migration `018_watchlist_signal_expiry` (idempotent; replayed by `migration-rerun`, `ci.yml:650-688`)

```sql
CREATE TABLE IF NOT EXISTS portfolio.watchlist_signal_expiry (
  watchlist_id UUID        NOT NULL REFERENCES portfolio.watchlists (watchlist_id) ON DELETE CASCADE,
  symbol       TEXT        NOT NULL,
  valid_until  TIMESTAMPTZ NOT NULL,
  signal_id    BIGINT,        -- NULL = operator-marked "untracked" by the backfill
  PRIMARY KEY (watchlist_id, symbol)
);
CREATE INDEX IF NOT EXISTS watchlist_signal_expiry_valid_until_idx
  ON portfolio.watchlist_signal_expiry (valid_until);
```
`down.sql`: `DROP TABLE IF EXISTS portfolio.watchlist_signal_expiry;`. FK is to `watchlists` only, never to `watchlist_symbols`: replace-all `Update` deletes and re-inserts every binding (`watchlist_repo.go:210-213`), so a cascade from bindings would untrack every entry on each rename. **Open-ended tracking = absence of a row** (hence `valid_until NOT NULL`). No `reason` column / proto enum: the marker is `signal_id IS NULL` and the two removal kinds are separate ledger event types (C-04 not engaged — nothing is exposed in proto).

### 2. Proto — additive (`packages/proto/portfolio/v1/portfolio.proto:328-333`, `Timestamp` already imported `:7`)

```proto
message WatchlistSignalProvenance { int64 signal_id = 1; google.protobuf.Timestamp valid_until = 2; }
// AddWatchlistSymbolsRequest:  WatchlistSignalProvenance signal_provenance = 4;
```
`WatchlistBinding` is **not** touched, so the hand-rolled normalizers (`normalizeBindings :1807`, `requestBindings :1830`, `applyDefaultStrategy :1847`) are untouched (avoids the feature-127 normalizer trap, `fails.md` 2026-08-26). Provenance is accepted **only with a `valid_until` (seconds>0)**; the agent sends **no provenance** for open-ended signals, which untracks (below). `AddWatchlistSymbols` (`portfolio_service.go:2166`) returns `InvalidArgument` if provenance is present and: the list is not `system_managed`, the normalized add set is not exactly one `source=SIGNAL` binding, `signal_id <= 0`, or `valid_until` is unset/`seconds<=0`.

### 3. Add path (`AddSymbols`, `watchlist_repo.go:280-`; `insertBindingsTx :494` returns the inserted-symbol set via per-row `RowsAffected`; `Create`/`Update` ignore it)

Inside the existing tx, after `touchWatchlistTx` has locked the parent (`:287`):
- **Fresh insert + provenance** → `INSERT … ON CONFLICT (watchlist_id,symbol) DO UPDATE SET valid_until=EXCLUDED.valid_until, signal_id=EXCLUDED.signal_id` (**overwrite**: any existing row for a freshly inserted binding is an orphan).
- **Existing SIGNAL binding + provenance** → update-only **merge** (0 rows when untracked ⇒ stays untracked):
  `valid_until = CASE WHEN signal_id IS NULL THEN $3 ELSE GREATEST(valid_until,$3) END`, `signal_id = CASE WHEN signal_id IS NULL OR $3 >= valid_until THEN $4 ELSE signal_id END`. A marked row (`signal_id NULL`) is rescued by a live dated signal; the merge constant is shared with the backfill.
- **Existing MANUAL binding + provenance** → no write (first-writer-wins `ON CONFLICT DO NOTHING`, `:497-499`).
- **Provenance-less add whose REQUEST binding source is SIGNAL** → `DELETE` the expiry row (**untrack**: entry is never pruned; also rescues a marked row). MANUAL/UNSPECIFIED request sources (agent `add_watchlist_symbols` `client.py:536-538`, replace path `:487-488`, legacy flat `symbols` `portfolio_service.go:1835-1839`) never untrack, so a MANUAL add of a tracked SIGNAL entry changes neither its source nor its tracking.
- Untrack-on-provenance-less-add is what makes version skew (old agent, rollout window, rollback) fail **safe** (never prunes early) with no deploy-order coupling and no pause switch.
- The source check is a plain `SELECT source` (safe: every deleter locks the parent first and this tx holds it).

### 4. Prune loop — `go svc.PruneExpiredSignalEntries(ctx)` after `go svc.HydrateStops(ctx)` (`cmd/server/main.go:77`, root ctx, no `PropagationData`)

One tick at startup, then sleep `interval()` re-read live each iteration via `s.wlCfg.GetInt` (pattern `portfolio_service.go:1869`; `config.go:126`). Key `portfolio.watchlist.signal_prune_interval_seconds` (int, default 300, write bounds `{60,86400}` in `SCALAR_BOUNDS_REGISTRY` `configServiceImpl.ts:103`, **unseeded** per the 227-D2 waiver `config-governance.md:144`); reader `clampPruneInterval`: `<=0`→300, `1..59`→60, `>86400`→86400. **No pause switch** (user sign-off). Tick enumerates `SELECT DISTINCT watchlist_id FROM watchlist_signal_expiry WHERE valid_until <= now()` (DB clock — no Go-clock/after-await trap, `fails.md` 2026-08-16), then **one short tx per watchlist that never waits**:
1. `SELECT user_id FROM watchlists WHERE watchlist_id=$1 FOR NO KEY UPDATE SKIP LOCKED` (none ⇒ skip, counted).
2. `SELECT symbol, signal_id, valid_until FROM watchlist_signal_expiry WHERE watchlist_id=$1 AND valid_until<=now() FOR UPDATE SKIP LOCKED` ⇒ D.
3. `SELECT symbol FROM watchlist_symbols WHERE watchlist_id=$1 AND symbol=ANY($D) AND source=2 FOR UPDATE SKIP LOCKED`; `DELETE … RETURNING symbol, strategy_id` ⇒ R.
4. `DELETE FROM watchlist_signal_expiry e WHERE watchlist_id=$1 AND symbol=ANY($D) AND (symbol=ANY($R) OR NOT EXISTS (SELECT 1 FROM watchlist_symbols s WHERE s.watchlist_id=e.watchlist_id AND s.symbol=e.symbol AND s.source=2))` (rows of removed entries + expired orphans; a binding skipped in step 3 stays SIGNAL so its row survives to the next tick).
5. If R non-empty: `UPDATE watchlists SET updated_at=now()`; commit.
6. After commit, one ledger event per R row via `emitEvent` (`:1140`): `portfolio.watchlist.signal_entry_expired` `{user_id, watchlist_id, symbol, strategy_id, signal_id, valid_until}` when the D row had a `signal_id`, else `portfolio.watchlist.signal_entry_removed_untracked` `{user_id, watchlist_id, symbol, strategy_id}`. Stream key `"watchlist:"+id`. **Owner**: `emitEvent` gets an owner parameter/variant that sets the existing `AppendEventRequest.user_id` (`ledger.proto:51`, precedence at `ledgerServiceImpl.ts:76-78`); a fresh `x-trace-id` rides in outgoing metadata (C-03; the interceptor leaves a `PropagationData`-less ctx alone, `propagation.go:41`).
7. Per-list error ⇒ rollback + WARN + continue; `slog.Info` per tick with `tracked/skipped/removed`.

Lock-order proof (verified in code): `AddSymbols/RemoveSymbols/Update` lock the parent first (`:287,307,201`); `UpdateBinding/UpdateBindings` write the symbol row first and touch the parent last (`:337→347`, `:371→402`); the prune only uses `SKIP LOCKED`, never waits, so it cannot be part of a deadlock cycle (an `UpdateBinding` that loses a race gets `ErrBindingNotFound`, `:341`, accepted). `instance_count: 1`, but `SKIP LOCKED` + emit-only-rows-actually-deleted keeps extra instances correct.

### 5. Backfill — subcommand of the portfolio binary: `portfolio backfill-signal-expiry --mode=report|apply --legacy-owner <id> [--expect-untracked N --expect-seed-expired M]`

- Dispatched like `healthcheck` (`main.go:31`), **before** `config.NewWatcher`/mTLS (`:55,87`); pool via `repository.NewPortfolioRepo(...).Pool()` (`portfolio_repo.go:37,55`) — no `NewPool` export. Refuses an empty `DATABASE_URL` (`config.go:39` defaults it to `""`); prints `target host=… db=…` first. The image is distroless with no shell (`Dockerfile:10`), so the **runbook runs it from an operator workstation** against the pooled `:25061` URL with `DB_PGBOUNCER=true` (`pool.go:31`), per `legacy-formula-authors.md:41-73` and `operator-db-access.md` (no console sessions; F-06: one transient pooled client).
- **Candidate query** (SIGNAL bindings on `system_managed` lists with no expiry row) joined to `ingest.newsletter_signals` (same database; portfolio's role can SELECT `ingest.*` — same `doadmin` credentials, no GRANTs in migrations) on `n.user_id = w.user_id AND lower(n.direction)='watchlist' AND upper(btrim(n.symbol)) = s.symbol`: any open-ended row ⇒ stays **untracked** (skipped); else `max(valid_until)` ⇒ **seed** with that row's `signal_id` (`max<=now()` ⇒ `seed_expired`); no row ⇒ **untracked ⇒ mark** `{valid_until=now(), signal_id NULL}`. Over-inclusion (counts every watchlist-direction row the owner has, incl. non-agent rows) prunes **late, never early**.
- **REPORT** = read-only tx (no locks, never write-then-rollback). Prints header (`legacy_owner`, "read-only"), SEED rows (+`seed_expired`), UNTRACKED rows `(owner, watchlist_id, symbol, strategy_id, legacy_rows, legacy_live)` + `with_live_legacy_signal`, a PER-OWNER table (`signal_entries, seed, seed_expired, untracked, own_signal_rows_total, flag NO_OWN_SIGNALS`), and the `NEXT:` command with the exact `N`/`M`. `--legacy-owner` is **required** in both modes (the portfolio runtime has no `SEED_USER_ID`; it exists only on the db-migrator job `.do/app.yaml:668-685`, and a workstation `.env` would give a dev value `.do/app.yaml:682`); APPLY refuses if it differs from the value REPORT printed. `legacy_*` columns are information only (behavior unchanged).
- **APPLY** refuses **before writing** if live untracked > N or seed_expired > M, then writes **one autocommit statement per row** in deterministic order. **Each statement recomputes from ingest at statement time** (`INSERT … SELECT … LEFT JOIN ingest.newsletter_signals n … WHERE EXISTS(SIGNAL binding) AND NOT EXISTS(open-ended row) AND <row still in the class REPORT named> ON CONFLICT DO NOTHING`): a row whose class changed is skipped and counted "changed since REPORT". This closes the race with a concurrent ingest+agent-add: if the signal commits before the statement it is seen; if after, the agent's add finds the mark/seed row and the merge/rescue fixes it. N and M are at-most bounds; partial apply + abort is idempotent on re-run.
- **The CLI never deletes bindings**: the in-service prune is the single deleter (no CLI ledger/mTLS access, no `UpdateBinding` deadlock). CLI locks: ≤1 expiry-row lock at a time; FK check takes `KEY SHARE` on `watchlists` (compatible with `FOR NO KEY UPDATE` and `touchWatchlistTx`'s non-key `UPDATE`, `:481`); a system list cannot be deleted (`portfolio_service.go:2153`); prune step 2 skips rows the CLI holds.
- **Strict removal (user sign-off)**: every SIGNAL entry with no `direction='watchlist'` row under the owner's **own** `user_id` is marked and removed by the next tick — knowingly including pre-feature-224 owners whose signal rows were reassigned to `SEED_USER_ID` (`ingest migrations/013_signal_ownership_templates.up.sql:70`) while their watchlists kept real owners. REPORT's `NO_OWN_SIGNALS`/`legacy_live` columns make that visible; remediation is a MANUAL re-add. **No grace period** (user sign-off): marks are due immediately.
- **Emergency stop** (runbook): `DELETE FROM portfolio.watchlist_signal_expiry WHERE signal_id IS NULL` (marks only) or `TRUNCATE portfolio.watchlist_signal_expiry` (everything untracked; re-run the idempotent backfill to re-seed); must run within one interval of APPLY (every restart also ticks); rolling portfolio back is the second line. Raising the interval is **not** a pause (the current sleep finishes first).
- Order: proto → portfolio (018) → agent → backfill. Version skew is safe either order (old portfolio drops unknown field 4 under proto3; old agent only untracks).

### 6. Agent (`xstockstrat-agent`)

`client.add_watchlist_symbol(user_id, wl_id, symbol, signal_id, valid_until)` (`client.py:315`) builds `WatchlistSignalProvenance` only when `valid_until` is dated (reusing `_iso_to_timestamp`, `client.py:242`); `tools.py:692` passes `result["signal_id"]` and `valid_until`. Gate (`:688`) and best-effort `except` (`:693-696`) unchanged. `ingest_signal` docstring (`tools.py:628-630`), the `get_watchlist` docstring and `docs/runbooks/mcp-tools.md` each gain a sentence (EXTEND agent `@AC-5`: watchlist entries now expire; a validation failure drops the auto-add). Tool count stays 45 (six surfaces unchanged — verify, no edit).

### 7. Consumer surface (C-14)

- **UI** (`/insights/watchlists`, already in `PLATFORM_SUBNAV` — C-10(a) satisfied): **no code change**; the list simply shrinks and refreshes on refocus/remount/mutation (`useWatchlists.ts:25-35`, `queryClient.ts:22`). An emptied system list renders the existing bare `No symbols` line (`WatchlistDetail.tsx:249`) with delete hidden (`:223`); the e2e step asserts that actual behavior. Swapping it for `EmptyState` is out of scope. Silent removal is signed off (the ledger event is the audit).
- **Agent**: see §6.

### 8. Tests (paired per C-08; AC→test map in the implementation step)

Real-Postgres tests in `internal/repository/*_db_test.go` behind `-tags dbtest`, run by a new `portfolio-db-test` CI job (modelled on `ledger-db-test`, `ci.yml:711-768`; also runs ingest's migrations with `SEED_USER_ID` rendered, as `scripts/migration-rerun.sh:9`; added to the aggregate gate `needs`/summary `ci.yml:912-937` and the changes filter). T0 migration replay; T1 units (validation, clamp, intent mapping); T2 add path (fresh overwrite / merge / MANUAL / untrack / rescue / expired provenance does not rescue); T3 prune tick; T4 concurrency, both interleavings, with the test pool's `lock_timeout=500ms` so a wait fails deterministically (prune vs renewal, vs replace-all, vs `RemoveSymbols`, vs `UpdateBinding` mirroring its SQL order, **plus** an ingest+agent-add interleaving between the backfill's candidate read and its row write); T5 events (assert request `user_id` + non-empty trace id); T6 replace-all/rename keeps tracking, MANUAL re-stamp swept silently; T7 backfill (`" aapl"`/`"AAPL"`, legacy-owner row, strict removal, bounds refusal, idempotent rerun); T8 agent pytest; T9 config bounds rows (full-dotted and namespace-relative, `setConfigScalarBounds.test.ts`).

## Rejected Alternatives

- **Analysis-hosted sweeper reading every owner's signals** (option b) — needs a new ingest `system` grant that weakens features 224/225 plus two gated cross-user portfolio RPCs; rejected by the user. It is the only option that would keep "every signal" literally true going forward and cover non-agent signals.
- **New portfolio→ingest edge** — Platform Lead gate, new `INGEST_ENDPOINT` in compose + both `.do` files, same grant problem.
- **Lazy prune on read** — still needs the link, puts writes on read paths, and `ListAllWatchlistSymbols` (`watchlist_repo.go:423`) would keep serving stale symbols.
- **Expiry column on `watchlist_symbols` / field on `WatchlistBinding`** — replace-all wipes it (`:210-213`) and it would drag every normalizer/scan along (feature-127 trap).
- **FK cascade from `watchlist_symbols` to the expiry table** — replace-all would untrack every entry on each rename.
- **Blocking `FOR UPDATE` prune / one global prune tx** — deadlocks with `UpdateBinding`'s symbol-then-parent order (`:337→347`).
- **Backfill CLI deleting bindings itself** — deadlocks with `UpdateBinding`, makes two deleters, and would need ledger/mTLS access from an operator host.
- **`reason` column / proto enum / payload field** — duplicates `signal_id IS NULL` + the event type (C-18).
- **Separate backfill binary + `NewPool` export; Python `scripts/` backfill; psql script** — the subcommand reuses the repo pool and shared merge SQL; a Python script would duplicate the SQL and no CI runs `scripts/tests`.
- **Pause switch (interval 0)** — removed by the user; untrack-on-add + `TRUNCATE` + rollback cover the operational need.
- **Legacy-owner match that never removes** (adversary-recommended) and **list-only REPORT** — declined by the user in favor of strict removal.
- **Pin on manual add** (MANUAL add converts a SIGNAL entry) — would CHANGE feature 127's first-writer-wins rule; declined.
- **Agent retry of a failed renewal add** — narrows but does not close the window; accepted as residual risk instead.
- **Mark grace period (`valid_until = now()+1h`)** — offered, declined by the user.
- **Skip the add for an already-expired signal** — would CHANGE platform `@AC-1` (feature 127); add-then-prune accepted.

## Open Risks

- [ ] **Strict untracked removal deletes live pre-224 legacy-owner entries** (signed off; `NO_OWN_SIGNALS`/`legacy_live` flagged in REPORT; undo = manual re-add from the pasted REPORT + `removed_untracked` events) — runbook + backfill step.
- [ ] **No grace period + APPLY→tick ≤300 s irreversibility**; emergency stop depends on a human acting within one interval (every restart ticks) — runbook step.
- [ ] **Failed or deduplicated renewal add ⇒ early prune** at the old expiry (agent add is best-effort `tools.py:688-696`; no retry) until the next non-deduplicated ingest — agent step + docs.
- [ ] **Signals not ingested through the agent are never tracked**; buy/sell signals never keep an entry alive (FR-2/FR-3 narrowing, signed off) — docs.
- [ ] **MANUAL add does not pin** a SIGNAL entry; a replace-all re-stamping it MANUAL makes it permanently immune (feature-127 first-writer-wins kept; R6 untouched) — `mcp-tools.md` sentence.
- [ ] **Add-then-prune of an already-expired signal** (accepted) — docs.
- [ ] **Ledger event lost** on a crash between commit and emit or after retries (same as every `emitEvent`); the pasted REPORT is the authoritative record for backfill removals — portfolio step.
- [ ] **Backfill seeds late, never early** (counts all owner watchlist-direction rows incl. non-agent and legacy-reassigned rows) — runbook.
- [ ] **Silent removal in the UI**; list refreshes only on refocus/remount/mutation; `UpdateBinding` may return `ErrBindingNotFound` when racing a prune — accepted.
- [ ] **T4 mirrors `UpdateBinding`'s lock order**; a future reorder must update the test — test step comment.
- [ ] **Multi-instance**: correctness does not rely on `instance_count: 1`, but load multiplies per instance.

## Constitution Rules Touched

- `C-03` — honored by: owner on the ledger request (`user_id`) + fresh `x-trace-id` in metadata for background-origin events; `x-access-scope` is absent on background emits (recorded).
- `C-04` — honored by: no new enum; `source` stays the existing enum; marker is a NULL discriminator, event types distinguish removal kinds.
- `C-05` / `F-07` — honored by: key `portfolio.watchlist.signal_prune_interval_seconds` read live via `GetInt`; only two reader-safety constants fixed in code (default 300, floor 60); unseeded per the 227-D2 waiver.
- `C-07` / `F-01` — honored by: new migration `018` (last is `017`); no applied migration edited; idempotent for `migration-rerun`.
- `C-08` / `P-06` — honored by: every service step has a paired test step with RED-first; real-DB concurrency tests prove the `SKIP LOCKED` claims.
- `C-09` — honored by: `buf lint` + `buf breaking` + `./scripts/buf-gen.sh` on the additive proto step.
- `C-10` — honored by: both insert sites share the split `insertBindingTx`; `normalizeBindings` stays the single source site; portfolio read paths (`GetWatchlist`/`ListWatchlists`/`ListAllWatchlistSymbols`) shrink consistently because the delete is in the table they read.
- `C-12` / `C-13` — honored by: UI test data via `e2e/fixtures/` (`watchlistMock.ts`, `INVENTORY.md` row 43); Go fixtures inline until a second consumer.
- `C-14` — honored by: UI named (no code change, silent removal signed off) and Agent named (docstrings + runbook step); no surface deferred.
- `C-15` — honored by: `acceptance.feature` AC-1..AC-18, each covered by a named test step; AC-1..AC-7 IDs unchanged (Given/Then reworded pre-implementation only — C-15 forbids renumbering).
- `C-16` — honored by: see Business Rules Touched; no CHANGE.
- `C-18` — honored by: one table, one additive proto field, one goroutine, one config key; cut: `reason` column, pause switch, plan digest, `NewPool` export, separate binary, seed migration, ingest index, prune/trigger RPC; kept with justification: side table (replace-all constraint), backfill (user-mandated backlog cleanup), `portfolio-db-test` job (lock behavior unprovable with fakes).
- `F-02` — honored by: the subcommand is shipped via PR; no console exec path; no direct pushes.
- `F-04` — honored by: every cite from recon.md/discovery; nothing invented (ungrounded items are listed as assumptions in the spec step).
- `F-06` — honored by: portfolio stays on the pooled `:25061` route; the backfill is one transient pooled client; `DB_POOL_MAX` unset.
- `P-03` — honored by: every silent fork was surfaced to the user and recorded in `context.md` (scope narrowing, strict removal, pin, failed renewal, silent UI, grace, kill switch).

## Business Rules Touched (C-16)

- EXTEND `@AC-1` "A watchlist-direction signal adds the symbol to the caller's system-managed watchlist" (`docs/sdd/business-rules/platform.feature`, feature 127) — new case: the add now carries provenance and the entry later expires (inverse lifecycle step).
- EXTEND `@AC-5` (agent, feature 127, `services/xstockstrat-agent/acceptance/consolidate-watchlist-signal.feature`) — docstring and `mcp-tools.md` both describe the expiry removal.
- PRESERVE platform `@AC-2` (non-watchlist directions cause no mutation) — not regressed by: provenance is sent only from the `direction="watchlist"` auto-add (`tools.py:688`).
- PRESERVE platform `@AC-3` (deduplicated ingest does not re-add) — not regressed by: gate unchanged; a later-`valid_until` re-ingest is `deduplicated=false` by design (`servicer.py:1063-1073`), identical in-window re-ingest still adds nothing.
- PRESERVE platform `@AC-7` and portfolio `@AC-6` (system list never deleted, one per user, manual remove stays) — not regressed by: only entries are removed, never the list.
- PRESERVE feature 167 `@AC-2` (rebind keeps `source`) — not regressed by: `UpdateBinding` never touches `source` or expiry rows.
- PRESERVE feature 154 `@AC-1`/`@AC-2` (`ListAllWatchlistSymbols` union + caller gate) — not regressed by: no new cross-user RPC; the union shrinks as entries are pruned.
- PRESERVE feature 170 `@AC-4`/`@AC-5` (bulk all-or-nothing, owner-scoped) — not regressed by: bulk paths not reused.
- PRESERVE agent `@AC-4` (portfolio failure never fails the committed ingest) and `@AC-6`/`@AC-7`/`@AC-8` (feature 148) — not regressed by: add stays best-effort; MANUAL stamping of curation tools unchanged.
- PRESERVE UI `@AC-8` (badge on SIGNAL only) and ingest `@AC-9` (signals owner-scoped, rows not deleted), `@AC-4`/`@AC-2` — not regressed by: no UI/ingest code change; the backfill only reads ingest.
- PRESERVE analysis `@AC-8`/`@AC-9` (190), `@AC-8`/`@AC-10` (260 `valid_until` anchoring) — not touched.
- Strict untracked removal is a **one-time data remediation, not a CHANGE** to a durable business rule: no `platform.feature` scenario asserts SIGNAL entries persist (platform `@AC-1`, `platform.feature:17-22`, covers only the add). It does contradict this feature's own FR-3 for legacy owners; that contradiction is signed off (`context.md`, round 3).
- Launch promotion (C-16): AC-2..AC-18 → `services/xstockstrat-portfolio/acceptance/signal-watchlist-expiry-pruning.feature`, with AC-15..AC-17 tagged `@operator-backfill` and the agent scenarios mirrored into the agent suite.

## Implementation outline (advisory input to /sdd-spec)

| Step | Area | Work | Gate | Paired test |
|---|---|---|---|---|
| S1 | proto | `WatchlistSignalProvenance` + field 4; buf lint/breaking; `buf-gen` | 1 owner | — |
| S2 | portfolio migration | `018` up/down | DBA + owner | T0 |
| S3 | CI | `portfolio-db-test` job (+ ingest migrations), aggregate gate | CI | — |
| S4/S5 | portfolio add path | split `insertBindingTx`, intent, validation, merge/overwrite/untrack | owner | T1, T2, T6 |
| S6/S7 | portfolio prune | loop, statements, events (`emitEvent` owner), interval clamp | owner | T1, T3, T4, T5 |
| S8/S9 | config | bounds registry entry + dual-form test rows; governance log | owner + config team | T9 |
| S10/S11 | portfolio backfill | subcommand, REPORT/APPLY, `--legacy-owner` | DBA + owner | T4 (ingest interleaving), T7 |
| S12/S13 | agent | provenance on auto-add, docstrings | agent owner | T8 |
| S14 | docs | portfolio `CLAUDE.md` (key, 2 events, table, loop, subcommand), `docs/patterns/database.md`, `docs/patterns/config-governance.md`, new `docs/runbooks/signal-watchlist-expiry-backfill.md` + `docs/runbooks/CLAUDE.md` row, `mcp-tools.md` | — | — |
| S15 | ui e2e | emptied system list renders `No symbols`, no delete affordance (fixture via `INVENTORY.md`) | — | — |

Deploy order: proto → portfolio → agent → backfill.
