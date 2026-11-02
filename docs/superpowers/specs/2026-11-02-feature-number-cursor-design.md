# Feature-number cursor ref — design

**Status:** awaiting approval · **Size:** small change (process-only; no service, proto, config, or DB impact)

## Intent
Feature numbers (`docs/roadmap/features/NNN-slug/`) collide when two developers or sessions allocate
concurrently, or when an in-flight sibling on an unmerged branch already holds the "next" number
(`docs/roadmap/ledger/fails.md:2385`). Today `/sdd-story` computes `max(existing NNN)+1` from the local
tree (`.claude/skills/sdd-story/SKILL.md:35-49`), a read-then-write race that is repaired by
after-the-fact renumbering. Replace it with an atomic reservation made at `/sdd-story` time.

## Goals
- Distinct, monotonically increasing `NNN` across any number of developers and sessions.
- Reservation is a server-enforced compare-and-swap (CAS); losers detect the race and retry.
- Works from sandboxed cloud sessions (verified, see Constraints).
- Burned numbers (abandoned stories) are never reused; gaps are allowed.

## Non-goals / anti-goals
- Migration `NNN` ordering (`docs/reports/2026-10-19-config-seed-migration-late-lower-nnn-defect.md`) — separate, order-sensitive problem; explicitly out.
- No new service, no new dependency, no release/refund of numbers.
- Must never silently fall back to a local `max+1` (that reintroduces the race).

## Constraints (verified 2026-11-02 against `origin`)
- A session can create a non-session ref under `sdd/` and fast-forward it with a plain push.
- A push whose parent is no longer the tip is rejected as non-fast-forward (the CAS signal).
- A session **cannot delete** refs (HTTP 403) — acceptable: the cursor is append-only.
- The GitHub MCP file tools cannot create empty commits, so allocation is by `git push`.
- Shell must stay bash 3.2 / BSD-tool compatible (`CLAUDE.md` § macOS).

## Approaches considered
- **A (chosen): single cursor ref, empty commits.** Compact, inspectable, history is the allocation log.
- B: one ref per number via MCP `create_branch`. Atomic without push rights but leaves hundreds of refs and no "latest" pointer. Held in reserve only if push to `sdd/` is later denied.
- C: A with B as automatic fallback. Rejected — two code paths for a case not currently observed.

## Design
- Ref: `refs/heads/sdd/feature-cursor`, an orphan branch of empty-tree commits (never touches `main-dev`).
- Commit message: `sdd-cursor: <NNN> <slug>` (strict format; `NNN` = the number just reserved).
- Allocate: fetch tip → `N = parsed NNN` (absent ref: bootstrap `N = max NNN over origin trees`) →
  `floor = max(N, highest NNN in origin/main-dev tree and the local tree)` → candidate `floor+1` →
  commit `sdd-cursor: <candidate> <slug>` on the fetched tip (or as root if absent) → plain `git push`.
  Rejected → refetch and recompute; bounded retries with jitter.
- **Fail closed:** on exhausted retries, no push access, or an unparseable tip, abort `/sdd-story` with
  the reason. Never fall back to local `max+1`.
- Keep the existing "abort if the directory exists" check as defense in depth.
- Burn: abandoned reservations are not released.

## Changes (when approved)
1. `.claude/skills/sdd-story/SKILL.md` step 3: replace the local `max+1` block with the CAS allocator.
2. `docs/runbooks/feature-workflow.md` § Feature Numbering: describe the cursor, burn rule, fail-closed behavior; keep collision resolution as the legacy/manual-bypass path.
3. `docs/roadmap/ledger/fails.md:2385` candidate rule: point at the cursor (no new ledger entry).
4. Teardown per root `CLAUDE.md`: re-read touched context files against the code and note the reconciliation in the PR.

## Verification (defined up front)
A bash test uses a local bare repo as `origin`, runs N concurrent allocators, and asserts N distinct
consecutive numbers, plus: absent-ref bootstrap, stale-tip retry, no-push-access aborts without
allocating, and floor wins over a lower cursor. RED before the allocator exists, GREEN after.

## Left to the builder
Retry count/jitter, message regex, exact floor scan breadth (full all-refs scan at bootstrap only is
my call, to bound `ls-tree` cost across the many `ccr-*` branches).

## Open items for the owner
- **Delete the leftover probe ref** `sdd/probe-1793661202-25641` (sessions cannot).
- Protect `sdd/feature-cursor` (block force-push and deletion) so a stray rewrite cannot rewind it.
