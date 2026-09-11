# Defect: agent emits x-user-id twice on ensure_signal_watchlist / add_watchlist_symbol

**Recorded**: 2026-09-03
**Severity**: SEV-3
**Impact type**: latent-metadata-duplication
**Environment**: dev + production
**Affected service(s)**: xstockstrat-agent

**Config-only fix possible**: no

## Observed

Two agent client wrappers build their outbound gRPC metadata with the non-de-duplicating splat form
`[*_metadata(), ("x-user-id", user_id)]`. Under a bound caller context, `_metadata()` already emits
`x-user-id`, so the header is sent **twice**. This violates the AGENT-4 de-dup contract. Impact is
latent today because the appended value equals the caller's own id (the feature-127 auto-add path), so
the duplicate carries the same value — but it is wrong if the two ever diverge.

## Expected

Each outbound call sends exactly one `x-user-id` header, via the de-duplicating
`_metadata(("x-user-id", user_id))` form used by the ~25 other caller-identity wrappers.

## Reproduction

1. Invoke `ensure_signal_watchlist` (or `add_watchlist_symbol`) through the MCP edge under an
   authenticated caller (bound context).
2. Inspect the outbound gRPC metadata to `xstockstrat-portfolio`: `x-user-id` appears twice.

## Evidence

`services/xstockstrat-agent/app/client.py:298`
> `[*_metadata(), ("x-user-id", user_id)]`  (ensure_signal_watchlist)

`services/xstockstrat-agent/app/client.py:316`
> `[*_metadata(), ("x-user-id", user_id)]`  (add_watchlist_symbol)

## Root cause hypothesis

The two wrappers used the splat form instead of the de-duplicating `_metadata(("x-user-id", user_id))`
helper that already collapses the header against the bound context. Fix: switch both to the helper form.

## Confidence

high
