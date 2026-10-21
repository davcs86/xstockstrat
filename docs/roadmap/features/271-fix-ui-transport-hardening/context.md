# Context Log: fix-ui-transport-hardening

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-21 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-21-ui-transport-hardening-defect.md` (Issues disabled).
- Source: repo-surveyor debt-radar scan `docs/repo-surveyor/debt-radar-findings.md` @ 4535695, findings D-37, D-38.
- Severity: SEV-3. Impact type: request-hang-and-health-probe-auth. Environment: dev (main-dev) @ a053b0e. Config-only: no.
- Routed to SDD path (Track C) per the batch operator decision (grouped with the UI findings; Track C even at this
  severity, no hotfix/config route applies).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..4), context.md.
- Affected services: xstockstrat-ui.
- Root cause hypothesis: D-37 mTLS transport wrapper never set a default deadline, so each call site must opt in;
  D-38 health routes moved under segment prefixes (feature 045) while the matcher kept root-level exclusions.
- Re-verification on main-dev @ a053b0e: both reproduce in code. Line drift: none — `connectClients.ts:53-62`,
  `identity.ts:14`, `insightsBff.ts:58`, `:103` (plus `:114`), `traderBff.ts:78`, `middleware.ts:22`. No
  `defaultTimeoutMs` anywhere in `src/`. Health routes counted: 8 (trader ×2, insights ×2, config-ui ×2,
  accounts `api/health` + `api/agent-health`); `src/app/api/` has no health route, so the root exclusions match nothing.
  `refreshSession` is called from `middleware.ts:40`.
- **Overlaps:** 241-fix-config-audit-author-spoof (`implementation-ready`) mocks `@/lib/connectClients` in tests
  (test-level only; a new transport option does not change the mock shape). No 240–253 feature touches
  `middleware.ts` or `identity.ts`. Related, separate: debt-radar D-16 (agent `client.py` default deadline) is sibling batch feature
  273-fix-agent-client-deadlines (created concurrently); align the default-deadline value/approach across the two if design
  chooses a shared convention.
- Recommended design depth: skip → `/sdd-spec fix-ui-transport-hardening` (rationale: single service, no
  proto/migration/config, clear root cause). Escalate to `/sdd-design fix-ui-transport-hardening quick` if the
  default deadline is made a `ui.*` config key (root CLAUDE.md "no hardcoded values" vs the existing
  `FUNDAMENTALS_TIMEOUT_MS`-style constants), or if the matcher change needs a Security pass beyond the health routes.
- Operator decisions (2026-10-21): grouped by service+theme from the debt-radar scan; Track C for all SEV-2 (precedent #1264); batch launched via /sdd-batch with designGate halt.
- Development branch: feature/fix-ui-transport-hardening

## Session 2026-10-21 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Criteria verdict: PASS WITH WARNINGS (no fails, no floor breaches).
- Warnings:
  - Criterion 9 (Open Questions): three unresolved questions remain (default deadline value, constant vs `ui.*`
    key, streaming opt-out mechanism), each with a proposed resolution deferred to /sdd-design. Resolve them before
    the impl-spec gate. Question 2 is material: a config key flips the Fix Scope config box and brings in C-05
    naming and config-team approval.
  - Criterion 8 (AC well-formedness): AC-1 and AC-2 assert "no later than the default deadline (proposed 10s)";
    pin the number in acceptance.feature once design decides. **Resolved this session:** the non-standard tag
    `@AC-1b` (per-call override scenario) was retagged `@AC-6`. No other scenario was renumbered, so the AC
    references in product-spec.md stay valid.
  - Criterion 8 (AC-5): the stream-not-cut-off scenario needs a harness that holds the stream open past the default
    deadline and then delivers an alert. `e2e/mock-backend.ts` may not support that; settle test feasibility at design.
  - Criterion 11 (Consumer Surface): the surface is probe/middleware behavior, not a visible UI change. Acceptable,
    but the section does not use the C-14 checkbox / `None - internal/platform-only` convention.
  - FR-1 / D-37 scope: `connectClients.ts:66-73` wraps unary and stream separately, so a unary-only default is
    feasible. Design must preserve the explicit long unary `timeoutMs` at `insightsBff.ts:58`, `:103`, `:114` and
    `traderBff.ts:78` (30s / `FUNDAMENTALS_TIMEOUT_MS`).
- Overlap findings: none (overlap verdict PASS, no collisions).
- OPERATOR DECISIONS (binding, recorded 2026-10-21):
  - Grouped by service+theme from the 2026-10-20 debt-radar scan; Track C.
  - Scope is D-37, D-38.
- Next: `/sdd-design fix-ui-transport-hardening`.
