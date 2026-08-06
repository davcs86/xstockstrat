# Context: mcp-config-management  (archived 2026-08-06)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-06 — /sdd-archiver

**What**: Shipped as three MCP tools (`get_config`, `list_config_keys`, `set_config`) letting an operator inspect and roll out non-secret config from an agent session. The original motivation — staging the FMP API key — was NOT solved here; sibling feature 076 (`fmp-key-to-secret-env`) moved that credential to a `type: SECRET` env var instead (context.md:226-255).
**Why (irrecoverable rationale)**: `set_config` rejects `is_secret`/`secret.`-prefixed keys because the user rejected plaintext-in-config after verification proved DO `type: SECRET` env vars already cover every credential but the one-off FMP key (context.md:195-254). The "no denylist, authorize by real user role" requirement (2026-07-28) forced a two-service dependency chain (074/075/076/077) found only by directly reading code (context.md:42-58).
**Rejected alternatives**:
- Tool re-validates the bearer token itself — false-accepts SSE, extra Identity round-trip, breaks `tests/test_auth.py`, turns 401 into 500 (design.md:128-131).
- Enforce `is_secret` server-side in xstockstrat-config — "genuinely better" (no TOCTOU, one fewer RPC, protects `grpcurl`/`/config-ui` too) but reopens a service the product spec had closed and contradicts FR-7's "verify, don't reimplement"; recorded to revisit deliberately, not acted on (design.md:135-138).
- Forward `x-user-id` — dead metadata; `request.author` wins server-side (design.md:100-104,144).
- `GetConfig` for the is_secret pre-check — rejected: it serves the in-memory `snapshots` map refreshed only on `pg_notify`, so it can report a stale flag; `ListKeys` queries the DB live (design.md:86-89,139-140; context.md:314-315). **Verified this rationale is absent from shipped code** — grep for pg_notify/stale/cache in `app/tools.py`/`app/client.py` returns nothing.
- Infer `value_type` from the JSON value instead of an explicit `Literal` parameter — rejected *for new keys* because JSON cannot distinguish `1` from `1.0` the way the proto oneof does, even though inference would be the nicer contract for existing keys (where the parameter is ignored anyway, since `ON CONFLICT...DO UPDATE` never touches `value_type`) (design.md:141-143). Not recoverable from shipped code — `app/tools.py`'s docstring only instructs "pass JSON as a string," with no explanation of why type isn't inferred from the value.
**Scars & gotchas**:
- **Agent gave the user a false technical justification, caught only by recon.** The "Streamable HTTP only, deny on SSE" decision was first justified by an unverified, false prior-session claim that per-request auth on SSE needs an in-memory SSE-session→claims map. Recon verified against `mcp==1.27.1` that both transports hand tools the same Starlette Request; the real reason is narrower: `/messages` is never auth-gated before the tool runs. Kept only after the user re-affirmed it knowing "we cannot" was wrong and "we choose not to" was the truth (recon.md:19-48).
- Claims stored on ASGI `scope["state"]`, not a contextvar — SSE's exclusion is correct *by construction* since `/messages` returns before `_authorized` runs (design.md:28-49).
- `validate_bearer_claims` kept as a new function alongside untouched `validate_bearer_jwt` to avoid breaking `tests/test_auth.py`; still had to fix `tests/test_oauth.py`, which patched the old function via a different path (context.md:355-357).
- **TOCTOU between the `ListKeys` pre-check and the `SetConfig` write was a deliberately accepted risk, not an oversight** — the flag can only change out-of-band and the window is one RPC; both design.md's Open Risks and the execute-session confirmed accepting it rather than closing it (design.md:154-155; context.md:366).
**Permanent deviations**: none — shipped as specified (context.md:320-370).
**Permanent deviations**: none
**Cross-feature signal**: One feature's design forced four prerequisites (074-077) to land first, each discharging a blocking defect found only by direct code inspection during spec review (context.md:108-271).
**Deferred follow-ons**: Prong-(a) cross-scope blind spot (a key flagged `is_secret` only in a different scope is invisible to the write-time check) narrowed, not eliminated, by feature 078 (design.md:150-153, context.md:364-365). No automated end-to-end MCP transport test — the SSE-vs-Streamable-HTTP claims-delivery claim is verified by reading the SDK, not executing it (context.md:367-370).
**Ledger entries written**: insights.md (2), fails.md (2) — see the 2026-08-06 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none (AGENT-3/AGENT-4 amendments already routed into shipped docs per context.md:338-340)
**Pruned artifacts**: product-spec.md, recon.md, design.md — last present at f871138.
