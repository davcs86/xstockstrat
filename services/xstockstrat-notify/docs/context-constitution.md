# xstockstrat-notify — Constitution

Derived by `/context-constitution` (context-forge) on 2026-07-24. Captures the **non-obvious** local
invariants of the notify service (gRPC server-streaming alert fan-out + history, gRPC 50059). Does not
restate documented/CI-enforced rules (see `## Pointers`).

> Inherits all rules of the root constitution (`../../../docs/context-constitution.md`). This file lists only
> what is specific to **xstockstrat-notify**.

## Rules (`NOTIFY-*`) — binding, easy-to-miss conventions

| ID | Rule | Why | Evidence | Example (canonical `path:line`) |
|---|---|---|---|---|
| **NOTIFY-1** | **`AlertSeverity` has two wire forms and is converted at every DB boundary**: DB column is `INTEGER`, ts-proto `stringEnums` is a string (`"ALERT_SEVERITY_WARNING"`). Insert via `alertSeverityToNumber`, read via `alertSeverityFromJSON`; fan-out keeps the **string**. | Binding `req.severity` into the INTEGER column throws; reading `row.severity` into the proto maps to `UNRECOGNIZED`. Both shipped (PR #698). (Instance of root PLAT-F1/PLAT-2.) | `src/grpc/notifyServiceImpl.ts:53,189,69` | `src/grpc/notifyServiceImpl.ts:53` |
| **NOTIFY-3** | **The `ConfigWatcher` is subscribed only to gate startup (`waitForSnapshot(90_000)`) — no config value is read at runtime.** Don't assume `notify.*` keys are live-tunable; they are declared but not wired (see findings). | `this.config` is referenced nowhere; treating the keys as live is wrong. | `src/index.ts:18-19`; `notifyServiceImpl.ts:23` (grep zero reads) | `src/index.ts:18-19` |
| **NOTIFY-4** | **`EmitAlert` rejects an empty/whitespace-only `title` or `body` with gRPC code `3` (INVALID_ARGUMENT) *before* persisting** — proto3 strings default to `""`, so the `NOT NULL` columns would otherwise never fire on a blank alert. | A blank-alert guard must live in the handler, not the schema; the DB default masks it (feature 094, F-10 — not feature 092/F-11, which is the separate "EmitAlert is not role-gated" decision documented above). | `src/grpc/notifyServiceImpl.ts:32-37` (empty/whitespace `title` or `body` → `callback({ code: 3 })`) | `src/grpc/notifyServiceImpl.ts:32-37` |

## Gotchas & scars

- **Fan-out ignores `call.write()` backpressure** — `sub.call.write(alert)` drops a subscriber only on a thrown exception; the `false` return (buffer full / slow consumer) is discarded and there is no `drain` handling, so a slow subscriber buffers unbounded server-side. Flagged as an open question in findings. Evidence: `notifyServiceImpl.ts:86`.
- **`StreamSubscriber.severities` is typed `number[]` but the runtime fan-out value is a *string* enum** (`stringEnums`) — the only test exercises the numeric path, so CI won't catch a regression if someone numeric-converts one side. Recorded as a latent bug in findings. Evidence: `notifyServiceImpl.ts:12,173,69`.

## Pointers (already documented or CI-enforced — not restated here)

| What | Where |
|---|---|
| DB pool cap 1 (light DB use — alert history) | `src/index.ts:37`; root pool budget |
| gRPC-only, port 50059 | `CLAUDE.md:20-26` |
| OTel gated on `OTEL_ENABLED`, non-fatal init | `src/telemetry.ts:7,39` |
| All RPC errors collapse to a bare numeric gRPC code `13` (INTERNAL); `grpc.status` is never imported (house style, harmless deviation) | `src/grpc/notifyServiceImpl.ts:101,144,159` |

---
_Forged by [context-forge](https://github.com/davcs86/agent-plugins). It captures the
non-obvious — nothing here is invented; re-run `/context-constitution` to refresh after the code changes._
