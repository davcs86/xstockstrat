# Product Spec: sysadmin-db-write-role

**Created**: 2026-09-17

---

## Problem Statement

The MCP agent's `db_execute_sql` tool can run write/destructive SQL against the shared TimescaleDB,
gated only by the ADMIN scope bit (`0x04`) and a `confirm=true` flag. Because the agent is an
LLM that ingests untrusted external content (`extract_email_content`/`extract_website_content`,
ingested signals), a prompt-injection payload can drive an authenticated **admin** session to set
`confirm=true` and execute arbitrary cross-schema `INSERT`/`UPDATE`/`DELETE` — the `confirm` gate is
model-satisfiable, so it is not a real control (security audit finding **H-5**,
`docs/reports/2026-09-16-trading-system-security-audit.md`). Simply making the agent read-only would
reverse feature 169's FR-2/AC-13 ("write access required"), a deliberate capability. We need to keep
a legitimate write path but move it behind a privilege that no consumer session (and therefore no
prompt-injected agent) can obtain.

## User Story

As a platform operator, I want a dedicated **`sysadmin`** role that is the only privilege permitted
to execute write/destructive SQL through the agent's `db_execute_sql` tool — and that can be granted
exclusively via the server-side `scripts/manage-users.py` — so that a prompt-injected or compromised
admin session can read via `db_*` tools but can never perform arbitrary DB writes.

## Functional Requirements

FR-1. A new **`sysadmin`** role (a role STRING in `identity.users.roles`) maps to a new **SYSADMIN
access-scope bit** in the platform's scope bitmap; a user carrying `sysadmin` has that bit set in
their derived `x-access-scope`.

FR-2. `db_execute_sql` requires the **SYSADMIN** bit to execute a **write/destructive** statement
(`INSERT`/`UPDATE`/`DELETE`/DDL). Read-only statements (`SELECT`/`EXPLAIN`) continue to require only
the existing ADMIN bit (`0x04`). A caller with ADMIN but **not** SYSADMIN is denied writes
fail-closed with a clear `PERMISSION_DENIED`-style error.

FR-3. The `sysadmin` role is assignable **only** via `scripts/manage-users.py` (a direct-DB,
host-access-gated path). **No consumer surface** can grant it: the agent `manage_user`
(`create`/`set_roles`) tool, the config-ui user-management surface, and the identity
`CreateUser`/`SetUserRoles` RPCs must be structurally unable to assign `sysadmin`.

FR-4. The SYSADMIN scope bit and the `sysadmin`→bit mapping are one platform contract value,
mirrored consistently across every scope-derivation site (agent `app/scopes.py`,
UI `src/lib/auth.ts`) — no drift between mirrors.

FR-5. `sysadmin` is a **superset of `admin`**: a user carrying `sysadmin` has **both** the ADMIN
(`0x04`) and SYSADMIN (`0x10`) bits set in their derived access-scope, so granting `sysadmin` alone
suffices for every admin-gated `db_*` **read** tool as well as writes — no separate `admin` grant
required. _(Provisional WHAT decision, pinned by `@AC-10`; `/sdd-design` (full) may still weigh
superset vs orthogonal, but the superset behavior is the default the acceptance scenario asserts.)_

FR-6. A `sysadmin` user's privilege must remain **auditable**: `scripts/manage-users.py list-users`
(which reads `identity.users.roles` directly) MUST show the `sysadmin` role, and no admin surface may
present a `sysadmin` user as fully **non-privileged**. Because the closed proto `Role` enum cannot
represent `sysadmin` (FR-3), the enum-typed agent/UI `User` views (`list_users`/`get_user`) cannot
show it without a change; whether to *also* surface it there — via a minimal **additive** (non-breaking)
`User` field, an explicit `is_sysadmin`/privileged flag, or an accepted-and-documented gap — is a
`/sdd-design` decision. The acceptance scenario (`@AC-11`) pins only the authoritative-audit observable
(the script shows it), not the enum-view mechanism.

## Out of Scope

- The `extract_*` SSRF (the prompt-injection **ingress**) — a related follow-on, tracked separately
  in the security audit report's Medium backlog; note only, not built here.
- Full sandbox OS-isolation (C-3 / DT-1) and inter-service mTLS (DT-3) — separate design tickets.
- Any change to what the DML-only `xstockstrat_agent` DB role can do at the Postgres grant level
  (that is a defense-in-depth follow-on, not this feature's gate).

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-agent` — `db_execute_sql` gains the SYSADMIN write-gate; `app/scopes.py` gains the
  SYSADMIN bit + `sysadmin` role mapping.
- `xstockstrat-identity` — issues JWT `roles` claims from the DB `roles` string array (already
  free-string; carries `sysadmin` with no proto change); the `User` admin-view enum-display gap
  (FR-6) is addressed here — the authoritative audit path is `manage-users.py list-users`; any
  enum-view surfacing is a `/sdd-design` decision (see FR-6 + Proto note).
- `xstockstrat-ui` — `src/lib/auth.ts` `rolesToAccessScope`/`ADMIN_SCOPE` mirror gains the SYSADMIN
  bit + `sysadmin` mapping (contract parity; no user-facing UI view required).
- `scripts/manage-users.py` — `VALID_ROLES` gains `sysadmin`; the sole assignment path.

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **Agent** — `xstockstrat-agent` MCP tool `db_execute_sql`: behavior change — a write/destructive
  statement now requires the SYSADMIN scope bit (was ADMIN + `confirm`). Read-only `db_*` tools
  unchanged. This is the end-user-reachable surface the capability is consumed through.
- [ ] **UI** — no new user-facing view. (`src/lib/auth.ts` gains the bit mirror, an internal
  contract edge, not a rendered surface.)
- [ ] **None**

**Assignment surface (operator tooling, not an end-user consumer):** `scripts/manage-users.py`
`update-roles`/`create-user` — the sole path that can grant `sysadmin`, deliberately server-side.

## Proto Contract Changes

- [x] **No proto changes required.** `TokenClaims.roles` is already `repeated string` (free list), so
  `sysadmin` flows into JWT claims with no proto edit. **Deliberately** NOT adding `ROLE_SYSADMIN` to
  the closed `Role` enum (`packages/proto/identity/v1/identity.proto`) — keeping it out of the enum is
  the mechanism that makes the enum-typed `CreateUser`/`SetUserRoles` RPCs structurally unable to
  express it (FR-3). **Known trap (fails.md 2026-08-06, C-10(a/d)):** *if* design later chooses to add
  the enum value, every exhaustive `Record<Enum,…>`/switch consumer (TS/Go/Python) must be updated in
  the same feature with a build/reachability test.
  - _FR-6 note:_ if `/sdd-design` elects to also surface `sysadmin` in the enum-typed agent/UI admin
    `User` views, that would add **one additive, non-breaking** field to the identity `User` message
    (a `repeated string` roles mirror or an `is_sysadmin` bool — **not** a `Role` enum value) — a
    design-phase option, **not required** by the pinned FRs (FR-6 is satisfied by the
    `manage-users.py list-users` audit path alone). If chosen, it is a non-breaking proto add (1 owner).

## Config Key Changes

- [x] **No new config keys.** SYSADMIN is a compile-time scope-bit constant mirrored across services,
  not a `xstockstrat-config` key.

## Database Changes

- [x] **No schema changes.** `identity.users.roles` is an existing `TEXT[]`; `sysadmin` is a new value
  in that array, not a new column/table. No migration.

## Feature Workflow Notes

Branch to create: `feature/sysadmin-db-write-role` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (no proto change, no migration, no new config key)
- [ ] 2 service owners + platform lead (breaking proto change) — N/A
- [ ] DBA review + service owner (schema migration) — N/A
- [x] **Security review** (auth-scope focus, per reviewer-registry) — a new privilege bit + its
  assignment lockout must be scrutinized even though no formal gate is triggered.

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

Each item carries a **provisional decision** (checked) so the spec is complete enough to gate; every
one is an explicit **input to full `/sdd-design`**, which may overturn it with recorded rationale.
None is a blocking unknown.

- [x] **postgres-mcp `--unrestricted` (defense-in-depth):** *Provisional:* **keep `--unrestricted`** —
  the tool-layer SYSADMIN gate on `db_execute_sql` is the control (preserves FR-2 per DT-2). Design
  may additionally restrict the co-process as belt-and-suspenders.
- [x] **Superset vs orthogonal (FR-5):** *Decided (provisional):* **superset** — `sysadmin` implies
  `admin` (both bits set). Pinned by FR-5 / `@AC-10`.
- [x] **Write-vs-read classification (FR-2):** *Provisional:* extend `_is_destructive`
  (`agent/app/tools.py`) so **every** non-read statement (incl. `INSERT`, currently un-gated) requires
  SYSADMIN, **fail-closed** on parse ambiguity; read allowlist = `SELECT`/`EXPLAIN`/`SHOW`/`WITH…SELECT`.
  Design finalizes the exact classifier + allowlist.
- [x] **Enum-display gap (FR-6):** *Provisional:* authoritative audit path is `manage-users.py
  list-users` (pinned by FR-6 / `@AC-11`); surfacing `sysadmin` in the enum-typed agent/UI `User`
  views (a minimal additive non-breaking field or an `is_sysadmin` flag) is a design **option**, not
  required.
- [x] **`confirm` flag fate:** *Provisional:* **keep** the `confirm=true` flag as a UX guardrail (no
  security reliance — the SYSADMIN bit is the real gate). Design may drop it.
- [x] **Design constraint (not a question) — fails.md 2026-08-05 scope-creep near-miss:** the SYSADMIN
  bit MUST be derived only from verified JWT roles; **never** forward a blanket admin/sysadmin
  `x-access-scope` from any entry point that has not authenticated it. Carried as a hard constraint
  into design + review.
