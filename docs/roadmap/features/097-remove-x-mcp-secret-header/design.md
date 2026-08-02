# Design: remove-x-mcp-secret-header

**Created**: 2026-08-02
**Rounds**: 1 (quick; termination: approved)
**Approved by**: orchestrator (autonomous run, per the requester's explicit instruction to "run the
SDD process until completion in one PR; no intermediate PRs" — see `context.md`). All round-1
objections were engineering-quality gaps with a clear, non-ambiguous fix (missing files in a
correction list, an under-scoped exemption set, an unmandated verification step), not a genuine
architecture fork requiring user judgment, so no `AskUserQuestion` gate was raised for this round.
**Grounded in**: recon.md

---

## Chosen Approach

A pure subtraction, executed as three ordered steps (matches `recon.md` Recommended Scope,
`recon.md:113-132`), all landing directly on the feature's development branch with no separate
PR per step (sequential execute mode, per product-spec's Feature Workflow Notes).

**Step 1 — Agent header removal (code + test, one step).** In
`services/xstockstrat-agent/app/client.py:28-31`, change `_metadata()` to `return []`
unconditionally — drop the `if MCP_AGENT_SECRET:` branch and the `("x-mcp-secret",
MCP_AGENT_SECRET)` tuple — and correct the module docstring claim at `client.py:3`. Apply the
identical edit to `services/xstockstrat-agent/app/auth.py:22-25`'s byte-for-byte-duplicate
`_metadata()`; this single edit covers **both** of its call sites (`validate_bearer_jwt` at
`auth.py:41`, `validate_bearer_claims` at `auth.py:73` — recon confirmed two, not one). The
module-level `MCP_AGENT_SECRET = os.environ.get(...)` reads in both `client.py:22` and `auth.py:19`
become dead code after this edit and are **deliberately left in place** (see Rejected Alternatives)
— `app/oauth_server.py`'s independent copy (`:33`, HMAC calls at `:42,52`) is untouched and stays
the one load-bearing consumer of the env var. In the same step, rewrite all six `test_client.py`
assertions (`:12`, `:16-17`, `:102`, `:236-238`, `:386`, `:493`, `:659`) so each call site's
metadata assertion covers **both** the secret-set and secret-unset case collapsing to the same
`[]`/absent result — this doubles as the regression guard the adversary asked for (a future
reintroduction of the header would fail these assertions immediately) without a separate
literal-grep test. `test_auth.py` and `conftest.py`'s `MCP_AGENT_SECRET` fixture
(`conftest.py:56,67`) are reused unchanged — `test_auth.py` never asserted on `_metadata()`'s
return value, and OAuth-signing tests still need the env-fixture shape.

**Step 2 — Infra env-var trim.** Remove the `MCP_AGENT_SECRET` block from the notify/ingest/
analysis service definitions only:
- `docker-compose.yml:215` (notify), `:323` (ingest), `:363` (analysis)
- `.do/app.yaml:217-219` (ingest), `:261-263` (analysis), `:402-404` (notify)
- `.do/app.dev.yaml:217-219` (ingest), `:261-263` (analysis), `:402-404` (notify)

Leave the agent's own wiring (`docker-compose.yml:523`, `.do/app.yaml:295-297`,
`.do/app.dev.yaml:295-297`) untouched — it stays needed for OAuth signing. Because no CI job boots
the `docker-compose.yml` stack (confirmed: zero `docker compose`/`docker-compose` references in
`.github/workflows/ci.yml`), this step's verification is not "existing CI coverage" but an
**actually-executed** local smoke check: `docker compose up -d xstockstrat-notify
xstockstrat-ingest xstockstrat-analysis xstockstrat-agent && docker compose ps`, confirming all
four report healthy/running, with the output captured as the step's verification evidence (locked
into product-spec Acceptance Criterion 4 after round-1 synthesis).

**Step 3 — Doc reconciliation.** Delete the `### x-mcp-secret (downstream enforcement)` section
wholesale in `docs/runbooks/mcp-tools.md:74-81` (heading + sentence + its one-row table — the row
is the table's only content, so the table goes with it) and correct the file's inline "sends
`x-mcp-secret`" clauses found at `:241,388,707` (re-grepped at `/sdd-spec` time in case prose
elsewhere in the file references it — recon/round-1 flagged this enumeration as non-exhaustive).
Update `docs/runbooks/CLAUDE.md`'s one-line pointer to that section. Rewrite
`docs/setup/digitalocean.md:339-341`. Reword root `CLAUDE.md`'s `MCP_AGENT_SECRET` sentence in
§ Environment Variable Naming Convention. Reword `services/xstockstrat-agent/CLAUDE.md` (`:4`
banner, `:19-20` sentence, `:154` env-var table entry — add an OAuth-purpose annotation).
Reword `services/xstockstrat-notify/CLAUDE.md` (`:42,45`) without touching the underlying
"ungated by design" contract. Reword `AGENT-4`/`AGENT-6` in
`services/xstockstrat-agent/docs/context-constitution.md`, correcting the stale evidence line
numbers recon found (`client.py:28-31` not `:24-27`; `oauth_server.py:42,52` not `:41,51`;
`auth.py:22-25` not `:43`) in the same edit — `AGENT-6` moves from "triple-purposed" to
single-purpose (OAuth `txn` HMAC signing only) framing. Correct
`docs/launch-pdfs/product-features.md:186`'s "Platform services trust this header..." claim (added
in round 1 — the adversary found this live, uncorrected claim in launch/marketing collateral,
outside the original file list) and regenerate `product-features.pdf` via
`python3 scripts/build-launch-pdfs.py product-features` (verified in round 1 that the
`markdown`/`weasyprint` toolchain is installable in this execution environment — if it's
unavailable at execute time, record that as a named, explicit deferral in `context.md`, never a
silent skip).

**Verification-gate scoping (the removal-feature trap, `fails.md` 079).** AC-1 is split into two
checks rather than one blanket grep: (a) a **hard zero** for the literal `x-mcp-secret` string
inside `services/xstockstrat-agent/app/` — no legitimate survivor is possible there once step 1
lands; (b) a **reviewed** repo-wide `grep -rln`, where every live/current-tense claim is corrected
(step 3) and only historical/dated-snapshot survivors are accepted — explicitly scoped to
`docs/roadmap/features/*/`, `docs/roadmap/ledger/`, and `docs/reports/` (round-1 widened this from
the original spec's narrower "this feature's own directory + launched feature dirs" wording after
the adversary found `docs/reports/2026-08-01-mcp-tools-alignment-triage.md:57` — a genuinely
historical, out-of-scope survivor the original wording didn't cover). `docs/launch-pdfs/` is
explicitly **not** in the exemption set — it's live collateral, corrected in step 3, not exempted.

**Consumer surface.** None — internal/platform-only (product-spec `## Consumer Surface(s)`,
unchanged from story). No UI segment or Agent MCP tool's name, parameters, or return shape changes;
the OAuth login flow a user experiences is unaffected (only the *documentation* of
`MCP_AGENT_SECRET`'s purpose changes, not its behavior).

## Rejected Alternatives

- **Delete `_metadata()` entirely and inline `[]`/omit the `metadata=` kwarg at all ~32 call
  sites** — rejected: far larger, noisier diff across two files for zero behavioral gain over
  keeping a now-permanently-`[]` stub function; violates "write the minimum that solves the stated
  problem."
- **Delete the now-orphaned `MCP_AGENT_SECRET` module-level reads in both `client.py:22` and
  `auth.py:19`** (real dead code after step 1) — rejected: deleting `client.py`'s copy would force
  editing `conftest.py`'s `monkeypatch.setattr(client, "MCP_AGENT_SECRET", ...)` fixture too
  (widening the diff into test infrastructure for a purely cosmetic gain), and the leftover env
  reads cost nothing at runtime — `oauth_server.py` already does the identical `os.environ.get(...)`
  pattern as its one load-bearing copy. Applied symmetrically to both files (round 1 caught that the
  original proposal singled out `auth.py` as the only "orphaned" case when `client.py`'s copy is
  equally orphaned).
- **Blanket `grep -rn "x-mcp-secret"` returning zero hits across the entire repo as AC-1** —
  rejected: the same trap `079-remove-mcp-sse-transport` hit three times (`fails.md` 2026-07-29) —
  a removal feature's own artifacts (`recon.md`, `design.md`, `context.md`, prior features'
  historical design records) legitimately keep using the removed vocabulary in past-tense/
  removed-feature framing. Replaced with the two-tier check above.
- **Treat Step 2's infra removal as verified by "existing CI coverage"** — rejected after
  independent verification found no CI job boots `docker-compose.yml` at all; replaced with a
  mandatory, actually-executed local smoke check as the step's real verification evidence.
- **Renaming `MCP_AGENT_SECRET`** (e.g. to `MCP_OAUTH_HMAC_SECRET`) to reflect its narrowed,
  single purpose — rejected for this feature (already Out of Scope in product-spec): requires
  coordinated secret-value changes in the DO dashboard for dev and prod outside this repo's
  control; left as a named, optional follow-up rather than bundled into a cleanup PR.

## Open Risks

- [ ] `docs/runbooks/mcp-tools.md`'s inline "sends `x-mcp-secret`" clauses beyond the three grep
  hits found in round 1 (`:241,388,707`) may not be exhaustive — to be addressed at `/sdd-spec`
  time with a fresh, literal re-grep of the file before finalizing step 3's instructions.
- [ ] `docs/launch-pdfs/product-features.pdf` regeneration depends on the `markdown`/`weasyprint`
  toolchain being available in the execute-time environment; installable in this session's
  environment (verified in round 1) but not guaranteed in a different execution context — to be
  addressed at execute time with an explicit `context.md` note if it must be deferred.
- [ ] `.do/app.yaml`'s `MCP_AGENT_SECRET` block for notify/ingest/analysis is also touched by
  `084-droplet-compose-deploy` (`spec-ready`, not yet implemented) per the product-spec review's
  overlap scan — a rebase-risk, not a logic conflict, since 084 hasn't landed; to be watched at
  `/sdd-spec` time per the existing `context.md` note from the product-spec review session.

## Constitution Rules Touched

- `C-01` (zero-assumption / evidence-cited steps) — honored: every claim above cites `recon.md`
  `path:line`, itself grounded by four parallel `codebase-discovery` passes.
- `C-08` (test-step pairing) — honored: step 1 (the only `service`-category step) pairs its code
  change with the `test_client.py` rewrite in the same step, red-before-green (P-06). Steps 2/3 are
  `config`/`docs`-category (per `docs/runbooks/reviewer-registry.md`'s Step Category table), which
  the registry itself marks as not requiring a new automated test — but step 2 still carries a
  mandatory *executed* manual verification (see Chosen Approach), closing the gap the adversary
  found in round 1 where "existing CI coverage" was cited but does not exist.
- `C-10` (integration completeness across shared/duplicated surfaces) — honored: both duplicated
  `_metadata()` implementations (`client.py`, `auth.py`) are fixed in the same step, not just the
  first one found.
- `C-14` (name the consumer surface) — honored: product-spec explicitly marks "None —
  internal/platform-only" with a stated, verified reason (no RPC/tool/UI behavior changes).
- `P-03` (no silent deviation — escalate, never guess) — honored: the `docs/launch-pdfs/` and
  `docs/reports/` survivors the adversary found were not silently dropped — they're now explicit,
  named scope (FR-4, AC-1 exemption set) rather than an assumed non-issue. The PDF-regeneration
  toolchain dependency is flagged as an Open Risk with an explicit fallback (named deferral in
  `context.md`), not left implicit.
- `F-02`/`F-03` (never push directly to `main-dev`/`main`; step PRs target the feature's
  Development Branch) — honored: all work lands on
  `claude/remove-x-mcp-secret-header-icog9j` (this feature's actual Development Branch per the
  harness assignment, see `feature.md`), never directly on `main-dev`; the single integration PR at
  the end targets `main-dev` from that branch.
- `F-04` (never invent a file path or symbol) — honored: every file/line cited above traces to a
  `codebase-discovery` digest in `recon.md`; nothing here was invented.
