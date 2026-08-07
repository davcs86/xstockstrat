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
