# Product Spec: indicators-sandbox-os-isolation

**Created**: 2026-09-25

---

## Problem Statement

The indicators formula sandbox (`services/xstockstrat-indicators/app/services/sandbox.py`) restricts
untrusted formula code with a **builtins/import blocklist and no AST allowlist**. That is escapable by
the standard `().__class__.__base__.__subclasses__()` reflection chain to reach arbitrary Python
objects, i.e. remote code execution in the indicators service process (audit finding **C-3**,
Critical; design ticket **DT-1** — `docs/reports/2026-09-16-trading-system-security-audit.md`). The
shipped **C-4** mitigation runs the formula child with a minimal environment (`_sandbox_env()`),
severing inheritance of `DATABASE_URL` and master keys, but the underlying escape remains: an escaped
evaluator still executes in a process that can open the network and touch the filesystem. This feature
closes the escape's blast radius with OS-level isolation.

## User Story

As a platform operator, I want untrusted formula code evaluated inside an OS-isolated context with no
network, no writable filesystem beyond a scratch area, dropped capabilities, and hard resource limits,
so that even a successful sandbox escape yields no lateral movement — no outbound connections, no
secret/credential access, no impact on the service or its peers — and legitimate formulas still
evaluate correctly.

## Functional Requirements

FR-1. Formula evaluation MUST run in an **OS-isolated** execution context, not merely the in-process
AST/builtins guard: no access to a network namespace (no outbound sockets), no filesystem write beyond
a dedicated scratch/tmpfs area, dropped Linux capabilities, and enforced `RLIMIT` CPU / address-space
(memory) / wall-clock caps. The concrete mechanism (hardened `subprocess` + `setrlimit` + namespace/
capability drop, vs a jailer such as `nsjail`/`bubblewrap`/gVisor) is a design decision.

FR-2. An escaped evaluator MUST have no path to the indicators service's DB credentials, config
secrets, or any outbound network — a `subclasses()`-style escape yields code execution confined to the
isolated context only, with nothing to exfiltrate and nowhere to send it. (Extends the C-4 minimal-env
mitigation to the network and filesystem dimensions.)

FR-3. Resource exhaustion (infinite loop, memory bomb, fork bomb) MUST be bounded and terminated
deterministically, returning a typed evaluation error to the caller, without hanging or degrading the
indicators service for other requests.

FR-4. Existing formula behavior MUST be preserved: every formula that evaluated successfully before
this change evaluates to the identical result, and the indicator-builder acceptance behavior (see
`docs/runbooks/indicator-builder.md`) is unchanged. The isolation is a containment layer, not a
semantics change.

FR-5. The isolation boundary and its limits (RLIMIT values, allowed syscalls/capabilities if a jailer
is used, scratch size) are configured, not silent magic numbers — sourced from config/env where a
value is an operator tunable (Constitution **C-05**); the design decides which are tunables vs fixed
build-time constants of the jail.

## Out of Scope

- Adding new formula language features or built-ins — this is a containment change, not a capability
  change (FR-4 pins behavior parity).
- Multi-node / VM-level isolation (Firecracker microVMs) unless the design finds the container-level
  mechanism insufficient — start with in-container OS isolation; escalate only with justification.
- The indicators service's own gRPC auth or header propagation — unrelated surface.
- The agent SSRF (`207-extract-tool-ssrf-hardening`) and DB-role grants
  (`208-psql-db-role-grant-hardening`) — sibling security follow-ons.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-indicators` — owns the formula sandbox (`app/services/sandbox.py`) and its Dockerfile/
  runtime; the only service whose behavior changes. A base-image or capability change to the
  indicators image may be required (per the chosen mechanism).

## Consumer Surface(s)

_Constitution **C-14**._

- [ ] **UI** — none (the indicator-builder authoring UI already exists; its behavior is unchanged per
  FR-4).
- [ ] **Agent** — none (formula tools' observable behavior is unchanged per FR-4).
- [x] **None** — internal/platform hardening. The capability (authoring/running formulas) already
  ships and is unchanged; this feature only replaces the isolation mechanism behind it. Its observable
  effect is that a malicious formula is contained, not that a new user surface appears. No C-14
  override needed.

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- Possibly `indicators.sandbox.*` tunables (RLIMIT caps / scratch size / timeout) per FR-5 — **exact
  names and set pinned at /sdd-design/`/sdd-spec`**; recorded as an open question, not yet registered.

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/indicators-sandbox-os-isolation` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (`xstockstrat-indicators`) + Security review (Critical-finding
  remediation)
- [ ] 2 service owners + platform lead (breaking proto change) — N/A
- Note: if the mechanism changes the indicators Dockerfile/base image or requires added container
  capabilities, follow the Dockerfile Update Workflow and involve the platform lead on the deployment
  posture.

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] Isolation mechanism (FR-1): hardened `subprocess` + `setrlimit` + `unshare`/capability-drop
  in-image, vs a jailer (`nsjail` / `bubblewrap` / gVisor `runsc`)? Trade blast-radius coverage vs
  base-image and CI/runtime complexity — decide in `/sdd-design`.
- [ ] Does the chosen mechanism run under the DO App Platform / docker-compose runtime as-is (added
  capabilities, seccomp), or does it constrain deployment? Confirm with the platform lead.
- [ ] Config surface (FR-5): which limits are operator tunables (`indicators.sandbox.*`) vs fixed
  build-time constants of the jail?
- [ ] Latency/throughput budget: acceptable per-evaluation overhead of process/jail spin-up under the
  service's SLO — measure against current in-process evaluation.
