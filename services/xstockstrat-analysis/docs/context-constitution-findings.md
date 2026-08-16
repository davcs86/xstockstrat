# xstockstrat-analysis — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24. For triage/fixing, not
governance. The config zero-trap fix and the internal admin-scope-injection security question are
recorded at the root (they are cross-cutting).

## Latent bugs (looks broken, not merely non-obvious)

| Issue | Impact | Evidence |
|---|---|---|
| **`ConfigWatcher` carries indicators identity**: module docstring "Config watcher for xstockstrat-**indicators**" and `client_id=f"indicators-{id(self)}"` | analysis registers with the config service under an "indicators-…" client id (copy-paste from the indicators template) | `app/config/watcher.py:2` (docstring), `:61` (`client_id`) |

## Open questions (unresolved *why* — needs a maintainer)

- ⚠ **security** — The fundamentals background loop injects `x-access-scope=4` (admin bit) into its own outbound metadata; the admin check is `int(x-access-scope) & 0x04`. Is a background loop self-granting the admin bit the intended trust model? (Cross-cutting with the MCP agent's hardcoded `x-access-scope=7`; tracked in the root findings log.) `app/engine/fundsignal_loop.py:346`, `servicer.py:190-202` — status: **open**
- ⚠ **security (forward-pointer, feature 133)** — Strategy ownership (feature 133) resolves the owner from the inbound `x-user-id` header, which raised the question of a *synthetic* outbound `x-user-id` = a stored strategy owner on the live loop's owner-scoped `ListWatchlists`/`ListPositions` calls — a second un-JWT-verified origination point for that header (the admin-bit self-injection above, extended to *identity* impersonation). **Feature 133 does NOT introduce that call site**: it is identity-only (live-loop *state* is owner-keyed, but the owner-scoped firing **universe** union — the piece that needs the synthetic header — is deferred to feature 132's `resolve_universe`, see 133 `implementation-spec.md` D-1). So the impersonation finding **belongs to feature 132**, not this one; recorded here only so a future reader knows why 133's `x-user-id` propagation did not add a new synthetic-header vector. — status: **deferred to feature 132**

> Note: the "all-None custom formula on staging" bug (PR #769/#773) is **resolved** by feature 067 —
> `evaluator.py:210-247` now uses `MessageToDict` (recursive `ListValue` decode). Not an open defect.

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
