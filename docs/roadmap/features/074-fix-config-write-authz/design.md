# Design: fix-config-write-authz

**Created**: 2026-07-29
**Rounds**: 2 (full; termination: approved with open risks accepted)
**Approved by**: orchestrator @ 2026-07-29 — see "Approval note" below
**Grounded in**: recon.md

---

## Approval note (deviation from P-04's interactive gate)

This run was invoked non-interactively by the harness with an explicit instruction to implement,
commit, and push features 073 and 074. The two design forks that would normally go to the user
(test-harness scope, `author` sourcing) are recorded below with their evidence and the decision
taken, and are called out in the PR body as separable — a reviewer can veto either without
unpicking the rest. The debate itself ran in full (2 rounds, proposer + adversary, no Floor breach).

---

## Chosen Approach

### 1. The gate

A fail-closed ADMIN-bit check on `SetConfig` **only**, in a new module
`services/xstockstrat-config/src/grpc/authz.ts`, called as the **first statement** of `setConfig`
(ahead of the destructure at `configServiceImpl.ts:252`), so a denied call reaches neither the
INSERT (`:256-265`) nor the `pg_notify` broadcast (`:266-268`).

`authz.ts` exports `ADMIN_SCOPE`, the two header-name constants, `hasAdminAccessScope(md?)`,
`userIdFrom(md)`, and the two error objects. The metadata accessor copies the **published** Node
shape (`docs/patterns/header-propagation.md:128-135`): `(md.get(k)[0] as string) ?? ''`, scope
defaulting to `'0'`, then `Number.parseInt(...) & ADMIN_SCOPE`. A missing/absent/NaN scope resolves
to `0` ⇒ denied. Error is the named `status.PERMISSION_DENIED` with the message **exactly**
`'admin scope required'`, matching the platform rule (`header-propagation.md:24-26`) and the live
Python sibling (`services/xstockstrat-ingest/app/handlers/servicer.py:860`).

Named `hasAdminAccessScope`, **not** `hasAdminScope` — `services/xstockstrat-ui/src/lib/auth.ts:79-81`
already exports `hasAdminScope(roles: string[])`; a same-name/different-signature pair across Node
packages is a future footgun, and three more Node services are meant to copy this module.

The `AsyncLocalStorage` propagation store is **not** revived — `header-propagation.md:145-147`
explicitly excuses config from it, and that excuse is about propagation, which this is not.

### 2. `author` resolution (decision, see fork 2)

`request.author` wins; else the propagated `x-user-id`; else abort `INVALID_ARGUMENT`. This mirrors
the *actual* platform precedent — `services/xstockstrat-indicators/app/handlers/servicer.py:207-220`
is literally `if request.author: author = request.author`, with `x-user-id` as fallback and an abort
when both are empty. (`docs/patterns/header-propagation.md:36-37` describes the reverse ordering and
is **doc drift**; corrected in the same PR.) Zero incremental files: `configUiBff.ts:19` already
injects `author: claims.user_id`, and `docs/runbooks/config-rollout.md:87` already sends
`author="platform-team"`.

### 3. Reads stay open — argued on the code, not on feature 073

`GetConfig`, `ListKeys`, and `WatchConfig` are **not** gated. Every service boots by dialing
`WatchConfig` with no metadata at all — Node `configWatcher.ts:29,42-48`, Python
`services/xstockstrat-analysis/app/config/watcher.py:33-38`, Go
`services/xstockstrat-trading/internal/config/config.go:103-107` (`context.Background()`). Gating
`WatchConfig` bricks platform startup; gating `GetConfig` while `WatchConfig` stays open is
incoherent, because `WatchConfig`'s first message is a full namespace SNAPSHOT
(`configServiceImpl.ts:209-220`) — a strict superset of `GetConfig`. Reads are therefore open **by
construction**, not by preference. Feature 073's assumption is a consequence, not the reason.

**Recorded divergence:** the product spec's Root Cause names all three RPCs (`product-spec.md:47`)
while its Acceptance Criteria cover only `SetConfig` (`:72-77`). Deliberate; see above.

### 4. BFF defense in depth

`services/xstockstrat-ui/src/lib/configUiBff.ts`: add `requireAdminScope` to the import block
(`:4-10`) and one call after `requireSession` (`:17`). The explicit handler body stays —
`forwardAdmin` is unusable because the handler injects `author` at `:19`. Exact precedent:
`insightsBff.ts:42-54`. Reuses `bffShared.ts:50-54` unchanged.

### 5. Verification — real wiring evidence, which requires repairing the runner (fork 1)

The adversary's O1 was upheld: a real `grpc.Metadata` inside a **hand-built** `call` literal proves
what `hasAdminAccessScope` does *given* a Metadata; it proves nothing about whether grpc-js delivers
one at `call.metadata`. That is the exact substitution `fails.md` (2026-07-27, feature 072) exists to
stop. So verification is an **in-process loopback gRPC test**: a real `grpc.Server` + the real
`createConfigServiceDefinition()` + the generated `ConfigServiceClient`, dialed over a real socket
on `127.0.0.1:0`, with real metadata, against a **recording** pool stub so a denied call asserts
`queries.length === 0` (direct evidence the INSERT and `pg_notify` were both skipped).

**That test cannot run today**, and neither can any other. See the verified defect in `context.md`:
`pnpm --filter xstockstrat-config test` reports "7 tests, 7 pass" while executing **zero
assertions**, because both test files guard a failing import with a *passing* early return. Three
independent blockers were confirmed by execution: the `.js` specifier (`ERR_MODULE_NOT_FOUND`), the
parameter property at `configServiceImpl.ts:94` (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` under
strip-only mode), and extensionless relative imports once Node reparses the files as ESM. Run
against compiled output the truth appears: `configServiceImpl.test.js` **fails** 1 of 2 (a stale
`value_type === 1` expectation vs `stringEnums=true`), and `configWatcher.test.js` **hangs** (its
first case constructs a live `ConfigWatcher` that dials and retries forever).

Decision: **repair the runner as part of this feature.** Point the test scripts at compiled output
(`tsc && node --test dist/__tests__/*.test.js`), fix the stale enum expectation, construct the
watcher via `Object.create(ConfigWatcher.prototype)` so the getter tests never dial, and delete the
now-pointless skip guards in favour of an unconditional import. Justification: C-08 requires a
paired test for a `service` step, and P-06 requires red-before-green. Neither is satisfiable — in
fact both are actively *falsified* — while the runner executes nothing. Shipping a SEV-1
authorization gate with a test that silently skips is the failure mode this whole debate was about.

UI side: `vitest.config.ts:18` excludes `src/lib/*Bff.ts` from coverage by design, so e2e is the
sanctioned path — flip `api-smoke.spec.ts:121,135` to `addAdminCookie` and add a non-admin-denied
case copying `live-strategies.spec.ts:60-78`. No new fixture; C-12 is satisfied via
`e2e/helpers/auth.ts` (`e2e/fixtures/INVENTORY.md:13`).

### 6. Trust-boundary scope — what this fix does and does not close

"Fail-closed" here means *fail-closed on the value of `x-access-scope`*, not fail-closed on the
network. `x-access-scope` is self-asserted by whoever dials port 50060, and that is the platform's
documented and intended model (`docs/patterns/header-propagation.md:11-28`: entry points
authenticate, internal services role-check only). This fix closes the **browser-user escalation**
the product spec describes — a `viewer`/`trader` session reaching `SetConfig` through the config-ui
BFF, now gated twice. It does **not** close **in-network self-elevation**: any process that can dial
50060 can assert `x-access-scope: 4`. In production that surface is bounded — `.do/app.yaml` gives
`xstockstrat-config` `internal_ports: [50060]` with no `http_port`/`routes` — but
`docker-compose.yml` publishes `50060:50060` locally, and two in-network self-elevators already
exist and are logged **OPEN**: the MCP agent hardcodes `("x-access-scope","7")`
(`services/xstockstrat-agent/app/client.py:32`, invariant AGENT-4) and the analysis fundsignal loop
injects `4` (`services/xstockstrat-analysis/app/engine/fundsignal_loop.py:344-345`). That open
question is `docs/context-constitution-findings.md:37` and **it remains open and unowned by this
feature.** Marking this bug resolved must not be read as answering it — after this fix `SetConfig`
joins the set of RPCs those two self-elevators can reach, which slightly *raises* the stakes.

### 7. AC #4 disposition

Product-spec AC #4 ("reproduce `config-rollout.md` Step 2's example end-to-end post-fix") **cannot**
be discharged by a doc edit — editing the runbook makes it *correct*, it does not *reproduce*
anything. AC #4 is discharged **by AC #5**: the dev smoke test executes the amended Step 2 snippet
(with admin metadata) against dev `xstockstrat-config:50060` and pastes the returned `version` into
`context.md`. One artifact, one execution, no unverifiable claim.

### 8. Scope exclusions, each with its reason

- **`propagation.ts` is NOT deleted.** It is 1-of-4 identical copies; `docs/context-constitution-findings.md:17,33`
  both assert "in all 4 Node services", so deleting config's alone makes two findings rows
  half-true — the exact C-10 "fixed it at the first instance" shape this feature's recon flagged.
  A follow-up note is added instead.
- **`manageSignalSource` stays BFF-ungated** — it is *already* gated server-side at
  `services/xstockstrat-ingest/app/handlers/servicer.py:859-861`, and BFF-gating it would break
  three specs asserting 200 on a non-admin cookie (`e2e/config-ui/sources.spec.ts:94→110`,
  `:114→121`, `:132-149`). Rationale: "already enforced at the backend; BFF symmetry deferred."
- **`useIsAdmin()` Edit/Save affordance gating** is out of scope — the ACs are server-side; a
  non-admin gets `Save error: Admin scope required` at `page.tsx:115`.
- **eslint DRY rails** ARE mirrored into `services/xstockstrat-config/.eslintrc.json` (it has none
  today) with an `authz.ts` override, because the stated goal is that three more Node services copy
  this module — and what they would otherwise copy is the raw literal.

---

## Rejected Alternatives

- **grpc-js server interceptor** — rejected *now*, but on a real trade-off, not dismissal. Its
  genuine advantage is structural: an interceptor is the only shape a future handler cannot forget
  to call, which matters because every C-10 entry in `fails.md` is "the guard landed at the first
  surface only." Rejected because there is exactly one RPC to gate and three that must stay open
  (so it needs a method allow/deny map — more configuration surface than the check itself), no
  `grpc.Server` options block exists anywhere in the repo, and the loopback test supplies the wiring
  evidence that was the interceptor's main safety argument. **Revisit trigger: if a second
  `xstockstrat-config` RPC ever needs an admin gate, migrate to an interceptor rather than adding a
  second inline call.**
- **Private static `_hasAdminScope` on the impl class** (mirroring Python) — rejected: not
  independently unit-testable, and not importable by the three sibling Node services.
- **Requiring `x-user-id` for `author` (option i)** — rejected: it would *exceed* platform precedent
  (indicators lets `request.author` win), it buys zero authenticity (a caller that can forge the
  scope header can forge the user header), and it collides with invariant AGENT-4, pre-breaking
  feature 073's `set_config` tool before it ships.
- **Leaving `author` untouched (option iii)** — rejected: `author` may be empty today, landing a
  blank `updated_by` (`configServiceImpl.ts:264`), i.e. an anonymous row in the audit trail the fix
  is supposed to make trustworthy.
- **Gating `GetConfig`/`ListKeys`** — rejected: incoherent without gating `WatchConfig`, which
  would brick platform startup (see §3).
- **Deleting the dead `propagation.ts`** — rejected as 1-of-4 scope creep (see §8).
- **Hand-built `call` literal with a real `grpc.Metadata`** — rejected as consumer-contract theater
  (see §5); direct `fails.md` 2026-07-27 hit.
- **Rewriting `scripts/integration-test.sh` section 13 to grpcurl** — rejected: the whole script is
  banner-marked non-functional (`:4-11`), targets removed 80xx ports (`:41`), and runs in no CI
  workflow; converting 2 of ~13 sections is unvalidatable here. Follows the feature-070 precedent
  instead — add the headers, record the staleness, don't rely on it as coverage.

---

## Open Risks

- [ ] **In-network self-elevation is not closed** (§6) — owner remains
  `docs/context-constitution-findings.md:37`, status open, explicitly *not* transferred to this
  feature. Target: none in this PR; must not be marked resolved by it.
- [ ] **A scope-asserting direct caller can still forge `author`** — §2 gives *presence*, not
  *authenticity*; authenticity is unobtainable at this boundary. Same owner as above.
- [ ] **Mock-backend fidelity** — `e2e/mock-backend.ts` does not model ingest's admin gate (proven
  by `sources.spec.ts:94→110` passing on a non-admin cookie), so the e2e suite cannot
  regression-detect backend-side admin gating for *any* RPC. New finding; to be logged.
- [ ] **`integration-test.sh:513-518`'s over-broad assertion** (`grep -qiE "…|error|…"` matches any
  error string) and the stale `CONFIG_URL` at `:41` — commented, not fixed. Accepted C-10 gap.
- [ ] **Non-admin config-ui users still see a functional Edit/Save affordance** — same class as
  `services/xstockstrat-ui/docs/context-constitution-findings.md:16`.
- [ ] **Dead `propagation.ts` survives in all 4 Node services** — deliberate, so root findings
  `:17,33` stay accurate rather than half-true.
- [ ] **The camelCase/snake_case wire mismatch** (`configServiceImpl.ts:253-254` reads
  `trading_mode` against a numeric map while ts-proto sends camelCase + `stringEnums=true`) is
  *demonstrated* by the loopback test's deliberate assertion gaps but not fixed — out of scope.
  Logged at `services/xstockstrat-config/docs/context-constitution-findings.md:19`.

---

## Constitution Rules Touched

- **C-01** — honored: every step cites a `path:line` verified by recon or by execution this session.
- **C-02** — honored: `context.md` read at boot and appended as decisions were made (P-05).
- **C-03** — not breached: no new outbound calls; the BFF already forwards all three headers
  (`bffShared.ts:41-47`).
- **C-05** — n/a: no new config keys.
- **C-08** — honored, and the reason the runner repair is in scope: the `service` step's paired
  `test` step must actually meet the service's CI threshold, which is impossible while the runner
  executes nothing.
- **C-10** — honored: the full `SetConfig` caller inventory was enumerated repo-wide (impl, BFF +
  browser hook, e2e specs + mock backend, integration script, runbook) and every instance is either
  updated or explicitly excluded with a reason. The two deliberate gaps (`propagation.ts` 1-of-4,
  `integration-test.sh` assertion) are recorded as accepted risks rather than silently left.
- **C-11** — honored: this is a confirmed bug on Track C, and the full SDD pipeline ran anyway.
- **C-12** — honored: no new frontend fixture; auth cookies come from `e2e/helpers/auth.ts`.
- **P-01/P-02** — honored: the orchestrator was the only writer; proposer and adversary never saw
  each other's raw output.
- **P-03** — honored: three claims that could not be verified read-only were *executed* rather than
  assumed (the runner defect), and every remaining unknown is listed under Open Risks.
- **P-04** — deviated, recorded: see the Approval note above.
- **P-05** — honored: findings written to `context.md` as they were discovered, before design.md.
- **P-06** — honored: the denial cases fail today (the write currently succeeds unconditionally),
  so red-before-green is natural — *once the runner actually executes them*.
- **F-01** — honored: no migration touched.
- **F-02/F-03** — honored: no direct push to `main-dev`/`main`; work lands on the designated branch
  via PR.
- **F-04** — honored: nothing invented; `## Not found` items from recon carried forward.
- **F-06** — honored: no pool change.
- **F-07** — honored: no hardcoded config values (the ADMIN bit is a protocol constant, not config).
- **F-11** — no Floor breach was raised by the adversary in either round.
