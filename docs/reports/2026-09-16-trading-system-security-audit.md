# Security Audit — Multi-Tenant Trading Platform (2026-09-16)

**Scope:** whole-repository defensive security audit of xstockstrat, weighted toward the failure
modes that matter for a live-money, multi-tenant system: cross-tenant data/fund isolation, the
`x-user-id` header-propagation trust boundary, sandboxed formula execution, secrets-at-rest, and
injection/transport.
**Method:** six parallel read-only static-analysis passes (auth/identity, tenant isolation/authz,
frontend edge trust boundary, sandbox/RCE, secrets/config encryption, injection/transport), each
grounded in `path:line` evidence.
**Remediation posture (operator-chosen):** report + fix Critical/High surgically, fix-forward on
`main-dev` via branch `claude/trading-system-security-audit-ywgrnk`; architectural forks routed to
design tickets rather than built this pass. Production exposure for the funds-affecting findings is
flagged for a separate Track-A / maintenance-mode decision (see § Production exposure).

---

## Severity roll-up

| ID | Severity | Finding | Status |
|---|---|---|---|
| C-1 | Critical | Cross-account order execution — place real trades on another user's broker account | **Fixed** |
| C-2 | Critical | Cross-user order mutation — cancel/replace any user's working order | **Fixed** |
| C-3 | Critical | Indicators formula sandbox is escapable → RCE (no AST allowlist) | **Deferred (design)** — partial mitigation shipped (C-4) |
| C-4 | Critical | Escaped sandbox inherited `DATABASE_URL` + master keys via full `os.environ` | **Fixed** |
| H-1 | High | `StreamOrderUpdates` live tail broadcast every user's order to every subscriber | **Fixed** |
| H-2 | High | `SnapshotOfflinePositions` overwrote another user's position baseline | **Fixed** |
| H-3 | High | Cross-user portfolio reads (`ListPortfolios(account_id)`, `GetSnapshot(portfolio_id)`) | **Fixed** |
| H-4 | High | Default admin `admin@localhost / admin` authenticated in production | **Fixed** |
| H-5 | High | `--unrestricted` postgres-mcp + model-satisfiable confirm gate → prompt-injection DB writes | **Deferred (design)** — reverses shipped FR-2 |
| H-6 | High | config-ui audit route missing admin gate (cross-user disclosure) | **Fixed** |
| M-* | Medium | no mTLS/header-trust posture, `RevokeToken` unsigned-JWT, no login rate-limiting, `IssueAuthCode` impersonation primitive, `GetSecret` trusted-string, agent SSRF, `GetBacktest`/ledger/portfolio-stream cross-user reads | **Backlog** |
| L-* | Low | algorithm-pinning, bcrypt cost, password policy, login timing oracle, token-post-logout window, `x-trace-id` trust, CSP/headers, key rotation, OAuth `txn` replay, `ConfirmOrder` fail-open | **Backlog** |

Confirmed **sound** (do not regress): `x-user-id`/`x-access-scope` cannot be spoofed through the
edge (every BFF path rebuilds them from verified JWT claims); **zero SQL injection** (parameterized
`$N` + identifier allowlists across Go/Python/Node); AES-256-GCM at rest is correct (unique nonce,
verified tag, no default key, complete redaction, `is_secret` row-authoritative); OAuth 2.1 core is
sound (PKCE-S256, single-use codes, exact redirect match, `aud` binding, timing-safe HMAC).

---

## Fixed this pass

### C-1 — Cross-account order execution (Critical)
`services/xstockstrat-trading/internal/service/trading.go` — `PlaceOrder` / `resolveAccount`.
`resolveAccount(req.AccountId)` indexed a **global** broker-account pool keyed by `account_id` and
returned the entry with no check against the caller's `x-user-id`; `PlaceOrder` then submitted through
the *account owner's* Alpaca/IBKR credentials. Attacker A could `PlaceOrder(account_id=<B's UUID>)`
and trade on B's live account.
**Fix:** ownership gate after `resolveAccount` — `PermissionDenied` unless
`accountEntry.userID == middleware.FromContext(ctx).UserID` (fail-closed on empty caller), placed
before the offline-recording branch so it covers offline accounts too. The internal bracket-flatten
path is unaffected (it calls `submitOrder` directly, not `PlaceOrder`). Tests:
`trading_ownership_test.go::TestPlaceOrder_RejectsCrossAccount` / `_RejectsMissingCaller`.

### C-2 — Cross-user order mutation (Critical)
`CancelOrder` / `ReplaceOrder` loaded the order by id and hit the broker with no
`order.UserId == caller` check (unlike `ConfirmOrder`, which already guarded — though fail-open).
**Fix:** fail-closed ownership gate on both, placed before the offline-type/fill-state gates so a
non-owner cannot probe order state. `ConfirmOrder`'s guard was hardened to fail-closed on an empty
caller (was `callerID != "" && …`). Error codes now surface as `PermissionDenied` end-to-end
(`connectCodeFromErr` gained the `PermissionDenied` case; `PlaceOrder`/`CancelOrder` handlers now
preserve the service code instead of flattening to `Internal`). Tests:
`TestCancelOrder_RejectsCrossUser`, `TestReplaceOrder_RejectsCrossUser`.

### C-4 — Escaped sandbox inherited platform secrets (Critical)
`services/xstockstrat-indicators/app/services/sandbox.py` spawned the untrusted formula child with
`env={**os.environ, …}`, so an escape (C-3) yielded `DATABASE_URL` (shared TimescaleDB — every
tenant's data + config secret ciphertext), `JWT_SECRET`, `CONFIG_SECRETS_ENCRYPTION_KEY`,
`BROKER_ACCOUNTS_ENCRYPTION_KEY`.
**Fix:** the child now runs with a minimal env (`_sandbox_env()` — `PYTHONPATH` + the BLAS/OMP thread
pins only). This severs cross-tenant secret exfiltration even while the deeper escape (C-3) is
outstanding. Test: `tests/test_sandbox.py::TestSandboxEnvIsolation`.

### H-1 — `StreamOrderUpdates` cross-user live broadcast (High)
`broadcastOrder` fanned every order update to every subscriber; both streaming handlers forwarded
the channel blindly, so any subscriber received all users' live order flow (the initial snapshot was
already user-filtered; the live tail was not).
**Fix:** subscribers now carry their subscription's user filter (`orderSubscriber.userID`), and
`broadcastOrder` delivers an update only when `sub.userID == "" || order.UserId == sub.userID`,
preserving the documented internal all-users selector while scoping external subscribers. Test:
`TestBroadcastOrder_ScopesToSubscriberUser`.

### H-2 — `SnapshotOfflinePositions` cross-user baseline overwrite (High)
Validated the account was offline but never that it belonged to the caller, so A could replace B's
offline position baseline (DELETE+INSERT) and emit a falsified `account.positions.synced`.
**Fix:** ownership gate (`rec.UserID == req.UserId`, the handler-injected caller) before the
offline-type gate. Test: `TestSnapshotOfflinePositions_RejectsCrossUser`.

### H-3 — Cross-user portfolio reads (High)
`services/xstockstrat-portfolio/internal/service/portfolio_service.go`. `ListPortfolios(account_id)`
returned any account's equity/positions/P&L unscoped; `GetSnapshot(portfolio_id)` returned any user's
snapshot and `portfolio_id` **is** the `user_id` (highly guessable).
**Fix:** `ListPortfolios` now requires the caller and gates a supplied `account_id` via
`callerOwnsAccount` (the `ListAccountBalancesByUser ∪ ListOfflineAccountIdsByUser` owned set);
`GetSnapshot` requires `portfolio_id == caller`. Tests:
`portfolio_ownership_test.go::TestGetSnapshot_RejectsCrossUser` / `_RejectsMissingCaller`.

### H-4 — Default admin in production (High)
`services/xstockstrat-identity/migrations/002_seed_admin.up.sql` seeds `admin@localhost` with the
committed bcrypt hash of `"admin"` in **every** environment; the "rotate in production" comment
relied on manual action. Migration 002 is applied and immutable.
**Fix (code guard):** `authenticateUser` refuses any account still carrying the committed seed hash
when `APPLICATION_ENV === 'production'` (`isBlockedDefaultAdmin`), forcing rotation via
`scripts/manage-users.py reset-password`; dev/staging keep the convenience login. Tests:
`identityServiceImpl.test.ts` ("default seed-admin lockout").

### H-6 — config-ui audit route missing admin gate (High)
`services/xstockstrat-ui/src/app/config-ui/api/audit/route.ts` (commented "Admin-only") gated on
`getSessionFromRequest` only, so any authenticated `viewer` could read the full cross-user,
cross-namespace `config.config_audit` history.
**Fix:** `403` for non-admins via `hasAdminScope(claims.roles)`, mirroring the `configUiBff.ts`
`requireAdminScope` gate.

---

## Deferred — design tickets (route via `/sdd-story` → `/sdd-design`, or `/sdd-triage --from-report`)

### DT-1 (C-3) — OS-level isolation for the indicators formula sandbox
**Problem.** The sandbox is a builtins/import **blocklist** with no AST allowlist
(`app/services/sandbox.py`); the standard `().__class__.__base__.__subclasses__()` →
`__init__.__globals__['__builtins__']['__import__']('os')` gadget escapes `exec` using only
attribute/subscript syntax, yielding code execution as the service user in the service's container
and network namespace. Any authenticated user can trigger it via `test_formula` / `ExecuteFormula`.
C-4 removed the secret-exfiltration payload from the child env, but the escape itself remains.
**Why deferred.** In-process `exec` of untrusted Python cannot be secured by a blocklist; the real
remedy is an OS/process boundary — a design decision with infra/Docker implications.
**Options.** (a) nsjail/gVisor jail (unprivileged uid, no network namespace, read-only/empty fs,
cgroup CPU/PID/mem limits); (b) a locked per-exec container; (c) RestrictedPython/`asteval` AST
allowlist as a partial in-process hardening (insufficient alone). **Recommendation:** (a) or (b) —
the OS boundary is the load-bearing control; an AST allowlist is defense-in-depth, not the fix.

### DT-2 (H-5) — Agent DB write access under an LLM driver
**Problem.** `services/xstockstrat-agent/supervisord.conf` runs postgres-mcp `--unrestricted` and
`db_execute_sql` forwards raw model-supplied SQL. The FR-11 "destructive requires `confirm=True`"
gate is **client-side and model-satisfiable** — an autonomous, prompt-injectable LLM (the agent
ingests untrusted external content via `extract_email_content`/`extract_website_content`/signals)
can set `confirm=True` itself. The admin-scope gate and the DML-only, no-DDL `xstockstrat_agent`
role bound the blast radius to cross-schema `SELECT`/`INSERT`/`UPDATE`/`DELETE` on granted tables.
**Why deferred (not silently reversed).** A real fix — running postgres-mcp read-only (drop
`--unrestricted`) or requiring genuine out-of-band human approval for writes — **reverses feature
169's FR-2 ("write access required") and its acceptance tests** (`test_supervisord_conf.py`,
`test_db_tools.py` AC-13). No `confirm`-gate tweak actually closes the vector. Reversing a
deliberate, acceptance-tested capability is a product decision, so it is surfaced here rather than
changed unilaterally.
**Recommendation:** make the agent's DB access **read-only** (postgres-mcp restricted mode — its
default — keeps every `db_*` analytics tool working since they are read/analysis operations) and
route the rare legitimate write through a dedicated, explicitly human-confirmed path; scope the
`xstockstrat_agent` grants to only the schemas the analytics tools need. Also fix the agent SSRF
(M-list: `extract_*` follow redirects to caller-supplied URLs with no allowlist, reaching
`169.254.169.254`), which is the primary prompt-injection ingress.

### DT-3 (Medium) — Inter-service transport authentication (mTLS / signed service identity)
**Problem.** All inter-service gRPC is plaintext h2c with **no mTLS** (Go `insecure.NewCredentials`,
Python `add_insecure_port`, Node `createInsecure` across every service). The entire authorization
model — `x-user-id`, `x-access-scope`, and critically `x-internal-caller` (which authorizes
plaintext secret decryption via config `GetSecret`, and the cross-user watchlist read in portfolio)
— rests on network isolation plus header trust with **zero peer authentication**. Any workload with
L3 access to a 50xx port can impersonate any user, any admin scope, or any privileged internal
caller. Not internet-reachable today (verified: the UI BFF and the agent never emit
`x-internal-caller`), so it is a defense-in-depth / lateral-movement risk.
**Recommendation:** mTLS (or a signed, short-lived service-identity token) between backends so the
`x-internal-caller` / `x-access-scope` trust is backed by an authenticated peer, not solely network
segmentation. Until then, treat the private-network segmentation as a hard control.

---

## Medium / Low backlog (verify + fix through the normal tracks)

**Medium:** `RevokeToken` acts on an unverified (decoded, not verified) JWT → targeted forced-logout
DoS (`identityServiceImpl.ts`); no brute-force/rate-limiting/lockout on login or `PlaceOrder`;
refresh-token rotation without reuse detection; `IssueAuthCode` has no caller authentication →
internal impersonation primitive; `GetSecret` gated only by an unauthenticated `x-internal-caller`
string over cleartext gRPC (see DT-3); agent `extract_email_content`/`extract_website_content` SSRF
(no allowlist, reaches cloud metadata IP); ledger `QueryEvents`/`StreamEvents`/`GetEvent` and
`AppendEvent` are not user-partitioned (rely wholly on the internal-caller boundary);
`StreamPortfolioUpdates` broadcasts every user's snapshot; `GetBacktest` is not owner-scoped
(discoverable via the unscoped ledger).

**Low:** JWT verify pins no `algorithms` list (not currently exploitable — HS-only libs); bcrypt
cost 10 (< 12); no password-strength policy; login timing oracle → user enumeration; access tokens
valid ~15 min after logout/deactivate/role-change; inbound `x-trace-id` trusted end-to-end (log/trace
poisoning); no CSP / `X-Frame-Options` / `nosniff` response headers; config secrets have no
key-rotation/versioning; `loadMasterKey` dead-code hex guard + no weak-key check; OAuth `txn` blob
has no `exp`/nonce (PKCE-bounded replay); `db_execute_sql` FR-11 gate misses `ALTER`/`CREATE`/`GRANT`.

---

## Production exposure (operator decision required)

C-1 and C-2 are funds-affecting and were almost certainly live in production (`main` was promoted
2026-09-16). This pass fixes forward on `main-dev`. The operator should decide separately whether to
(a) set `platform.maintenance_mode=true` to halt live trading until the fix lands, and (b) fast-track
a Track-A hotfix / promotion per `docs/runbooks/bug-triage.md`. This audit did **not** set
maintenance mode or touch `main`.

---

## Verification

Per-service checks run green: trading (`GOWORK=off go test ./...`, `go vet`), portfolio
(`go test ./...`, `go vet`), indicators (`uv run pytest` — 133 passed, incl. the new env-isolation
test), identity (`pnpm test` — 67 passed, incl. the new seed-admin lockout tests), UI (`tsc --noEmit`
clean for the audit route). New tests encode each fixed ownership/authorization property.

_Generated by [Claude Code](https://claude.ai/code)_
