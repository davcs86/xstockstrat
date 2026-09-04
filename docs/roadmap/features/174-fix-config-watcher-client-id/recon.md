# Recon: fix-config-watcher-client-id

**Created**: 2026-09-04
**From**: product-spec.md
**Affected services**: xstockstrat-analysis, xstockstrat-ingest (config: investigation dependency, not modified)

---

## Objective

Correct the copy-pasted `client_id="indicators-…"` the analysis and ingest config watchers send on
their `WatchConfig` requests, so each subscriber identifies with its own service name. Recon
**resolves the significance question**: `client_id` is **cosmetic/diagnostic only** in the config
service — this is a log-label correctness fix, not a functional collision.

## Codebase Map

- **`xstockstrat-analysis`** (Python): `app/config/watcher.py:60` — `client_id=f"indicators-{id(self)}"`
  inside the `WatchConfigRequest(...)` built in `_watch()` (~:58).
- **`xstockstrat-ingest`** (Python): `app/config/watcher.py:73` — identical `client_id=f"indicators-{id(self)}"`.
- **`xstockstrat-config`** (investigation only, NOT modified): WatchConfig handler
  `src/grpc/configServiceImpl.ts` — `client_id` is used only as an opaque segment of a unique `subId`
  (`:231`, `subId = ${namespace}:${env}:${userId}:${client_id}:${Date.now()}`) and in log lines
  (`:216,233,247`). The subscriber `Map` keys on `subId` (`:103`), broadcast fan-out filters on
  namespace+environment (`:209-210`), disconnect keys on `subId` (`:236-240`). **No `client_id`-keyed
  map, no dedup, no per-client routing.**
- Proto: `WatchConfigRequest.client_id` = field **2** (`packages/proto/config/v1/config.proto:40`,
  `// service instance identifier`).

## Patterns to REUSE

- The indicators watcher's own (correct) `client_id=f"indicators-{id(self)}"` is the template — each
  service names itself with `f"<service>-{id(self)}"`. Per-service literal; no shared helper (see Risks — DRY).

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-10` "Config messages carry environment production/staging and no trading_mode"
  (`services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature:66-70`) — the
  `client_id` relabel touches the same `WatchConfigRequest`-build path; it must leave `environment` set
  and not reintroduce `trading_mode`. No `@AC-*` guarantees the `client_id` value itself (net-new subject).

## Dependencies

- Proto/RPC: none (client_id field already exists). Migration: none. Config keys: none.
- Consumer surface (C-14): None — internal/platform-only (a WatchConfigRequest field; no UI/agent surface).

## Risks / Not-found

- **Significance RESOLVED — cosmetic.** config never keys on `client_id`; `id(self)` already makes each
  instance unique, and `subId` appends `Date.now()`, so a collision is impossible even with identical
  prefixes. The shared `indicators-` prefix is a **log-mislabel** (config logs analysis/ingest
  subscribers as `indicators-…`), not a functional defect. → the fix is low-priority observability hygiene.
- **DRY (review flag)**: a shared service-name-prefix helper across the 3 watchers is **over-engineering**
  (How-to-Act #2) — it's a one-token literal per service; each naming itself is clearer than a helper.
- **Test seam (fails-074)**: the `client_id` is built inline in `_watch()`; a test must assert the prefix
  WITHOUT constructing a live dialing `ConfigWatcher`. Extract the client_id into an instance attribute
  set in `__init__` (`self._client_id = f"analysis-{id(self)}"`, no dial) that `_watch()` uses, and assert
  it via a `__new__`/stub-constructed watcher — or a pure helper. Design must pick the minimal seam.
- No existing test asserts `client_id`.

## Recommended Scope

- analysis `watcher.py:60`: `f"indicators-{id(self)}"` → `f"analysis-{id(self)}"`.
- ingest `watcher.py:73`: `f"indicators-{id(self)}"` → `f"ingest-{id(self)}"`.
- Extract each to a minimal testable seam (`self._client_id` in `__init__`), add a per-service RED-before-green
  test asserting the prefix; leave `environment`/`trading_mode` on the request untouched (@AC-10).
- CLAUDE.md/findings: clear the `client_id="indicators-"` copy-paste finding for analysis/ingest.
