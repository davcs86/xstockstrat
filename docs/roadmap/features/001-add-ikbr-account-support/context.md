# Context: add-ikbr-account-support  (archived 2026-08-05)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-05 — /sdd-archiver

**What**: Multi-broker (Alpaca + IBKR) multi-account trading shipped as a broker-pool architecture inside `xstockstrat-trading` (encrypted-credential account registry, per-account broker clients) with `xstockstrat-portfolio` tracking per-account positions and reconciling IBKR/Alpaca truth via a periodic sync poller.
**Why (irrecoverable rationale)**: IBKR Web API (not Client Portal Gateway) was chosen because CPG needs a locally-running Java/Docker proxy plus browser-based session login that expires — incompatible with unattended server deployment (context.md session 2026-05-02T00:01:00Z). The original "platform-wide broker switch" design (`trading.broker.active` config key) was discarded mid-spec after the user clarified the real need was simultaneous multi-account tracking, not switching (session 00:02:00Z). Per-account env-var credentials were then also discarded in favor of AES-256-GCM DB storage because env vars still forced a restart to add an account (session 00:03:00Z).
**Rejected alternatives**:
- IBKR Client Portal Gateway — lost: not automatable (context.md:35).
- Platform-wide broker-switch config key — lost: didn't match real requirement (context.md:47-53).
- Per-account env-var credentials — lost: still requires restart per account (context.md:67-69).
- Full replace on position sync — lost: destroyed historical `opened_at`; changed to upsert (context.md:103-104).
**Scars & gotchas**:
- Spec field numbers/line numbers drifted from actual code by execute time — steps re-grepped rather than trusted the spec (context.md:174, 272).
- Local DB migrations couldn't be verified — no Postgres/Docker in harness — relied on manual review + deploy-time verification (context.md:216,230,244).
- `alpaca-default` seed row deferred from migration to app startup because PRE_DEPLOY migrator lacks trading-service env vars (context.md:144,214).
- Actual Go import path is `contracts/gen/go/...`, not `proto/gen/go/...` as spec assumed (context.md:314).
**Permanent deviations**:
- design said `map[string]broker.Broker` pool -> shipped `brokerPoolEntry{client, brokerType, userID}` map -> BrokerType/userID needed to travel with the client (context.md:286,407).
- design implied fill qty/price update in `pollFills` -> shipped without it -> `BrokerOrder` doesn't carry those fields (context.md:286).
- Design (FR-27, AC7) said `ListPortfolios` returns one Portfolio per active account for a given `user_id` (cross-account aggregation) -> shipped returns a single Portfolio for the requested `account_id` only, empty list if none given -> because `ListPositionsByAccount` returns a flat slice not a map, and cross-account aggregation was declared out of Step 17 scope (context.md:384; implementation-spec.md:1298-1300 Deviation Log). Undetected by tests; a silent AC miss, not a build failure.
**Cross-feature signal**: none beyond this feature.
**Deferred follow-ons**:
- Credential rotation still requires deregister+register (context.md:71).
- Trailing-stop percentage mode still out of scope (context.md:41).
- `ListPortfolios` cross-account aggregation never implemented — anyone relying on FR-27 semantics will get wrong data silently.
**Ledger entries written**: insights.md (2), fails.md (2) — see the 2026-08-05 entries.
**Runtime-invariant recommendations (→ /context-constitution)**:
- Go module import path for generated stubs is `contracts/gen/go/...`, not `packages/proto/gen/go/...` (context.md:314) — check for drift against current CLAUDE.md path table.
- `ListPortfolios` does not aggregate cross-account by `user_id` despite FR-27/AC7 — any future caller assuming that semantic will get wrong data (context.md:384).
**Pruned artifacts**: product-spec.md, implementation-spec.md — last present at 33ff5dc.
