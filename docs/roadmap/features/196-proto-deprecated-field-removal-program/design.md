# Design: proto-deprecated-field-removal-program

**Created**: 2026-09-19
**From**: recon.md + product-spec.md
**Debate**: 3 rounds (full), user-steered at the Round-2 gate. No Floor breach.
**Status at write**: spec-ready → design-approved (implementation steps GATED — see Open Risks)

---

## Chosen Approach — response-edge omission (keep the proto, stop populating in responses)

Keep every `[deprecated = true]` field in the `.proto` definitions (PROTO-2 intact — no `buf breaking`,
no v1→v2, no BSR schema break) and, where safe, stop **populating** genuinely-dead fields at the
producer's response-serialization edge — the same read-edge omission pattern feature 194 used to strip
dead `signal_params` keys. This was the user's decision at the Round-2 gate; it deliberately sidesteps
recon's BLOCKER-CLASS finding (in-place removal contradicts PROTO-2 and has no procedure on a
BSR-published module — `recon.md:69,103-106`). Omission is **reversible** (re-populate is a one-line
revert), which is the approach's real merit over schema removal.

Per-field verdict (grounded in the recon reader audit, corrected by the Round-3 adversary):

- **KEEP (do not omit) — `Watchlist.symbols`** (`portfolio.proto:235`). Live in-repo reader at
  `services/xstockstrat-portfolio/internal/service/portfolio_service.go:1691` (`AddWatchlistSymbols`
  derives the per-list cap from `existing.Symbols`) **and** the feature-097 old-client mirror.
  Omitting silently breaks the cap and external old clients. (`recon.md:96`.)

- **EXCLUDE — `Bar.timeframe` at `barFromAlpaca`** (`services/xstockstrat-marketdata/internal/alpaca/client.go:142`).
  NOT a response-only edge: those `Bar` objects flow into `InsertBars` →
  `internal/repository/marketdata_repo.go:71`, which reads `b.Timeframe` to write the
  `marketdata.ohlcv.timeframe` column; `QueryBars` then filters `WHERE timeframe=$2` (`:100`, bound
  `'1d'`). Omitting here stores an empty timeframe → daily-bar queries return nothing → **silent store
  corruption**, breaking `@AC-1` (400-day GetBars), `@AC-2/@AC-3` (BatchGetBars). Stripping this edge
  would require first rewriting the `InsertBars` consumer to derive the string from `TimeframeEnum` via
  `timeframe.ToCanonical` — a coupled multi-site change, out of scope.

- **GATED (omit only after the consumer-confirmation gate) — the pure response edges:**
  `Bar.timeframe` at `scanBars` (`marketdata_repo.go:144`, the DB→proto read) and `stream.go:247`
  (streamed-bar response); `BackfillJob.timeframe` at `job_row_to_proto`
  (`services/xstockstrat-ingest/app/handlers/servicer.py:149`). `timeframe_enum` is verified co-emitted
  at every one (`marketdata_repo.go:153`, `stream.go:255`, `servicer.py:152`). No in-repo reader, but
  the module is BSR-published (`recon.md:76-78`), so omitting a field an external consumer still reads
  is a **silent runtime break**. Ship each only after the gate below.

- **NO-OP (request-only; already ignored) — the 10 verified-dead `user_id` bodies** (trading ×4,
  portfolio ×5, analysis ×1), **`is_paper`**, ingest **`operation` string**, and the request-side
  `timeframe` strings. These never appear in a response — "filter from responses" is a literal no-op;
  identity is header-authoritative (`recon.md:52-54,98-99`). No code change.

- **OUT OF SCOPE — enum values** (`TIMEFRAME_*`, `ENVIRONMENT_DEV`, `VALUE_TYPE_FLOAT_MAP`). An enum
  member is not a field you can leave unset; `TIMEFRAME_1MIN` is actively written (`stream.go:255`),
  `15m`/`1h` live in historical rows, `ENVIRONMENT_DEV` rides wire value 1 (`configServiceImpl.ts:28-29`).
  The response-filter mechanism does not apply.

### The per-field consumer-confirmation gate (blocks every GATED omission)

Before omitting a GATED field, all must hold and be recorded in `context.md`:
1. Every named consumer surface (analysis GetBars reader; `xstockstrat-ui` backfills page; agent) is
   grep-confirmed to read `timeframe_enum`, **not** the string (ledger `fails.md:168` empty-timeframe→
   silent `"1d"`; `fails.md:667` TS wrong-casing→`undefined` are this exact silent-break class).
2. The field's deprecation window (feature 053/080/143) is formally announced closed to BSR consumers.
3. Sign-off recorded in `context.md`.

Because external BSR consumers exist and cannot be enumerated, this gate is the **same "prove no
external reader" burden** a schema removal carries — so **no omission ships this session**. The steer
buys reversibility, not gate-freedom (accepted at the gate).

## Rejected Alternatives

- **In-place removal + `reserved` (recon Option 2 / the original product-spec premise)** — contradicts
  PROTO-2 (deprecate-don't-delete, no `reserved`; `recon.md:50,103-106`), has no documented procedure,
  breaks external BSR consumers, needs 2 owners + platform lead. Cosmetic gain, high governance cost.
- **v1→v2 package migration (recon Option 3)** — the only *documented* removal path, but grossly
  disproportionate for dead cosmetic fields. The honest path only if a genuinely smaller **published**
  schema is ever required (a new, larger feature).
- **Park / deprecate-don't-delete as terminal (recon Option 1)** — the Rounds-1/2 convergence; the
  correct outcome absent the steer. Superseded by the user's response-edge decision, which delivers the
  same PROTO-2 safety plus a reversible path to stop emitting the dead data once the gate clears.
- **Omit at `barFromAlpaca` too** — rejected: DB-write coupling → store corruption (see EXCLUDE).

## Open Risks (carried to context.md Open Threads)

- **All implementation steps are GATED** on the external-consumer confirmation above → non-executable
  this session; `/sdd-spec` should encode them as gated steps, not runnable ones. (target: gate clears)
- **Safe-now scope is empty** — every response-side deprecated field is in-repo load-bearing,
  DB-coupled, or externally observable. If the gate never clears, 196's shipped outcome is zero code
  change (equivalent to park) — acceptable given PROTO-2 already prevents number reuse.
- **`stream.go:255` co-emits the deprecated `TIMEFRAME_1MIN` enum member** — omitting the string there
  forces consumers onto a deprecated enum value; acceptable, noted so it isn't read as a contradiction.

## Constitution Rules Touched

- **C-10 / C-14** — a GATED omission must cover **every** producer path for that field and name the
  consumer surfaces; partial omission (the `barFromAlpaca` miss) is the failure mode the design excludes.
- **C-15** — `@AC-1`/`@AC-4` presuppose removal+`reserved` that this approach does not do; they are
  annotated out-of-scope-under-this-decision (append-only preserved, not inverted). `@AC-2`/`@AC-3`
  remain valid. New terminal-state scenarios, if any, are appended at `/sdd-spec`, each bound to a test.
- **C-16** — PRESERVE all recon guarantees; the design's whole point is to not regress marketdata
  GetBars/BatchGetBars (`@AC-1/2/3`), ingest `manage_signal_source` (`@AC-1..6`), config `value_type`.
  **PROTO-2 stays intact**, so the recon "CHANGE requires sign-off" structural item no longer applies.
- **C-18** — response-edge omission is the minimal mechanism that honors the user goal (stop emitting
  dead data to consumers) without the disproportionate v2 migration; reversibility is the staff-engineer
  tie-breaker over removal.
- **P-03 / F-11** — no silent guess (the empty safe-now scope + external gate are stated, not papered
  over); no Floor breach.

## Business Rules Touched (C-16)

PRESERVE: `@AC-1` (400-day GetBars), `@AC-2/@AC-3` (BatchGetBars) — the `barFromAlpaca` EXCLUDE exists to
preserve them; `@AC-1..@AC-6` ingest manage_signal_source; config `value_type` scenarios; agent
header-identity `@AC-1/4/5/6/7`. No EXTEND. No CHANGE (PROTO-2 preserved, not reversed).

## Rounds

3 (full). R1-R2 converged on park; the user steered to response-edge omission at the R2 gate; R3
pressure-tested the steer and corrected the `barFromAlpaca` DB-corruption trap. Terminated by user
approval at the R3 gate: design-approved with gated steps.
