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
