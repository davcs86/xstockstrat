# Feature: indicators-sandbox-os-isolation

**Development Branch**: `feature/indicators-sandbox-os-isolation`
**Created**: 2026-09-25
**Last Updated**: 2026-09-25

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-25 | `idea` → `draft` | /sdd-story | Product spec generated (closes security-audit C-3 / DT-1 — OS-level isolation for the escapable formula sandbox) |
| 2026-09-28 | `draft` → `spec-ready` | /sdd-review | Product spec approved (PASS WITH WARNINGS, 2 advisory). AC-6 phrasing NOTE fixed pre-advance (observable Then, no `sandbox.py` reference). The 4 Open Questions (isolation mechanism, DO/compose runtime compat, tunable-vs-fixed config split, latency budget) are correctly-deferred /sdd-design inputs, not spec defects. Overlap scan CLEAN — watch at impl-spec: pin NEW `indicators.sandbox.*` leaf names (existing timeout_ms/max_concurrent/allowed_imports are trunk), and potential indicators-Dockerfile co-edit with 210 (mTLS). |
| 2026-09-28 | `spec-ready` → `design-approved` | /sdd-design | Design debated (4 rounds, full) + approved; recon.md + design.md written. Chosen: unprivileged in-container OS isolation — distinct-UID (nobody 65534) child + in-wrapper post-import seccomp allowlist (ERRNO(EPERM), native-arch) + expanded rlimits (NPROC=max_concurrent×16, FSIZE=0, no RLIMIT_AS) + PYTHONDONTWRITEBYTECODE/HOME/TMPDIR write-elimination + start_new_session/killpg; denial→runtime_error (no proto, operator decision), stays on DO App Platform (operator decision). Allow-set **empirically finalized via strace** of real numpy 2.4.3/pandas 3.0.1 (caught `mbind` on large arrays; added statx/getdents64 for runtime-glibc). Adversary caught: same-UID secret-read (→distinct UID), preexec_fn multithreaded-fork deadlock (→in-wrapper lockdown), denylist io_uring/32-bit bypass (→allowlist fails-closed), forked-orphan NPROC leak (→killpg load-bearing), openat file-creation (→HOME/TMPDIR=nonexistent). No Floor breach. |
| 2026-09-28 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 4 steps (pyseccomp dep + libseccomp Dockerfile; sandbox.py rewrite [distinct-UID + post-import seccomp allowlist + expanded rlimits + killpg/stdin] with servicer max_concurrent wiring; OS-isolation test module + coverage-omit removal covering AC-1..AC-6; docs reconcile + context-constitution teardown). No proto/config/migration changes. |
| 2026-09-28 | `implementation-ready` → `in-progress` | /sdd-execute | Steps 1-2 landed (pyseccomp dep + libseccomp Dockerfile; sandbox.py OS-isolation rewrite + servicer max_concurrent wiring). Execute sandbox is root + libseccomp present → full seccomp+setuid stack verified LOCALLY (not deferred): live smoke shows benign numpy→success (FR-4 parity), socket→contained, disallowed import→import_blocked. |
| 2026-09-28 | `in-progress` → `code-completed` | /sdd-execute | All 4 steps done. Step 3: 19 isolation tests (@AC-1..6) + full suite 162 passed, sandbox.py 97% coverage (omit removed), pre-existing suite green (FR-4/C-16). Step 4 docs reconciled (CLAUDE.md Sandbox Security Model + Docker Build Pattern; context-constitution INDICATORS-6..9 + re-grounded anchors; indicator-builder runbook). Teardown: context-constitution plugin unavailable → manual reconciliation performed + recorded. Next: C-16 promotion + integration PR. |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon Dossier](recon.md) — grounded codebase map + DO App Platform runtime constraint (Phase 0)
- [Design](design.md) — chosen approach (distinct-UID + post-import seccomp allowlist), rejected alternatives, open risks (Phase 1)
- [Implementation Spec](implementation-spec.md) — 4-step plan (deps/Dockerfile → sandbox.py rewrite → OS-isolation tests → docs/teardown)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Replace the indicators formula sandbox's in-process builtins/import **blocklist** (escapable via the
`().__class__.__base__.__subclasses__()` reflection chain — no AST allowlist) with **OS-level
isolation**: evaluate untrusted formula code in a locked-down child (no network namespace, no
filesystem write beyond scratch, dropped Linux capabilities, RLIMIT CPU/memory/wall-clock caps) so a
sandbox escape yields no code execution against the service's credentials, network, or peers. The
Critical finding C-3 in `docs/reports/2026-09-16-trading-system-security-audit.md`; DT-1 is its design
ticket. Builds on the shipped C-4 partial mitigation (minimal child env, `_sandbox_env()`), which
severed secret inheritance but left the escape itself outstanding.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Security | Escape containment: an escaped evaluator has no network egress, no DB credential, no writable FS beyond scratch, and dropped capabilities; the isolation boundary is OS-enforced, not language-level; the `subclasses()` reflection escape no longer yields lateral movement |
| `xstockstrat-indicators` | `app/services/sandbox.py` correctness: legitimate formulas evaluate identically; resource-limit termination is deterministic and returns a typed error; latency/throughput impact acceptable |
| Platform lead | Runtime/deployment mechanism (subprocess hardening vs a jailer such as nsjail/gVisor), Dockerfile/base-image and capability requirements, CI feasibility of the isolation in the indicators image |

## Next Action

`/sdd-review indicators-sandbox-os-isolation impl-spec` — validate the implementation spec, then `/sdd-execute indicators-sandbox-os-isolation`
