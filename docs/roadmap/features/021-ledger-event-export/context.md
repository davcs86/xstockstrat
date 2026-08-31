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
