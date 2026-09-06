# xstockstrat-notify — Constitution

Derived by `/context-constitution` (context-forge) on 2026-07-24; refreshed 2026-09-02 (branch
`claude/loaded-plugins-list-d120nl` @ `82a0549` — feature 165 added the Web Push channel; added
NOTIFY-5/6 (+ severity-only-gate and VAPID-fail-loud gotchas), re-grounded NOTIFY-1/3/4 as ~120 push-RPC lines shifted anchors); refreshed 2026-09-03 (branch `claude/watchlist-bulk-default-strategy-zxx6su` @ `d4cd327` — added the TTL-vs-send-timeout scar; re-grounded NOTIFY-6 prune + severity-gate/VAPID gotcha anchors after the `webPush.ts` TTL-split change). Captures the **non-obvious** local
invariants of the notify service (gRPC server-streaming alert fan-out + history, gRPC 50059). Does not
restate documented/CI-enforced rules (see `## Pointers`).

> Inherits all rules of the root constitution (`../../../docs/context-constitution.md`). This file lists only
> what is specific to **xstockstrat-notify**.

## Rules (`NOTIFY-*`) — binding, easy-to-miss conventions

| ID | Rule | Why | Evidence | Example (canonical `path:line`) |
|---|---|---|---|---|
| **NOTIFY-1** | **`AlertSeverity` has two wire forms and is converted at every DB boundary**: DB column is `INTEGER`, ts-proto `stringEnums` is a string (`"ALERT_SEVERITY_WARNING"`). Insert via `alertSeverityToNumber`, read via `alertSeverityFromJSON`; fan-out keeps the **string**. | Binding `req.severity` into the INTEGER column throws; reading `row.severity` into the proto maps to `UNRECOGNIZED`. Both shipped (PR #698). (Instance of root PLAT-F1/PLAT-2.) | insert `alertSeverityToNumber` `src/grpc/notifyServiceImpl.ts:51`, read `alertSeverityFromJSON` `:263`, fan-out string compare `:247` (import `:3`) | `src/grpc/notifyServiceImpl.ts:51` |
| **NOTIFY-3** | **The five `notify.fanout.*` keys ARE read live on every dispatch (feature 020); the three `notify.stream.*`/`notify.alert.*` keys are declared-but-unwired.** The `ConfigWatcher` gates startup (`waitForSnapshot`) *and* the `FanoutDispatcher` reads config on each `EmitAlert`. Don't assume the stream/retention keys are live (see findings); don't assume the fanout knobs are static. | Feature 020's `FanoutDispatcher` reads `min_severity`/`min_confidence_threshold`/`dedup_window_seconds`/`sendgrid_from_email`/`sendgrid_to_email` live, so a config push retunes fanout with no restart; the older 3 keys still have no reader. | live reads `src/fanout/fanout.ts:56,69,76,100,101`; startup gate `src/index.ts:20-21`; dispatched via `queueMicrotask` at `notifyServiceImpl.ts:108-112` | `src/fanout/fanout.ts:56` |
| **NOTIFY-4** | **`EmitAlert` rejects an empty/whitespace-only `title` or `body` with gRPC code `3` (INVALID_ARGUMENT) *before* persisting** — proto3 strings default to `""`, so the `NOT NULL` columns would otherwise never fire on a blank alert. | A blank-alert guard must live in the handler, not the schema; the DB default masks it (feature 094, F-10 — not feature 092/F-11, which is the separate "EmitAlert is not role-gated" decision documented above). | `src/grpc/notifyServiceImpl.ts:35-36` (empty/whitespace `title` or `body` → `callback({ code: 3 })`) | `src/grpc/notifyServiceImpl.ts:35-36` |
| **NOTIFY-5** | **`RegisterPushSubscription` resolves the owner from the `x-user-id` gRPC metadata header, never a request-body user id** (rejects code 3 if absent; root PLAT-11). | An agent adding a `userId` field to the register request/proto and trusting it lets a browser assert another user's identity, since the edge injects/strips `x-user-id`. | `src/grpc/notifyServiceImpl.ts:178-181` | `src/grpc/notifyServiceImpl.ts:178-181` |
| **NOTIFY-6** | **Push unregister AND the 404/410-prune delete by `endpoint` ONLY, with NO user scoping** — an endpoint is a possession-proven capability and the register upsert can reassign it to another user, so a user-scoped delete would strand rows. | Adding `AND user_id = $2` to either delete strands revoked/reassigned subscriptions and defeats the upsert. (Looks wrong, is intentional.) | unregister `notifyServiceImpl.ts:228`, prune `src/fanout/webPush.ts:139`, `endpoint … UNIQUE` `migrations/002_push_subscriptions.up.sql:12` | `src/grpc/notifyServiceImpl.ts:210` |

## Gotchas & scars

- **The Web Push channel gates on severity ONLY; unlike the sibling `FanoutDispatcher` it deliberately does NOT gate on `context.conviction`** ("Never gate on a context key — no producer reliably writes one"). An agent copying fanout's conviction gate into `webPush.dispatch` silently drops pushes for conviction-less alerts. Evidence: `src/fanout/webPush.ts:80-86` vs `fanout.ts:64-72`.
- **VAPID misconfig fails loud ONCE and disables the channel (`vapidConfigured=false`), never throwing per-send.** If all three VAPID vars are present but `VAPID_SUBJECT` isn't `mailto:`/`https:`, the constructor logs ERROR once and disables push — because a malformed subject would otherwise throw on every `sendNotification` and be swallowed to WARN by the per-dispatch catch (a channel that looks enabled but black-holes every push). "Simplifying" the subject regex to a non-empty check re-introduces the silent black-hole. Evidence: `src/fanout/webPush.ts:59-70`.
- **Web Push message TTL and the outbound send timeout are two deliberately-separate constants — never re-conflate them.** `WEBPUSH_TTL_SECONDS = 3600` and `WEBPUSH_SEND_TIMEOUT_MS = 10000` (`src/fanout/webPush.ts:15-16`) are passed distinctly to `webpush.sendNotification({ TTL, timeout })` (`:148-151`), pinned by a regression test asserting `opts.TTL === 3600` and a separate real `opts.timeout` (`src/__tests__/webPush.test.ts:200-224`). The shipped 2026-09-03 defect reused one value for both, passing the 10s HTTP timeout as the TTL — so every push got a 10-second message TTL and any device offline > ~10s silently never received the OS alert. Reusing one constant for both re-opens a whole class of dropped trading alerts with no error.
- **Fan-out ignores `call.write()` backpressure** — `sub.call.write(alert)` drops a subscriber only on a thrown exception; the `false` return (buffer full / slow consumer) is discarded and there is no `drain` handling, so a slow subscriber buffers unbounded server-side. Flagged as an open question in findings. Evidence: `notifyServiceImpl.ts:90`.
- **`StreamSubscriber.severities` is typed `number[]` but the runtime fan-out value is a *string* enum** (`stringEnums`) — the only test exercises the numeric path, so CI won't catch a regression if someone numeric-converts one side. Recorded as a latent bug in findings. Evidence: `notifyServiceImpl.ts:14,141,247`.

## Pointers (already documented or CI-enforced — not restated here)

| What | Where |
|---|---|
| DB pool cap 1 (light DB use — alert history) | `src/index.ts:36`; root pool budget |
| gRPC-only, port 50059 | `CLAUDE.md:20-26` |
| OTel gated on `OTEL_ENABLED`, non-fatal init | `src/telemetry.ts:7,39` |
| All RPC errors collapse to a bare numeric gRPC code `13` (INTERNAL); `grpc.status` is never imported (house style, harmless deviation) | `src/grpc/notifyServiceImpl.ts:95,144,159` |

---
_Forged by [context-forge](https://github.com/davcs86/agent-plugins). It captures the
non-obvious — nothing here is invented; re-run `/context-constitution` to refresh after the code changes._
