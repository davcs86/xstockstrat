# Context: ledger-event-export

**Feature**: `docs/roadmap/features/021-ledger-event-export/feature.md`
**Product Spec**: `docs/roadmap/features/021-ledger-event-export/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/021-ledger-event-export/implementation-spec.md`

---

## Session 2026-05-26T00:00:00Z — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Feature number assigned: 021.
- No proto changes required; HTTP-only addition to ledger service.
- Two open questions deferred to /sdd-spec: nginx proxy vs. direct port, and which UI hosts the download button.

## Session 2026-08-31 — sdd-story (in-place regenerate)

- Regenerated product-spec.md to the current C-14/C-15 template (added Consumer Surface, Proto/Config/DB checkboxes, Feature Workflow Notes; moved the inline acceptance list out to acceptance.feature and left only the pointer).
- Authored acceptance.feature with 9 `@AC-*` scenarios; every FR (FR-1…FR-8) is covered by ≥1 tagged scenario.
- Preserved all existing scope verbatim — every FR, both config keys, affected services, out-of-scope items, and both original open questions carried over unchanged; no requirements invented or dropped.
- Added two "Known trap" open questions from the ledger (config-key native type off WatchConfig; ledger global-sequence ordering). Kept feature number 021 and status `draft`.

## Session 2026-08-31 — sdd-review fixes (product-spec)

Product-spec review returned FAIL: the spec predated the gRPC-only migration and feature 045 (nginx removal). Applied every fix; kept number/slug 021 and status `draft`.

- **Transport reframe (FR-1/FR-5).** Rewrote the export from a ledger `GET /export` HTTP endpoint on port `8057` (behind nginx) to a **server-streaming gRPC RPC** `ExportEvents(ExportEventsRequest) returns (stream ExportEventsResponse)` on `xstockstrat-ledger` (gRPC 50057), fronted by an **`xstockstrat-ui` BFF route** (`.../api/ledger/export`) that re-exposes HTTP to the browser (NDJSON default, CSV via `format=csv`). Deleted every "port 8057" and "from nginx" claim. Re-anchored FR-5 auth on the ui middleware (verifies JWT, injects `x-user-id` / `x-access-scope` / `x-trace-id`) forwarded to the ledger; unauthenticated → 401 (or login redirect), never reaches the ledger. Verified against `packages/proto/ledger/v1/ledger.proto` (append-only `LedgerService`, additive RPC), `services/xstockstrat-ledger/CLAUDE.md` (8057 removed, gRPC-only), and `services/xstockstrat-ui/CLAUDE.md` (BFF + middleware header injection).
- **Affected Services correction.** Removed the non-registry names `xstockstrat-trader` / `xstockstrat-insights`; the surfaces are now `xstockstrat-ledger` (new streaming RPC), `xstockstrat-ui` (BFF route + download button; exact `/trader` vs `/insights` segment decided at design), and `packages/proto` (new RPC).
- **Proto Contract Changes.** Flipped from "no proto changes" to an **additive, non-breaking** new server-streaming RPC + `ExportEventsRequest`/`ExportEventsResponse` messages in `ledger/v1/ledger.proto`; flagged the **1 service owner + Proto Reviewer** approval gate (not the breaking 2-owners-plus-platform-lead gate) and noted `buf breaking` must pass + `git diff packages/proto/gen/` should show only additive stubs.
- **Open Questions reorganization.** No unchecked genuine-unknown `- [ ]` remains under `## Open Questions` — it now reads "None". The transport question is resolved inline; the UI-segment choice moved to a new `## Design-Phase Decisions (owned by /sdd-design)` section (plain bullet); the config-key native-type trap and the ledger global-sequence-ordering trap moved to a new `## Design Guardrails` section (plain bullets).
- **C-14 (warning).** Stated the segment choice is decided at design (Design-Phase Decisions), not an open-ended deferral.
- **acceptance.feature.** Rewrote all scenarios from the HTTP `GET /export` / `Content-Type` model to the gRPC-RPC-via-BFF model, keeping every `@AC-*`/`@FR-*` tag and full FR coverage. Added global-sequence ordering to AC-1 and a new **FR-9** (+ **AC-10**) covering the `ledger.export.enabled=false` disabled path. Concrete example values (dates, counts, `evt_9f21`, `u_42`, `xstockstrat-trading`) preserved.

## Session 2026-08-31 — sdd-review product-spec (approved)

- Product spec approved: `draft` → `spec-ready`. All `/sdd-review` blockers and warnings were addressed (see the sdd-review-fixes session above).
- NOTE: the confirming re-review pass was interrupted by a session usage/rate limit; fixes were applied against each reviewer's explicit findings. For 021 specifically, the orchestrator manually caught and fixed a residual field-name error (`service_origin` → `source_service`; the ledger `Event` has no `user_id` field). A quick re-review can re-confirm on resume.

## Session 2026-08-31 — per-user scoping restored (operator decision)

- Operator directive: the export MUST be per-user. Restored `user_id` and made per-user a fixed requirement rather than a deferred design question.
- FR-7 exports a `user_id` column again; added FR-10 (per-user isolation — a caller only ever exports their own events). AC-8 restores the `user_id` key; new AC-11 asserts cross-user isolation (u_42 sees evt_a1, never u_99's evt_b2).
- Because the ledger `Event` had no `user_id`, this feature now ADDS one: an additive `user_id` field on the `Event` message + `AppendEventRequest` (stamped from `x-user-id` at write time) and a nullable `user_id` column + per-user index on the events hypertable (additive migration). Scope grew from proto-only to proto + DB migration; DBA gate now applies.
- Remaining design choices (attribution mechanism for existing producers/event types, handling of NULL-user_id historical rows) are recorded as a § Design-Phase Decision — the per-user REQUIREMENT (FR-10) is fixed, only the mechanism is open.

## Session 2026-08-31 — sdd-design (FULL mode)

Wrote `recon.md` + `design.md`. Grounded recon (cited `path:line`), then a 3-round adversarial
debate. `spec-ready` → **design-approved** (design gate; C-11 satisfied).

**Design-Phase Decisions resolved:**

- **(a) UI segment = `/trader`.** `/trader` BFF already registers `LedgerService`
  (`traderBff.ts:112`); `/insights` BFF registers no ledger service. Fills / P&L snapshots are
  account-record (Book) data; tax/audit export is an account-owner op. Button added to an **existing**
  `/trader` page (no new route → no C-10(a) nav work); BFF export is a bespoke `route.ts` GET
  streaming NDJSON/CSV (not a Connect-router entry), modeled on `config-ui/api/audit/route.ts`.

- **(b) Attribution = dual-channel write path + trading-only producer change.** Ledger `appendEvent`
  resolves `user_id = req.user_id || x-user-id metadata || NULL` — this requires a **new** server-side
  inbound-metadata read (the ledger has NO gRPC interceptor today, `index.ts:64`;
  `middleware/propagation.ts` is the dead HTTP helper). Within this feature, update **only
  `xstockstrat-trading`** to thread the owning `user_id` into `emitLedgerEvent` (`trading.go:3607-3620`)
  for its user-owned events, because fills are emitted from **background pollers** with no inbound
  `x-user-id`, so pure server-side stamping would leave every fill NULL — the headline use case and
  the only event class the acceptance suite attributes per-user (AC-8/AC-11). Other producers ride the
  metadata fallback (C-03) or a **named follow-up** `021b-ledger-producer-attribution`.

- **(c) Historical NULL rows = excluded (not backfilled).** Backfill is impossible by construction —
  `deny_mutation` triggers block UPDATE on `ledger.events` (`001…up.sql:46-60`). `WHERE user_id =
  $caller` auto-excludes NULL, satisfying FR-10 isolation + historical exclusion in one predicate.
  No admin-sees-all scope (out of acceptance scope → follow-up).

- **Streaming/ordering/config:** batched `ExportEventsResponse { repeated LedgerEvent events }` per
  cursor page; order by global `sequence` (`ledger.proto:29`; `insights.md` 2026-08-26 §042), not
  `recorded_at`. **Dedicated `pg` Client outside the `DB_POOL_MAX=1` write pool** (EventNotifier
  precedent) + `pg-cursor` — reuses the documented write-starvation scar as the reason (F-06;
  budget-table re-check is Open Risk 1). Config getters `getInt`/`getBool` (`configWatcher.ts:89,99`)
  cast from the native oneof arm and preserve `0`/`false` via `??`; the fail-open trap is on the
  **seed** (native type, never `stringVal`), recorded as Open Risk 2 (`fails.md:1230`, `:341`).

**Proto:** additive — `ExportEvents` RPC, request/response msgs, `LedgerEvent.user_id=11`,
`AppendEventRequest.user_id=9`. **Migration:** next `003` nullable `user_id` + `(user_id, sequence)`
index. No unresolved Floor breach. Open risks mirrored into design.md § Open Risks.

## Session 2026-08-31 — sdd-spec

- Generated implementation-spec.md with **13 steps**. (status.md/feature.md intentionally left
  untouched in this run per the task's write-scope constraint; normally /sdd-spec would flip
  status → `implementation-ready` and append a feature.md Status History row.)
- Key codebase findings (grounded `path:line`):
  - **Ledger migration tip = `002_idempotency_keys` → next NNN = `003`** (`services/xstockstrat-ledger/migrations/`).
  - **Config-key seed migration tip = `021_notify_push_min_severity` → next NNN = `022`** (`services/xstockstrat-config/migrations/`); `ledger.export.*` keys seed into `config.config_values` per environment, `value_type` `int`/`bool` (never `string` — the fail-open trap, mirrors `021…up.sql`).
  - **Proto field numbers:** `LedgerEvent` max = `stream_key = 10` → `user_id = 11`; `AppendEventRequest` max = `idempotency_key = 8` → `user_id = 9` (`packages/proto/ledger/v1/ledger.proto:20-46`). Additive RPC + fields → `buf breaking` passes.
  - **Two TS stub flavors** regenerate from one `./scripts/buf-gen.sh`: ts-proto on the ledger (`LedgerServiceService`, `serviceDefinition.ts:1`) and connect-es on the UI (`LedgerService`, `connectClients.ts:8`); Go `ledgerv1` on trading.
  - **F-06 dedicated-connection precedent** = `EventNotifier` `pg.Client` outside the `DB_POOL_MAX=1` pool (`ledger index.ts:53-57`); export opens its own short-lived `pg.Client` + `pg-cursor`, never `this.pool`.
  - **`pg-cursor` is absent** from `services/xstockstrat-ledger/package.json` → must be ADDED (dep + `pnpm-lock.yaml`).
  - **`appendEvent` reads no inbound metadata today** (`ledgerServiceImpl.ts:28`; ledger has no gRPC interceptor, `index.ts:64`) → Step 4 adds `req.userId || call.metadata x-user-id || NULL` + the `user_id` insert column + `rowToEvent` mapping.
  - **Trading fills emit on `context.Background()`** with `order.UserId` in local scope but only inside the payload (`trading.go:1712-1717,1728-1733`); `emitLedgerEvent` (`:3607-3620`) sets no `UserId` → Step 9 threads it onto `AppendEventRequest.UserId`. Capturing test fake `recordingLedger` already exists (`trading_offline_test.go:55-82`) — reused in Step 10 (no third copy, C-13).
- **DISCOVERED CONFLICT surfaced (P-03) — BFF status mapping.** `connectCodeToHttp`
  (`connectClients.ts:43-69`) maps `FailedPrecondition`→**400**, but AC-10 needs the disabled path
  →**403** and AC-5 needs the over-window path →**400**. The Step 11 `route.ts` therefore maps
  **explicitly** (`FailedPrecondition`→403, `InvalidArgument`→400, `Unauthenticated`→401, else 500)
  rather than delegating to `connectCodeToHttp`. Also: `backendHeaders` needs a Connect
  `HandlerContext` (`bffShared.ts:41`), which a raw `route.ts` lacks — the route replicates the same
  three-header build using `rolesToAccessScope`/`generateTraceId`/`HEADER_*` (auth.ts/headers.ts).
- **C-14:** one consumer surface (`/trader`), button on the **existing** Book→Portfolio page
  (`trader/portfolio/page.tsx`) → no nav registration. Non-trading producer attribution deferred to
  the **named** follow-up `021b-ledger-producer-attribution`.
- **C-15:** every `@AC-1…@AC-11` is mapped to ≥1 test step (Steps 5, 7, 10, 13) — see the spec's
  `## Scenario Coverage` table. (Note: `acceptance.feature` has no `@AC-*` numbered 0 — the set is
  AC-1..AC-11 with no AC missing; all covered.)
- **Not-found / new-from-scratch items:** `pg-cursor` dep (add); ledger `exportEvents` method (new,
  server-streaming shape modeled on `streamEvents`); BFF `trader/api/ledger/export/route.ts` (new,
  session gate modeled on `config-ui/api/audit/route.ts`, NDJSON/CSV streaming new); e2e
  `ledgerEvents` fixture + `INVENTORY.md` row (no ledger-events fixture exists); mock-backend
  `exportEvents` handler (new).
- **Deduped Reviewers:** Proto Reviewer; xstockstrat-ledger; DBA; xstockstrat-config;
  xstockstrat-trading; xstockstrat-ui.

## Session 2026-08-31 — sdd-review impl-spec (advisory)

- Result: 1 failure, 2 warnings (advisory — did not block; no Floor breach). Spec otherwise unusually well-grounded (field numbers 11/9 free, migration NNNs 003/022 correct, 403/400 remap correct and avoids connectCodeToHttp, all 11 @AC trace to test steps).
- Unresolved ✗ / ⚠ carried into execution:
  - Step 9: **Files incomplete** — `emitLedgerEvent` is ALSO called at `services/xstockstrat-trading/internal/service/order_intent.go:166` (`order_intent.reclaimed_unknown`). Adding the `userID string` param changes the signature, so that call site MUST change or the `service` package won't compile (Step 10 `go test` then fails). Add `internal/service/order_intent.go` to Step 9 Files; pass `userID: ""` (platform-scoped sweep emit) at line 166. — [ ] unaddressed
  - Step 6: F-06 export uses a dedicated pg.Client (correct, not the max=1 pool), but N concurrent exports hold N uncapped direct backend slots. No code change now; add a `ledger.export.max_concurrent` gate in follow-up 021b only if pressure is observed. — [ ] note only
  - Step 8: config-seed migration lands after its reader (Step 6) — harmless (getBool/getInt supply code defaults). Optional: note in Step Dependencies. — [ ] note only
- Overlap findings: batch scan CLEAN; WARN same-function overlap on trading.go fill emit (021 before 029) recorded in merge-order.md.

## Session 2026-08-31 — sdd-execute (sequential)

Executed on `feature/ledger-event-export`, branched off clean `main-dev` (Stage-1 PR #1051 merged).
Unattended run (auto-proceed through checkpoints; pause only on real blockers).

- **Proto codegen toolchain (critical enabler for 6 proto features):** buf/plugins were absent and no
  Docker daemon was running. Started `dockerd` (root) and built the pinned codegen container from
  `Dockerfile.codegen` (`--secret id=proxy_ca,src=/root/.ccr/ca-bundle.crt`), image
  `xstockstrat-codegen`. Validated the toolchain reproduces the committed stubs **byte-for-byte**
  (stashed the proto edit → `./scripts/buf-gen.sh` → empty `git diff packages/proto/gen/`) before
  trusting any regeneration.
- **Tooling setup (steps 1–13):** go1.27 ✓ · docker ✓ (dockerd started) · codegen container ✓ (buf
  1.72.0 + pinned Go/TS/Python plugins) · node v22.22.2 / pnpm 9.15.9 ✓ (CI uses Node 24 — authoritative
  there) · uv 0.8.17 ✓. Migrations verified offline (never start a DB).

### Step 1 — proto: additive ExportEvents RPC + user_id fields [done]
- `packages/proto/ledger/v1/ledger.proto`: added `rpc ExportEvents(ExportEventsRequest) returns
  (stream ExportEventsResponse)`; `ExportEventsRequest{start,end,event_type}` +
  `ExportEventsResponse{repeated LedgerEvent events}` (batched pages); `LedgerEvent.user_id = 11`;
  `AppendEventRequest.user_id = 9`. All additive.
- TDD: N/A (proto). Verification: `buf lint` OK; `buf breaking` against `main-dev` reports **no
  breaking change** (additive RPC + fields). Field numbers 11/9 were the next free per message.
- Files: `packages/proto/ledger/v1/ledger.proto`. Deviations: none.

### Step 2 — proto-gen: regenerate stubs [done]
- Ran `./scripts/buf-gen.sh` inside the codegen container. Regenerated diff touches **only** ledger
  stubs across all three languages (Go `ledgerv1` pb/grpc/connect, Python `ledger_pb2`/`_grpc`, TS
  ts-proto + connect-es + compiled `dist/`) — 12 files, additive, no drift into other services.
- TDD: N/A (generated). Verification: `git status --porcelain packages/proto/gen/` limited to ledger
  (mirrors CI's `proto-freshness` gate). Files: `packages/proto/gen/**`. Deviations: none.

### Step 3 — migration: nullable user_id column + (user_id, sequence) index [done]
- Created `003_events_user_id.up.sql` (`ADD COLUMN IF NOT EXISTS user_id TEXT` + `CREATE INDEX
  idx_events_user_sequence ON ledger.events (user_id, sequence)`) and `.down.sql` (DROP INDEX → DROP
  COLUMN). Additive DDL only — no UPDATE, so the append-only `deny_mutation` guard is untouched and
  historical rows keep `user_id = NULL` (excluded by the export's `WHERE user_id = $caller`).
- TDD: N/A (migration). Verified offline: next NNN 003 correct (tip was 002_idempotency_keys); every
  `ADD COLUMN`/`CREATE INDEX` in `.up` has an inverse `DROP` in `.down`. No DB started.
- Files: `services/xstockstrat-ledger/migrations/003_events_user_id.{up,down}.sql`. Deviations: none.

### Step 4 — service: stamp user_id on the ledger write path [done]
- `ledgerServiceImpl.ts`: resolve `userId = req.userId || call.metadata.get('x-user-id')[0] || null`
  before the insert branches; added `user_id` as the 10th insert column + `$10` param (covers both the
  plain and idempotent paths, which share `insertSql`/`insertParams`); added `userId: row.user_id ?? ''`
  to `rowToEvent` so all reads (Query/Get/Stream/Export) surface it. Immutability untouched.
- TDD (P-06): **red** 5/22 fail against pre-Step-4 dist (rowToEvent userId, insert param count 9→10,
  the 3 stamping cases) → **green** 22/22 after. See Deviation Log — the configured
  `--experimental-strip-types` runner is vacuous (parameter-property class), so the genuine gate was
  the compiled-`dist` run (`node --test dist/__tests__/ledgerServiceImpl.test.js`).
- Files: `services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts`. Deviations: vacuous-runner
  (pre-existing platform defect; fails.md logged, out of 021 scope).

### Step 5 — test: ledger write-path user_id stamping [done]
- `ledgerServiceImpl.test.ts`: updated the existing insert-param-count assertion 9→10; added a
  `rowToEvent` user_id/NULL case and three appendEvent stamping cases (req.userId wins; x-user-id
  metadata fallback; neither → NULL). `u_42`/`u_99` are single-file inline literals (C-13).
- TDD as above (paired with Step 4). `pnpm run lint` clean (0 errors). Files:
  `services/xstockstrat-ledger/src/__tests__/ledgerServiceImpl.test.ts`. Deviations: none beyond the
  shared vacuous-runner note.

### Step 6 — service: ExportEvents server-streaming cursor read [done]
- Added `pg-cursor` dep (`^2.11.0`) + `@types/pg-cursor` devDep to the ledger; refreshed
  `pnpm-lock.yaml`. Implemented `exportEvents(call)`: config gate (`getBool('ledger.export.enabled')`
  false → destroy code 9), window bound (`getInt('ledger.export.max_window_days')`, span > max →
  destroy code 3 with the exact message), caller scope from `x-user-id` metadata, SQL
  `SELECT * FROM ledger.events WHERE user_id=$1 AND occurred_at BETWEEN $2 AND $3 [AND event_type =
  ANY($4)] ORDER BY sequence ASC`, streamed in cursor batches (one `ExportEventsResponse` per page).
  Reads run on a **dedicated** `pg.Client` built from `this.pool.options` (never the DB_POOL_MAX=1
  write pool — F-06), isolated in `streamExportRows()` so the gate/filter/order logic is unit-testable.
- TDD (P-06): 7 exportEvents cases **red** against pre-Step-6 dist (method absent) → **green** 29/29
  after (compiled-dist run — see Deviation Log for the vacuous-runner note).
- Files: `services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts`,
  `services/xstockstrat-ledger/package.json`, `pnpm-lock.yaml`. Deviations: none new.

### Step 7 — test: ExportEvents filtering, ordering, bounds, gating, isolation [done]
- `ledgerServiceImpl.test.ts`: added an `exportEvents` describe covering AC-10 (disabled→code 9,
  no query), AC-5 (over-window→code 3 + exact message), AC-11+AC-1 (`WHERE user_id = $1` +
  `ORDER BY sequence ASC`, not `recorded_at`; param[0]=caller), AC-3 (`event_type = ANY($4)` with the
  split list), AC-4 (no predicate when empty), AC-7 (two batches → two `write()`s, `this.pool` never
  queried), AC-8 (emitted event carries eventId/type/source/sequence/streamKey/userId/payload). Uses a
  `streamExportRows` instance override to capture SQL/params and feed batches (no DB). `u_42` inline (C-13).
- TDD paired with Step 6. `pnpm run lint` clean. Files:
  `services/xstockstrat-ledger/src/__tests__/ledgerServiceImpl.test.ts`. Deviations: none.

### Step 8 — config: seed ledger.export.* keys (native type) + declare defaults [done]
- Created `022_ledger_export_keys.{up,down}.sql` (config migration): seeds `ledger.export.enabled`
  (`bool`, `true`) and `ledger.export.max_window_days` (`int`, `365`) × {staging, production}, global
  (`user_id NULL`), `ON CONFLICT … DO NOTHING`; down DELETEs both. `value_type` is native `bool`/`int`
  (never `string` — the fail-open trap the getters `?? default` would hit). Declared both keys in
  `services/xstockstrat-ledger/CLAUDE.md` § Config Keys Consumed (C-05).
- TDD: N/A (config seed migration; the disabled behavior is exercised by Step 7 AC-10). Verified
  offline: next NNN 022 correct (tip 021); value_types int/bool; down reverses both. No DB started.
- Files: `services/xstockstrat-config/migrations/022_ledger_export_keys.{up,down}.sql`,
  `services/xstockstrat-ledger/CLAUDE.md`. Deviations: none.

### Step 9 — service: trading producer stamps owning user_id [done]
- `trading.go`: added a `userID string` param to `emitLedgerEvent` (between streamKey and payload) and
  set `UserId: userID` on the `AppendEventRequest`. Updated all 26 call sites (25 trading.go + 1
  order_intent.go) per the codebase-discovery mapping: user-owned emits pass the owner
  (`order.UserId` for order lifecycle/fills/brackets; `userID` param for offline/positions/balance
  sync; `req.UserId` for baseline_set; `rec.UserID` for account.deregistered), and the 4
  genuinely platform-scoped emits pass `""` (reconciliation.mismatch_found,
  order_intent.resolved_by_reconciliation ×2, order_intent.reclaimed_unknown).
- TDD (P-06): **red** — with `UserId` unset the fill emits carry `""` (test fails, UserId != u_42) →
  **green** after restoring the assignment. `GOWORK=off go build ./...` OK; `go vet` clean; `gofmt`
  clean; full `internal/service` test package `ok`. golangci-lint deferred to CI (build-Go guard — see
  Deviation Log).
- Files: `services/xstockstrat-trading/internal/service/trading.go`,
  `services/xstockstrat-trading/internal/service/order_intent.go`. Deviations: golangci-lint local
  fallback (Deviation Log).

### Step 10 — test: trading fill emits carry user_id [done]
- New `trading_ledger_userid_test.go`: `TestEmitLedgerEventStampsOwningUserId` drives the fill emit
  path directly (recordingLedger + `&TradingService{ledger:rec}`), asserting order.filled and
  order.partially_filled requests carry `UserId == "u_42"` and a platform-scoped emit carries `""`.
  Reuses the existing `recordingLedger`/`requestsByType` helper (C-13 — no third capturer). `u_42`
  inline. Name contains "UserId" for the `-run UserId` filter.
- TDD as above. Files: `services/xstockstrat-trading/internal/service/trading_ledger_userid_test.go`.
  Deviations: none beyond the shared golangci-lint fallback.

### Step 11 — service: /trader BFF export route (NDJSON/CSV streaming) [done]
- Created `src/app/trader/api/ledger/export/route.ts`: session gate (401 pre-ledger, AC-6); builds
  the three propagation headers (x-user-id/x-access-scope/x-trace-id) inline (no HandlerContext in a
  raw route); calls `ledgerClient.exportEvents({start,end,eventType},{headers})`, pulls the first page
  BEFORE returning so the config-gate/window errors map pre-stream; wraps the rest in a ReadableStream
  (NDJSON default, `?format=csv`). Explicit error map (NOT connectCodeToHttp): FailedPrecondition→403
  (AC-10), InvalidArgument→400+message (AC-5), Unauthenticated→401, else 500. protobuf-es v2: payload
  is a plain JsonObject, occurredAt via `timestampDate`.
- TDD: behavior proven by Step 13 e2e (no unit threshold on ui). tsc --noEmit clean; lint clean.
- Files: `services/xstockstrat-ui/src/app/trader/api/ledger/export/route.ts`.

### Step 12 — service: "Export events" button on the /trader Book page [done]
- `trader/portfolio/page.tsx`: added an "Export events" Button (ui/button primitive, accessible name)
  in the header; `onExportEvents` defaults to last-90-days + all types (AC-9), `fetch()`es the route
  (so the session-cookie refresh interceptor applies), then a transient `<a download>` presents the
  save dialog. No new route → no nav registration.
- TDD: proven by Step 13 e2e. lint clean (only the pre-existing `accountName` useMemo warning).
- Files: `services/xstockstrat-ui/src/app/trader/portfolio/page.tsx`.

### Step 13 — test: /trader export e2e (Playwright) [done]
- Created `e2e/fixtures/ledgerEvents.ts` (5 rows across the 5 types, ascending sequence, TEST_USER_ID)
  + INVENTORY.md row (C-12); added a `LedgerService.exportEvents` async-generator handler to
  `e2e/mock-backend.ts` (honors event_type subset + >365d window→InvalidArgument + the
  EXPORT_DISABLED_SENTINEL→FailedPrecondition); wrote `e2e/trader/ledger-export.spec.ts` (AC-1 NDJSON
  order, AC-2 CSV header/rows, AC-3/4 type filter, AC-5 400+message, AC-6 401/redirect, AC-9 button
  download last-90d/all-types, AC-10 403).
- TDD (P-06): the route + button are new files, so pre-Step-11/12 AC-1 would 404 and AC-9 would find
  no button (structural red); GREEN = a real Playwright run of the full spec, **8/8 passed** (warmup
  pre-warmed 22/22 SSR routes). See Deviation Log for the browser-build/timeout workaround.
- Files: `e2e/trader/ledger-export.spec.ts`, `e2e/mock-backend.ts`, `e2e/fixtures/ledgerEvents.ts`,
  `e2e/fixtures/INVENTORY.md`. Deviations: Playwright infra (Deviation Log).
