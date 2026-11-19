# Context Log: fix-mcp-tools-page

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-19 (/sdd-triage)

- Bug reported via operator report (Issues disabled), recorded as `docs/reports/2026-11-19-mcp-tools-page-empty-on-homelab-defect.md`:
  MCP Tools page shows no tools on homelab deployments
- Severity: SEV-3 (operator-chosen; the report carried none)
- Routed to SDD path (Track C)
- Created: feature.md, product-spec.md, acceptance.feature (regression scenario), context.md
- Affected services (from report): xstockstrat-ui, plus the four deployment specs that set its env
- Root cause hypothesis: BFF fetches `${AGENT_PUBLIC_URL}/api/tools`; on homelab the public edge 404s it
- Recommended design depth: quick → `/sdd-design fix-mcp-tools-page quick` (rationale: SEV-3 and one code
  service would allow skip, but the fix adds a runtime env var across four deployment specs and the
  DO internal agent address is unverified — treated as the rubric's "config change is mentioned")
- Development branch: feature/fix-mcp-tools-page
- Operator decisions (AskUserQuestion, this session): env var name `AGENT_ENDPOINT` (`host:port`, not
  the report's `AGENT_INTERNAL_URL`); set in every deployment spec with **no** fallback to
  `AGENT_PUBLIC_URL`; call chain browser → authenticated BFF → agent over the internal network
- Open for design: the root CLAUDE.md convention table describes `_ENDPOINT` as gRPC `host:port`;
  `AGENT_ENDPOINT` is plain HTTP — the table needs a note. DO internal hostname/port for the agent
  component cannot be verified before deploy. Local `docker-compose.yml` sets the UI's
  `AGENT_PUBLIC_URL` to the internal address today (so the connector URL shown locally is internal) —
  pre-existing, not part of this fix unless design says otherwise.
- Agent-side question (`GET /api/tools` unauthenticated) left open in the agent findings file
- Operator constraint (2026-11-19, stated twice, "always"): the UI's BFF is the **only** entry point
  for calls from the UI's client side. Browser code never calls the agent (or any backend) directly;
  the authenticated BFF calls the agent inside the DO / homelab network. Recon must confirm no
  client-side code reaches the agent today.

## Session 2026-11-19 — sdd-design (in progress)

- Entered at status `draft` (Track C, `/sdd-review` skipped) on the operator's explicit choice of
  "Design quick, then stop".
- Tree: design ran on `ccr-a72ccc3e-9kr7yq` (= `origin/main-dev@5142fc5` + docs-only commits) because
  the feature directory is not on `main-dev` yet and this session may push only to that branch;
  `feature/fix-mcp-tools-page` does not exist on origin.
- Phase 0 Recon: wrote recon.md (xstockstrat-ui, xstockstrat-agent, four deployment specs). No
  post-recon escalation signal; no CHANGE business rule.
- Round 1 gate (operator): **Run another round**; O-4 → add the homelab render guard (D-9); O-7 →
  docs only, no warn log (D-10, R-5). Mode upgraded from 1 round to 2 at the operator's request.
- Round 2 gate (operator): **Run another round**; O-14 waived — DO is verified post-merge only (D-7
  stands; pre-merge probe locked as R-6); petition P-1 accepted — **O-4 reopened** to add a DO-side
  `AGENT_ENDPOINT` guard in the UI Vitest suite (round 3 designs it).
