# Context: ci-docker-registry-deploy  (archived 2026-08-05)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-05 — /sdd-archiver

**What**: Shipped as designed for CI-side build/push (all 15 services, GHA layer cache, SHA+floating tags), but the registry choice made in design (DOCR) only partially survived launch: DOCR's basic-plan 5-repo cap forced Step 3 to migrate just 5 of 15 services at merge time, and three days post-launch the whole platform was migrated off DOCR to GHCR entirely (context.md 2026-05-29). The feature's real end-state is "GHCR-backed CI build+push," not the DOCR design it was reviewed and approved against.
**Why (irrecoverable rationale)**: DOCR was picked pre-implementation for "native DO App Platform auth, zero credential wiring" (product-spec.md L95, context.md 2026-05-26T00:03). Nobody checked the DOCR basic-plan repo-count limit before committing to it in design/spec — the constraint only surfaced during Step 3 execution.
**Rejected alternatives**:
- Option A, CI build-validation only (no push/registry) — lost to Option B (build+push+DO pulls prebuilt) because the goal was eliminating DO's build-timeout/flaky-install failures, not just catching errors earlier (context.md 2026-05-26T00:00).
- Path-filtered builds (only changed services) — deferred/rejected for launch because the existing `changes` filter job "is not working correctly"; all 15 services build unconditionally instead (product-spec FR-1, context.md 2026-05-26 sdd-spec session).
- PR-triggered docker-build runs — rejected per explicit user request; job restricted to push-to-main/main-dev only, diverging from the reviewed impl-spec which called for PR builds (no push) to gate merges (implementation-spec.md Deviation Log, Step 1; context.md 2026-05-26T00:02, Step 1 note).
**Scars & gotchas**:
- DOCR basic plan hard-caps at 5 repositories — discovered only at Step 3 execution, not in design/review; forced an ad-hoc selection heuristic (top-5 services by pnpm lockfile package count: insights=117, trader=117, config-ui=114, identity=93, notify=93) rather than a principled choice (context.md Step 3 session, 2026-05-26T00:09).
- GHCR packages must be manually flipped to public on GitHub after the first CI push, or DO App Platform cannot pull them without credentials (context.md 2026-05-29).

**Permanent deviations (shipped contradicts design/spec)**:
- design/impl-spec said DOCR registry with SHA-pinned deploy tags for all 15 services -> shipped 5-of-15 partial DOCR migration at launch, then full GHCR migration for all 15 three days later -> because DOCR's 5-repo basic-plan limit made the original registry choice unworkable at scale (context.md 2026-05-26T00:09, 2026-05-29).
- impl-spec said `docker-build` runs on both push and pull_request (build-only, no push, on PRs) -> shipped push-only trigger (main-dev/main), no PR builds -> because the user explicitly requested it, overriding the reviewed spec (implementation-spec.md Deviation Log, Step 1).
- product-spec's Affected Services list enumerated only 14 services, omitting `xstockstrat-agent` -> `/sdd-spec` silently expanded scope to include `xstockstrat-agent` as a 15th service in the CI matrix and app-spec migration (Steps 1 and 3) -> because both `.do/app*.yaml` already carried an agent `dockerfile_path` entry, and leaving it un-migrated would strand a stale entry after the DOCR/GHCR cutover (context.md 2026-05-26T00:05, L45). This scope decision is invisible in shipped code — `ci.yml`, app specs, and `docker-compose.yml` all just show agent present, indistinguishable from ordinary scope creep without this rationale.
**Permanent deviations**: none
**Cross-feature signal**:
- 038 was declared "highest-priority active feature" (context.md Session 2026-05-26T00:02) not merely because of the merge-order file conflict, but because features 003 and 018 were *actively blocked from reaching production* by DO's build timeouts (cold pnpm install/build exceeding DO's build-time limit, worst for Next.js frontends) and flaky cold npm-registry installs on DO egress exhausting the retry budget — 038 was the unblocking fix, not just a predecessor. This rationale existed only in context.md prose (product-spec.md's Problem Statement documents the failure modes generically without naming 003/018).
- The merge-order gate itself was also confirmed real: 038 had to land before 003 and 018 since all touch `docker-compose.yml`/`.do/` files (context.md 2026-05-26 sdd-review session, 2026-05-26T00:11 execute session).
**Deferred follow-ons**: FR-1's path-filtered (changed-service-only) build matrix remains deferred pending a fix to the `changes` filter job.
**Ledger entries written**: insights.md (1), fails.md (2) — see the 2026-08-05 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none
**Pruned artifacts**: product-spec.md, implementation-spec.md — last present at f5abed5.
