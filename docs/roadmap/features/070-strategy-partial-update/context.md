# Context: strategy-partial-update

**Feature**: `docs/roadmap/features/070-strategy-partial-update/feature.md`
**Product Spec**: `docs/roadmap/features/070-strategy-partial-update/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/070-strategy-partial-update/implementation-spec.md`

---

## Session 2026-07-26 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- **Origin:** discovered during offline cooldown-analysis + strategy-restore work on
  `range_mean_reversion_v3` (staging). Passing only `cooldown_days` to `manage_strategy update`
  wiped the strategy's `z`/`er` components and rules; every subsequent backtest returned 0 trades
  with `NO_TRADE_REASON_ENTRY_NEVER_TRUE`. Reproduced twice. Recovery required re-registering the
  formulas and re-sending the full definition, because no strategy read op is exposed.
- **Known trap noted:** proto changes here hard-couple the `manage_strategy` MCP tool,
  `docs/runbooks/mcp-tools.md`, and the StrategyWizard (ledger fails 056/060/067, rule C-10) — must
  be updated in the same feature with a test.

## Session 2026-07-26 — sdd-review product-spec (round 1: FAIL, round 2: blockers fixed)

- **Round 1 verdict: FAIL.** Four blockers, all "spec describes already-shipped behavior":
  - `GetStrategy` RPC + `GetStrategyRequest` already exist (`analysis.proto:23`, `:260-262`),
    implemented at `servicer.py:1410`, wired in the UI (`insightsBff.ts:55`) and the agent client
    (`client.py:311`). Only the **MCP tool** is missing. Re-adding the RPC would fail `buf lint`.
  - Orphan-ref validation already exists (`evaluator.py:323` → `_validate_term_ref`) — but
    short-circuits on an empty rule (`evaluator.py:317-318`), which is exactly why it did not catch
    the incident. FR-2 as written was a no-op requirement.
  - AC-2 and AC-3 were already green on `main-dev`.
- **Round 2 verdict: FAIL on two C-10 blockers** (both fixed):
  - FR-4 enumerated 3 of **5** tool-inventory surfaces. Full set: `docs/runbooks/mcp-tools.md:3`,
    `:29`, `services/xstockstrat-agent/app/tools.py:4`, `services/xstockstrat-agent/CLAUDE.md:26`,
    `docs/runbooks/CLAUDE.md:17`, plus `tests/test_tools_endpoint.py:23-37`. Precedent: feature 066.
  - **The MCP tool is a co-cause of the incident, not just a victim.** `manage_strategy`
    (`services/xstockstrat-agent/app/tools.py:338-344`) unconditionally builds a full definition dict
    from Python defaults — `components: components or []`, `entry_rule: ""`, `exit_rule: ""`, and a
    blanked `display_name`. A server-side merge **alone would not fix the reported bug**; the tool
    would still transmit explicit empties indistinguishable from deliberate erasure. Added FR-6, and
    AC-1 now requires end-to-end exercise through the MCP tool path (a server-only unit test would
    pass while the real path stayed broken).
- **Design constraints recorded** (for /sdd-design):
  - Proto3 **no field presence** on `components`/`entry_rule`/`exit_rule` (only `cooldown_days` is
    `optional`) means merge-by-default cannot distinguish "omitted" from "cleared" — this would break
    component removal in the StrategyWizard. Strongest argument for `FieldMask`.
  - Feature 065: a successful UPDATE changes the definition fingerprint and **discards the evidence
    base** (`servicer.py:1385-1398`), so a `cooldown_days`-only tune still resets the grade. Fixing
    the wipe does not fix this — OQ-2.
  - **Do not admin-scope `GetStrategy`** — it is intentionally un-scoped and the non-admin detail page
    depends on it (`strategies/[id]/page.tsx:42`). Scope the tool, never the RPC.
- Proto scope narrowed to the merge mechanism on `ManageStrategyRequest` (next free field **3**).
- **Deviation:** implemented on the harness-assigned branch `claude/features-070-071-rnbkqo`
  (rebased onto `main-dev`) rather than `feature/strategy-partial-update` with per-step PRs, because
  the harness pins the branch. Features 070 and 071 share this one branch/PR.

## Session 2026-07-26 — sdd-review product-spec (round 3: PASS)

- **Verdict: PASS WITH WARNINGS.** Status: `draft` → `spec-ready`.
- Both round-2 C-10 blockers verified closed. The five-surface enumeration was confirmed
  **exhaustive** by a repo-wide grep for "thirteen" — no live surface exists outside those five.
- Verified safe, needs no change: the `/accounts/mcp-tools` UI page renders `GET /api/tools`
  dynamically, and its e2e fixture `SAMPLE_TOOLS`
  (`services/xstockstrat-ui/e2e/accounts/mcp-tools.spec.ts:12`) is a deliberate two-tool sample that
  asserts no count — C-12 clean, no fixture update needed.
- Fixed a stale "four surfaces" phrase in the Risks section (FR-4/AC-5 both say five).
- Carried into /sdd-spec: expand bare filenames to full repo paths (C-01). Real paths are two levels
  deeper than they read — `app/handlers/servicer.py`, `app/services/evaluator.py`.
- Still open for /sdd-design: OQ-1 (merge mechanism), OQ-2 (feature-065 evidence wipe), and FR-2(b)'s
  "explicitly requested" erasure mechanism (falls out of OQ-1).
