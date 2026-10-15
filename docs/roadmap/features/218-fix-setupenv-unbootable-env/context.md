# Context: fix-setupenv-unbootable-env  (archived 2026-10-14)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-10-14 — /sdd-archiver

**What**: `scripts/setup-env.sh`, the documented first-run path called from `bootstrap.sh`, wrote a `.env` that `docker compose` rejected: it never produced the two required encryption keys (`CONFIG_SECRETS_ENCRYPTION_KEY`, `BROKER_ACCOUNTS_ENCRYPTION_KEY`) and still wrote variables removed by feature 147 (`ALPACA_API_KEY`, `ALPACA_API_SECRET`, `MCP_AGENT_SECRET`). Single-file fix: both keys are now generated in both modes (`openssl rand -hex 32`, urandom fallback; JWT at 16 bytes), a valid existing 64-hex key is kept on overwrite, and the removed variables are gone.

**Why (irrecoverable rationale)**:
- Root cause: the script was not updated alongside feature 147 and the broker-accounts key, though `.env.example` was; no source records why the script was missed. It surfaced via a repo-surveyor gap scan (G-02).
- Keep a valid existing key on overwrite because a regenerated key cannot decrypt local rows written under the old one.
- The bug was triaged SEV-3 (lowered one level from the survey's proposal) because this is local onboarding tooling with no trading-path dependency.

**Rejected alternatives**:
- Prompting for the encryption keys — the recorded decision is generate both with no prompt in both modes; no reason for rejecting prompting is recorded (not guessed here).
- Regenerating keys on every rerun — would orphan locally encrypted rows.

**Scars & gotchas**:
- Process deviation: the fix landed on the harness branch bundled with the 2026-10-02 Track A hotfixes, not on `feature/fix-setupenv-unbootable-env` (never created); `/sdd-review`, `/sdd-spec` and the `/sdd-execute` loop were skipped (design depth `skip`, a one-script fix; the two `@AC-*` scenarios were run directly, RED on the original script, GREEN after).
- The triage skill's count+1 numbering formula diverges from `max+1` where gaps exist (already covered by the root `CLAUDE.md` numbering rule).

**Permanent deviations**: none (no design phase). The branch named in `feature.md` was never created.

**Cross-feature signal**: feature 147 changed the env contract but updated only `.env.example`; this is the recurrence of `fails.md:1554` (setup-env/.env.example are among the three run sites).

**Deferred follow-ons**: help and exit-code convention alignment across operator scripts is tracked as feature-gap I-11 in `docs/repo-surveyor/feature-gap-findings.md`.

**Ledger entries written**: insights.md (0), fails.md (0 — recurrence of `fails.md:1554`) — see the existing entry.
**Runtime-invariant recommendations (→ /context-constitution)**: none (the encryption-key requirements are in `.env.example`, `docker-compose.yml` and root `CLAUDE.md`).
**Pruned artifacts**: product-spec.md — last present at 09ec8d9a. Defect report `docs/reports/2026-10-02-setupenv-unbootable-env-defect.md` was already pruned (`git show 2ce8de0a:…`).
