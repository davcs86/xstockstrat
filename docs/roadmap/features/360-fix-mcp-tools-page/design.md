# Design: fix-mcp-tools-page

**Created**: 2026-11-19
**Rounds**: 4 (quick mode, upgraded round by round at the operator's request; termination: approved)
**Approved by**: user @ 2026-11-19T15:45Z
**Grounded in**: recon.md
**Debate register**: debate.md

---

## Chosen Approach

**Call chain (D-1).** The browser calls only the authenticated UI BFF route
`GET /accounts/api/mcp-tools` (`src/app/accounts/mcp-tools/page.tsx:69`); the BFF calls the agent over
the deployment's internal network. No browser code reaches the agent today (recon § Codebase Map), and
none is added. Consumer surface: the `/accounts/mcp-tools` page in `xstockstrat-ui`; no agent change.

**Route (D-2, D-13).** `services/xstockstrat-ui/src/app/accounts/api/mcp-tools/route.ts` keeps its
session gate first (`:14-15`), then reads `process.env.AGENT_ENDPOINT` inside the handler (request
time). Unset ⇒ `{ tools: [], reachable: false }`; otherwise it fetches
`http://${AGENT_ENDPOINT}/api/tools` with `{ cache: 'no-store' }`. The non-OK/`catch` degrade paths and
the `withBffMetrics` wrap (`:22-30`) are unchanged. No helper, no fallback to `AGENT_PUBLIC_URL`. The
header comment (`:11-12`) is rewritten in ≤2 lines to state that constraint. Every other
`AGENT_PUBLIC_URL` read (agent-health, `/accounts` layout, OAuth metadata, oauth-login) is untouched.

**Values (D-3, D-10).** One line next to each spec's `AGENT_PUBLIC_URL`, with a ≤2-line
"host:port, no scheme; the route adds http://" comment:

| Spec | Value |
|---|---|
| `deploy/homelab/compose.yml` (after `:284`) | `xstockstrat-agent:9000` |
| `docker-compose.yml` (after `:520`, outside the `:502` gRPC block) | `xstockstrat-agent:9000` |
| `.do/app.yaml` (after `:653`), `.do/app.dev.yaml` (after `:650`) | `${xstockstrat-agent.PRIVATE_DOMAIN}:9000` |
| `services/xstockstrat-ui/playwright.config.ts` (after `:168`) | `127.0.0.1:9099` (dead port) |

**Tests (D-4, D-5, D-11, D-18).** New Vitest
`src/app/accounts/api/mcp-tools/route.test.ts` on the `src/app/config-ui/api/audit/route.test.ts`
pattern. `fetch` is stubbed with `vi.stubGlobal`; `getSessionFromRequest` is a hoisted `vi.fn()`
defaulting to a session and reset in `beforeEach`; `AGENT_PUBLIC_URL` is stubbed in every case;
`afterEach` runs `vi.unstubAllEnvs()` and `vi.unstubAllGlobals()`.

- `@AC-1`: `AGENT_ENDPOINT` stubbed; URL-keyed mock (public → 404, internal → the fixture). Asserts the
  body `{ tools: SAMPLE_TOOLS, reachable: true }` and exactly one call, to
  `http://xstockstrat-agent:9000/api/tools`.
- `@AC-2`: `AGENT_ENDPOINT` explicitly unset; throwing mock; asserts the empty body **and**
  `not.toHaveBeenCalled()` — the route's bare `catch` (`route.ts:25`) would otherwise hide a fetch.
- `@AC-3`: session `null`, `AGENT_ENDPOINT` stubbed; asserts 401 and `not.toHaveBeenCalled()`.
  Characterization test — "red N/A"; untagged in `acceptance.feature`.

`SAMPLE_TOOLS` moves from `e2e/accounts/mcp-tools.spec.ts:12-30` to `e2e/fixtures/mcpTools.ts`
(imports nothing), consumed by the e2e spec and the route test; `INVENTORY.md:108` is updated.

**Guards against the value going missing (D-9, D-14, D-15).**

- Homelab: `deploy/homelab/render-assert.jq` projects the UI's `AGENT_ENDPOINT` (`:23`) and emits
  `ui-agent-endpoint` unless it equals `xstockstrat-agent:9000` (after `:53`).
  `scripts/homelab-render.test.sh` gains a rendered-value assertion in section 1 (by `:92`) and two
  mutations in section 7 (after `:189`): var deleted; var set with a scheme.
- DigitalOcean: a new `describe` in `services/xstockstrat-ui/src/lib/dbTlsPlatformGuard.test.ts`, with
  one file-local predicate `agentEndpointDrift(spec)` returning `null` or a reason. It compares the UI
  component's `AGENT_ENDPOINT` with `${xstockstrat-agent.PRIVATE_DOMAIN}:<agent http_port>` and fails
  closed when the agent or its `http_port` is missing. Positive test on both DO specs; mutation test on
  a clone with a baseline `null` first, then non-null after each of: env deleted, value with a scheme,
  agent `http_port` changed. The file header is rewritten (≤2 lines); the file is not renamed.
- `docker-compose.yml` is not guarded: local-dev only, a regression there shows as an empty catalog.

**Docs (D-6, D-14).** Root `CLAUDE.md`: naming-table row (`:178`) and the Rules bullet (`:184`) name
`AGENT_ENDPOINT` as the single plain-HTTP `host:port` exception (caller adds `http://`), without
reviving `<SERVICE>_HTTP_ENDPOINT`; the dependency tree gains
`xstockstrat-ui → xstockstrat-agent (HTTP GET /api/tools, internal network)`.
`services/xstockstrat-ui/CLAUDE.md`: the BFF-only sentence (`:17-18`) is widened to "backends or the
agent" — the durable home of the operator's rule that the UI's BFF is the only entry point for its
client side; the Dependencies intro (`:138`); the env list (`:216-217`) with a new `AGENT_ENDPOINT`
line. `docs/runbooks/mcp-tools.md:45-49`. One scoped-exception line in
`docs/patterns/inter-service-mtls.md` (plain HTTP, unauthenticated catalog metadata only, not a
precedent). The fetch-timeout gap (R-4) is logged in
`services/xstockstrat-ui/docs/context-constitution-findings.md`.

**Step shape for `/sdd-spec` (D-12, D-16, D-17).**

1. `test` — route test, fixture move, spec import, `INVENTORY.md`. **Lands with** step 2.
2. `service` — `route.ts`.
3. `test` (not `config`, which would skip the TDD gate) — guards first (red), then the five value
   files (green). `Covers: —` with the reason stated. Names a tool preflight (`docker compose`, `jq`,
   `openssl`, `yq`, `sops`, `shellcheck`, `shfmt`); a missing tool is installed or logged as a deviation
   naming the CI job as the green proof.
4. `docs`.

`## Step Dependencies` records that step 2's deployment files live in step 3 (order 2→3).
Verification commands: `pnpm exec vitest run <file>`; `pnpm run test:coverage` (≥40%, stated on both
test steps; the route test is outside coverage scope); `pnpm run lint`; `pnpm exec tsc --noEmit`;
`pnpm exec playwright test e2e/accounts/mcp-tools.spec.ts`; `bash scripts/homelab-render.test.sh`;
`bash scripts/sops-secrets.test.sh`; markdownlint on the two `CLAUDE.md` files;
`python3 scripts/check-context-map.py`.

**Deployment acceptance (D-7, D-8).** Operator, after the feature merges to `main-dev` and both dev
deploys finish; evidence (date, `main-dev` SHA, tool count) in `context.md`:

- Homelab staging: logged-in `GET /accounts/api/mcp-tools` → `reachable: true` with tools; external
  `GET /agent/api/tools` still 404; connector URL and OAuth discovery unchanged.
- DO dev app: the same BFF observation. This is a **manual gate before `main-dev` → `main` promotion**.
  If it fails, the pre-decided fix is `internal_ports: [9000]` on the agent component in both DO specs.

## Rejected Alternatives

- `R-1` Add `internal_ports: [9000]` to the DO agent up front — speculative; kept as D-7's remediation.
- `R-2` Keep the public URL on DO / fall back when unset — contradicts D-1; two code paths.
- `R-3` Shared HTTP base-URL helper — one consumer (C-18 YAGNI).
- `R-4` Fetch timeout in this fix — pre-existing gap; logged to the UI findings file.
- `R-5` Warn log on fetch failure — operator chose docs only (D-10).
- `R-6` Pre-merge probe from the DO dev UI console — operator chose the post-merge check only.
- `R-7` DO guard as a literal-only pin — fails a coordinated port move; mismatched predicates.
- `R-8` Shared YAML helper module plus a separate guard test file — refactor outside this bug.

## Open Risks

- [ ] DO private address for an `http_port`-only component is unproven in the repo; the page works on
  DO today via the public URL, so a failure is a silent regression — addressed at the D-7 promotion
  gate (manual; `/promote` has no feature-specific prompt).
- [ ] Homelab edge 404 and public-IP resolution are the operator's measurement; confirmed only by the
  D-8 check after deploy.
- [ ] D-9's literal homelab check does not detect a container-port-only change of the agent — accepted.
- [ ] No timeout on the server `fetch` — logged at step 4, not fixed.
- [ ] Track C template emits no `@FR-N` tags while C-15 and the durable suites expect them; `@AC-3` is
  untagged — process finding, to be resolved outside this feature before/at C-16 promotion.
- [ ] Agent `GET /api/tools` remains unauthenticated on the published port — stays the open item in
  `services/xstockstrat-agent/docs/context-constitution-findings.md:48`.

## Constitution Rules Touched

- `C-01`/`F-04` — honored by: every path and anchor re-verified across four rounds (recon.md, debate.md).
- `C-08`/`P-06` — honored by: route test red before the route change; both guards red before the
  values; characterization and self-check rows declared "red N/A".
- `C-10` — honored by: the value set in every run site in one step (`fails.md:1553`), plus two guards.
- `C-12`/`C-13` — honored by: `SAMPLE_TOOLS` centralized at its second consumer.
- `C-15` — honored by: `@AC-1..3` each covered by the route test; FR-tag gap recorded as an open risk.
- `C-16` — honored by: no existing rule changed (below).
- `C-18` — honored by: inline read, no helper, no new harness; trade-offs recorded as R-3/R-7/R-8.
- `F-07` — honored by: `AGENT_ENDPOINT` is a boot-time connection env var like the other `*_ENDPOINT`
  vars, not a config value.
- `F-08` — honored by: every staged file listed in its step's `**Files**` (D-16).
- `P-04` — honored by: four recorded gates; operator decisions in `context.md`.

## Business Rules Touched (C-16)

- PRESERVE `@AC-3 @feature-271` "Segment health routes are reachable without a session" (`services/xstockstrat-ui/acceptance/fix-ui-transport-hardening.feature`) — not regressed by: agent-health untouched, stays on `AGENT_PUBLIC_URL`.
- PRESERVE `@AC-4 @feature-271` "Non-health segment routes still require a session" (same file) — not regressed by: session gate stays first.
- PRESERVE `@AC-25 @feature-224`, `@AC-1 @feature-214` (`services/xstockstrat-agent/acceptance/`) and `@AC-6 @feature-283` (`docs/sdd/business-rules/platform.feature`) — not regressed by: catalog passed through unchanged; no agent change.
- PRESERVE `@AC-3 @feature-279` "Only the UI and the agent publish ports…" (`platform.feature`) — not regressed by: no new published port.
