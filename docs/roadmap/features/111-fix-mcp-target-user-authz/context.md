# Context Log: fix-mcp-target-user-authz

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-08-07 (/sdd-triage)

- Task instruction (session-assigned): "remove all 'target user' from the MCP tools; all calls and
  permission checks should be tied to the authorized user."
- Investigated via codebase-discovery subagent: exactly two caller-supplied user-identity
  parameters exist on MCP tools — `emit_alert`'s `target_user_id` and `manage_formula`'s
  `formula_author_user_id`. No `on_behalf_of`/`as_user` pattern found. No outbound `x-user-id`
  header exists anywhere in the service today (`_metadata()` always returns `[]`).
- Filed as a defect (not a feature) since this is fixing an existing broken-access-control gap, not
  adding a capability — `docs/reports/2026-08-07-mcp-target-user-authz.md`. GitHub Issues are
  disabled on this repo, so routed via `/sdd-triage --from-report`.
- Checked for overlap with prior work: feature 092 (`fix-mcp-writepath-authz`, launched 2026-08-02)
  deliberately left `notify.EmitAlert` RPC-level **ungated** as an explicit internal-service-caller
  contract, because non-MCP internal callers (analysis loops) send it with no per-user auth context
  at all (`docs/roadmap/ledger/insights.md`, 2026-08-02 092 entry). This fix does **not** reverse
  that decision — it is scoped to what the agent's **MCP tool** sends as the identity value, not
  the RPC's gating model or its non-MCP callers. Recorded explicitly in product-spec.md "Out of
  Scope" to avoid re-litigating 092's ruling.
- Severity: SEV-2 (broken access control; caller can address/broadcast alerts or assert formula
  ownership without any tie to their own verified identity). Environment: dev (no evidence of
  production exploitation, found via code audit). Config-only: no.
- Routed to Track C (SDD path), design depth: **quick** — SEV-2, single service
  (`xstockstrat-agent`), no proto/DB/config change anticipated, but one adversarial round is
  warranted because removing `target_user_id` changes `emit_alert`'s observable capability
  (loses caller-directed broadcast-to-other-user addressing through the tool) — see product-spec.md
  "Design Question For `/sdd-design quick`".
- Created: feature.md, product-spec.md, context.md (this file).
- Development branch: `feature/fix-mcp-target-user-authz` per Track C convention — but this session
  is a harness-assigned task pinned to `claude/remove-target-user-mcp-g4tfqm`
  (root CLAUDE.md Harness Default Branch), so implementation happens there instead; noted so a
  later `/sdd-status` or `/sdd-sync` run isn't confused by the branch name mismatch.
- PR #886 opened early against `main-dev` (triage docs only, no code yet) per the harness's "always
  create a PR after pushing" instruction; code lands via later commits to the same PR.

## Session 2026-08-07 (/sdd-design quick)

- Phase 0 Recon: wrote recon.md (services: xstockstrat-agent; key reuse: `_claims_from_context`/
  `_caller_access_scope` claims plumbing, `ctx: Context` parameter convention from the four
  admin-gated tools, `tests/conftest.py` claims fixtures). Recon flagged a third same-shape
  parameter (`manage_formula`'s `author`) not named in the original product-spec — surfaced per
  P-03 rather than silently absorbed or dropped.
- Phase 1 Grilling: 2 rounds (quick mode; user explicitly requested a second round after round 1's
  gate). Round 1: proposer/adversary established the core shape (shared claims-derivation helper,
  `ctx: Context` added to both tools, `author` folded into scope) but the adversary flagged an
  accidental-broadcast footgun (empty claims user_id silently reaching notify's `""`-means-broadcast
  sentinel), a missing C-14 Consumer Surface section, and understated test-breakage scope. Round 2:
  refined the shared-helper shape (two thin wrappers over one `_require_claims`, not a merged
  tuple), and — after weighing the proposer's hard-flip-default proposal against the adversary's
  fail-loud counter — chose **`broadcast: bool` as a required parameter (no default)** over
  defaulting to either broadcast-on (re-ships the vulnerability once `target_user_id` is gone) or
  self-only (silently narrows delivery for an unverifiable broadcast caller). Chosen approach: see
  design.md. Rejected: keep-and-validate `target_user_id` instead of deriving it; admin-gate
  `broadcast=True`; hard-flip default; defer `author`; merge the two claims helpers into one tuple
  return; backfill RuntimeError-branch tests for the four unrelated admin-gated tools.
- Patched product-spec.md during the design round (not deferred): added `## Consumer Surface(s)`
  (C-14) and revised Acceptance Criteria to reflect the required-`broadcast` decision and the
  `author` inclusion.
- Constitution rules touched: C-01, C-03, C-08, C-10, C-11, C-14, F-04/P-03. Floor breaches: none
  in either round.
- Status: `draft` → `design-approved`.

## Session 2026-08-07 (/sdd-spec)

- Generated implementation-spec.md with 7 steps. Status → implementation-ready.
- Key codebase findings (all re-verified against the current tree, not just recon.md):
  - `emit_alert` is exactly `app/tools.py:298-333`; `target_user_id: str = ""` at `:305`, docstring
    at `:316`, passthrough at `:329` — matches recon precisely.
  - `manage_formula` is exactly `app/tools.py:565-659`; `author: str = ""` at `:573`,
    `formula_author_user_id: str = ""` at `:574`, dict build at `:627-638` (`user_id=
    formula_author_user_id` at `:629`, `author=author` at `:630`).
  - Confirmed the indicators backend's ownership check is identical for update AND delete:
    `row["author"] != request.user_id` at both `servicer.py:317` (UpdateFormula) and `:416`
    (DeleteFormula); `RegisterFormula`'s `if request.author: author = request.author` at
    `servicer.py:215-216` is the exact sentinel-impersonation gap `design.md` cites.
  - Full breaking-test-call-site inventory (six for `manage_formula`, two for `emit_alert`) taken by
    direct grep of `tests/test_tools.py`, not estimated — see implementation-spec.md Step 4 and
    Step 6 Codebase Evidence for exact line numbers.
  - `docs/runbooks/mcp-tools.md` sections confirmed at `emit_alert` `:230-264` and `manage_formula`
    `:541-589`; repo-wide grep confirmed zero other doc/code surface (agent CLAUDE.md,
    `plugins/strat-lab/`, `context-constitution.md`) mentions either removed parameter by name,
    other than this feature's own artifacts and an unrelated historical spec
    (`docs/roadmap/features/094-fix-mcp-server-input-validation/implementation-spec.md:206`, left
    untouched — describes a different, already-shipped feature's input-validation work).
  - No proto, migration, or config-key steps — confirmed via `packages/proto/notify/v1/notify.proto`
    (`:34,56`) and `packages/proto/indicators/v1/indicators.proto` (`:169,197,217`): both target RPC
    fields already exist and already accept plain strings.

## Session 2026-08-07 (/sdd-execute — manual, harness-branch-pinned)

- Executed all 7 implementation-spec.md steps directly on `claude/remove-target-user-mcp-g4tfqm`
  (not the skill's normal per-step branch/PR automation — see implementation-spec.md Deviation Log)
  because the harness pinned this session to that branch with a "never push elsewhere" constraint.
  Every step's Instructions/Verification were followed exactly; TDD red-before-green (P-06) was
  proven live for each service+test pair (ran the new/updated tests against the pre-fix tree to
  confirm failure, then applied the service change and reran to confirm pass) rather than assumed.
- Steps 1-2 (shared `_require_claims`/`_caller_user_id` helpers + direct tests): 4 new tests, all
  198 pre-existing tests still passed after refactoring `_caller_access_scope` onto
  `_require_claims` (no observable behavior change).
- Steps 3-4 (`emit_alert`): confirmed `test_emit_alert_calls_grpc` failed red
  (`TypeError: missing 2 required positional arguments`) before the fix; green after. Added 3 new
  tests (broadcast-false derivation, removed-param rejection, no-claims raise).
- Steps 5-6 (`manage_formula`): confirmed all 6 spec-enumerated call sites failed red
  (`TypeError: unexpected keyword argument 'formula_author_user_id'`) before the fix; green after.
  Added 3 new tests (claims-derived author+user_id, removed-param rejection, no-claims raise).
- Step 7 (`docs/runbooks/mcp-tools.md`): full rewrite of both tools' parameter/error tables per
  design.md's explicit scope. `context-scrubber` skill unavailable this session (same as feature
  092's execute session) — noted in implementation-spec.md Deviation Log and feature.md Next
  Action rather than silently skipped.
- Final state: 208 tests passing (up from 198 baseline), 76.28% coverage (well above the 40%
  threshold), `ruff check`/`ruff format --check` clean. No proto/migration/config changes, exactly
  as design.md predicted.
- Status: `implementation-ready` → `code-completed`.
- Open Risks carried from design.md (unresolved, to watch post-merge): (1) requiring OAuth claims
  for `emit_alert`/`manage_formula` going forward — no non-HTTP caller found, but this is
  absence-of-evidence; (2) `broadcast` becoming required breaks any external MCP client caller
  currently omitting it — accepted tradeoff, blast radius on real (non-test, non-`ingest_signal`)
  callers not exhaustively enumerable from recon.

## Session 2026-08-07 (CI: feature status automation)

- Promotion PR #878 merged to main
- Feature promoted and committed: 856ad5a3a2ebc431c108cc7f508deb26885545c6
- Status updated: `code-completed` → `launched`
- Launched date: 2026-08-07
