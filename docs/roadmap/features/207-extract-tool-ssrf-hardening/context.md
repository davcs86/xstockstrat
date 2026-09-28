# Context: extract-tool-ssrf-hardening

**Feature**: `docs/roadmap/features/207-extract-tool-ssrf-hardening/feature.md`
**Product Spec**: `docs/roadmap/features/207-extract-tool-ssrf-hardening/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/207-extract-tool-ssrf-hardening/implementation-spec.md`

---

## Session 2026-09-25 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- **Provenance**: backlog security follow-on from the 2026-09-16 trading-system security audit
  (`docs/reports/2026-09-16-trading-system-security-audit.md`). The agent SSRF is the "M-list"
  backlog item and is explicitly called out in the DT-2 remediation (§150): "fix the agent SSRF —
  `extract_*` follow redirects to caller-supplied URLs with no allowlist, reaching [internal]." It is
  the prompt-injection **ingress** left out of scope by the agent DB-tooling remediation. That
  remediation is now feature 214 (`remove-agent-postgres-mcp`), which removes the `db_*` SQL egress;
  this feature closes the fetch ingress. The two are independent — no ordering dependency. (History:
  the DB remediation began as feature 193 `sysadmin-db-write-role` — separation — demoted/imported as
  feature 212, then replaced by the 214 removal when postgres-mcp was judged inherently insecure.)
- **Not a dup of `093-fix-mcp-extract-credentials`**: 093 (launched) concerned credentials handling
  on the extract path; this feature concerns SSRF egress validation of the fetch target. Distinct
  scope — confirmed before allocating the number.
- Created for pickup by another session per operator direction (Phase D security backlog).
- Open forks recorded in product-spec.md § Open Questions (config surface + whether a domain
  allowlist ships in v1 + the email-tool remote-fetch path). Resolve in `/sdd-design`.

## Session 2026-09-28 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Criteria pass: initially **FAIL** on one C-15 blocker — FR-5 (egress policy sourced from config) had
  no covering `@AC-*` scenario. **Fixed before advancing** (operator standing rule): added
  `@AC-8 @FR-5` (config-sourced egress policy; operator lowers a limit → subsequent fetches enforce it;
  no hardcoded CIDR/limit). Re-verified criterion 8: FR-1→AC-1/2, FR-2→AC-3, FR-3→AC-4, FR-4→AC-5/6,
  FR-5→AC-8, FR-6→AC-7 — all covered, AC IDs unique.
- Warnings addressed:
  - OQ2 RESOLVED (code): both extract tools share one `_fetch_url` (`app/tools.py:2226`; callers `:544`,
    `:510`) — currently no scheme/address/size validation. Hardening the single helper covers both (C-10).
  - OQ1 (config key set + domain-allowlist-in-v1?) and FR-6 audit mechanism (span vs structured log) →
    genuine design forks, routed to /sdd-design (their named venue); will surface to operator at design gate.
  - OQ3 (no hardcoded egress literals, C-05/F-07) → standing execution-time guard, asserted by @AC-8.
  - AC-3 `Then` de-implementation-flavored per the advisory NOTE.
- Overlap: WARN-only — soft `app/tools.py` rebase vs 214 (disjoint db_* block); now moot (214 merged to
  main-dev fc86bb5). `agent.extract.*` keys unique repo-wide; no migration/proto/config FAIL; no merge-order entry.

## Session 2026-09-28 — sdd-design (full, 2 rounds)

- Phase 0 Recon: recon.md (service: xstockstrat-agent). Reuse: single shared `_fetch_url` chokepoint;
  `get_config_value(namespace="agent")`; module `log` for FR-6; respx happy-path + direct validator units.
- Phase 1 Grilling: 2 rounds. Chosen: 3-layer SSRF hardening — pure `not-is_global` validator (app/egress.py)
  → subclassed httpx.AsyncHTTPTransport owning a pinned-connect httpcore backend (reject-if-any, async
  getaddrinfo, identity fail-closed assert) → hardened `_fetch_url` (manual per-hop redirect loop: scheme +
  IP + cross-origin credential-strip; streamed byte-cap). Config: 4 scalar agent.extract.* keys; deny-ranges
  stdlib-derived. FR-6: log.warning. Domain allowlist DEFERRED (operator decision 2026-09-28).
- Round 1 adversary (all folded): CGNAT is_private fail-open → not-is_global; self._pool silent-revert =
  TOTAL bypass → identity assert; per-hop scheme unenforced (httpx 0.28.1 grounded); pick-one → reject-if-any;
  python-version mapped-address semantics → explicit unit tests + interpreter pin.
- Round 2 adversary (all folded): manual redirect loop must replicate httpx cross-origin Authorization-strip
  (credential-exfil regression) → per-hop strip; blocking getaddrinfo → anyio.to_thread; byte-cap needs
  c.stream()+aclose not c.get(); FROM-SCRATCH transport REVERSED → subclass AsyncHTTPTransport (inherit tested
  bridge) + identity assert.
- Constitution: C-05/F-07 (config knobs vs stdlib invariants), C-10, C-14, C-16, C-18, P-06, F-04. Floor: none.
- Status: spec-ready → design-approved.

## Open Threads

- [ ] Accepted C-14 residual: content exfil to arbitrary PUBLIC hosts via caller URLs (allowlist deferred; credential-leak vector closed by cross-origin strip). Target: recorded; file follow-up feature only if an operator wants positive gating.
- [ ] httpx/httpcore internal coupling (self._pool + connect_tcp) — identity fail-closed assert + rebind CI test. Target: transport step.
- [ ] Reconcile Python 3.12 (recon/venv) vs 3.13 (CLAUDE.md); verify is_global mapped-address semantics on the deployed image interpreter. Target: /sdd-spec + validator test step.
