# Context-scrubber findings

**Audit date:** 2026-09-03
**Branch / commit:** `claude/watchlist-bulk-default-strategy-zxx6su` @ `ee597c4`
**Analysis root:** repo root (all auto-loaded context files)
**Targets audited:** 23 `CLAUDE.md` + `README.md` + `docs/patterns/ui-ux-governance.md` (30 `context-constitution(.findings).md` files deferred — their scrubber-relevant issue is citation drift, a `/context-constitution` refresh job per CF-N9, not a scrubber trim).

---

## Summary (measured)

- **Removable (restated / duplication / bloat)** — the scrubber-apply-able set: ~40 lines across ~18 files.
- **Contradicted-by-code (defects)** — routed to `/context-constitution` findings, **never** a scrubber trim (CF-N9): 7 items.
- **Stale citations** — re-ground only (a `/context-constitution` refresh job, not a trim): 3 items.
- **Keep-but-verify** — unproven, phrased as questions: 6 items.
- Token figures are `≈ chars ÷ 4` (no tokenizer ran); line/char counts are measured/estimated from held file bytes.

> **NOTE (branch hygiene):** this audit runs on the **watchlist feature branch**. Trimming the platform's
> core context files here would mix a large cross-cutting docs refactor into a focused feature PR. Consider
> applying on a dedicated `chore/context-scrub` branch instead. Decision deferred to the operator gate.

---

## Restated (fails CF-N4) — free-to-read facts

| Context file:line | Category | Evidence (free to read) | Action |
|---|---|---|---|
| service `CLAUDE.md` Language lines (`analysis:39, config:13, identity:13, indicators:24, ingest:15, ledger:13, marketdata:23, notify:13, portfolio:36, trading:44, ui:25`) | restated | root `CLAUDE.md` § Language Versions + each `pyproject.toml`/`package.json` | trim bare value → keep only service-unique note (or pointer) |
| `DATABASE_URL=…# constructed by docker-compose…` (`analysis:373, config:111, identity:84, ingest:133, ledger:117, marketdata:150, notify:105, portfolio:146, trading:253`) | restated | `docker-compose.yml` `&db-url` anchor | remove the boilerplate line |
| `*_ENDPOINT` boilerplate env blocks (`marketdata:145-155, notify:102-113, portfolio:140-149, trading:245-257, ui:268-286`) | restated | `docker-compose.yml` + root § Env Var Naming | trim to service-unique vars (`BROKER_ACCOUNTS_ENCRYPTION_KEY`, `VAPID_*`, `ALPACA_*_URL`); drop boilerplate `GRPC_PORT`/`CONFIG_ENDPOINT`/`LEDGER_ENDPOINT` rows |
| `identity/CLAUDE.md:25-29` (eleven-methods enumeration) | restated | `packages/proto/identity/v1/identity.proto` | trim to a pointer |
| `CLAUDE.md:118` (bare `pnpm 9.15.9`) | restated | `package.json:5` `packageManager` | keep coordination note, trim the bare value |

## Cross-file duplication (CF-N3)

| Context file:line | Duplicate location (keeper) | Action |
|---|---|---|
| `CLAUDE.md:229-247` Connection-Pool table | `docs/patterns/database.md:41-89` (root already points there at `:226`) | trim root to the pointer + one-line ~22-slot rule |
| service Ports table gRPC numbers (`analysis:149, config:23, identity:23, indicators:34, ingest:25, ledger:23, marketdata:33, notify:23, portfolio:46, trading:54, ui:111, agent:11/176`) | root `CLAUDE.md` § Service Registry | keep root for the number; **keep** the local "former 80xx HTTP removed" note (service-specific) |
| `ui/CLAUDE.md:194-206` Dependencies port map | root § Service Registry / § Inter-Service Dependencies | keep root; retain only the "Used by" column |
| `docs/patterns/CLAUDE.md:8,:9` (nextjs-frontends / ui-ux-governance enumerations) | root `CLAUDE.md` Context Guide (same rows) | trim nested copy to filename + one-line "read when" |
| `docs/roadmap/features/CLAUDE.md:4-7` feature-numbering rule | `docs/runbooks/feature-workflow.md` § Feature Numbering (deep home) + root | point, don't restate |
| `docs/roadmap/CLAUDE.md:5` and `:12` "All phases (0-7) are DONE" (2× in-file) | root § Implementation Roadmap Status | collapse to one; keep root |
| `docs/roadmap/features/CLAUDE.md:46,84-86,132,138` "status lives only in status.md" (~4× in-file) | (self) + root § Feature Status | collapse to one statement |
| "Webhooks" stub sections (`config:95-97, identity:73-75, indicators:137-139, ledger:108-110`) | root § Service-to-Service Calls + each service Ports | remove the stub sections |

## Contradicted by code (defects → route to `/context-constitution`, never an apply trim — CF-N9)

| Context file:line | Contradicting site | Note |
|---|---|---|
| `README.md:35` `cp .env.example .env # fill in ALPACA_API_KEY, ALPACA_API_SECRET, JWT_SECRET` | `.env.example:29-33` + `CLAUDE.md:202` (feature 147 removed those creds → encrypted config rows) | ⚠ credentials; only `JWT_SECRET` remains a fill-in |
| `CLAUDE.md:275` "serves all **three** frontend segments" | `services/xstockstrat-ui/src/app/accounts/layout.tsx`, `src/components/shared/navGroups.tsx:88-98` (fourth `/accounts` segment) | segment drift |
| `CLAUDE.md:106` (Service Registry UI role) omits `/accounts` | same | segment drift |
| `README.md:3,:26` "trader, insights, config segments" omits `/accounts` | `ui-ux-governance.md:3` correctly lists four | segment drift |
| `docs/patterns/CLAUDE.md:10` nginx-routing row not marked deprecated | `docs/patterns/nginx-routing.md:3-5` (removed by feature 045) | doc-lie |
| `docs/runbooks/CLAUDE.md:8` approval-flow "(API / n8n / UI)" | `docs/runbooks/approval-flow.md` (zero `n8n` hits; removed by feature 011) | stale mechanism |
| `indicators/CLAUDE.md:146` `DATABASE_URL=…devpassword…` | `docker-compose.yml:23` `${POSTGRES_PASSWORD}` (six siblings use that form) | stale literal |

## Stale citations (re-ground only — a `/context-constitution` refresh job)

| Context file:line | Should point to |
|---|---|
| `marketdata/CLAUDE.md:70` `fundamentalsEnabled()` `marketdata_service.go:1143` | `:1174` (moved) |
| `portfolio/CLAUDE.md:77` trading findings `:14` | trading `docs/context-constitution-findings.md:17` (moved) |
| `config/CLAUDE.md:25` `app/lib/connectClients.ts` | `services/xstockstrat-ui/src/lib/connectClients.ts` (wrong prefix) |

## Should be just-in-time (move + pointer — riskier; operator call)

| Context file:line | On-demand home | Action |
|---|---|---|
| `CLAUDE.md:212-247` Connection Pool Budget | `docs/patterns/database.md` § Connection pooling (already the pointer target + holds detail) | move; keep the pointer + one-line budget rule |
| `CLAUDE.md:138-155` Version Bump Workflow | `docs/patterns/docker-build.md` / a version-bump runbook | move + heuristic |
| `analysis/CLAUDE.md:182-270` (Backtest Fill Model + Composable Strategy Rules) | analysis `docs/` (already offloads `scoring.md`/`warmup.md`) | move; keep invariant IDs + pointer |

## Brittle / over-specified (anti-altitude — trim to heuristic; operator call)

| Context file:line | Heuristic |
|---|---|
| `CLAUDE.md:299-331` Dockerfile Update Workflow (5 numbered steps) | "When you change a service Dockerfile, update its chain (service `CLAUDE.md`, `docs/patterns/docker-build.md` if the pattern changed) and rebuild to verify — see docker-build.md." |
| `CLAUDE.md:138-155` Version Bump Workflow (per-tool file list) | "Bump the table + `Dockerfile.codegen`, propagate to every pinned copy (CI, Dockerfiles, lockfiles); CI catches misses." |

## Bloat / low-value prose (lower confidence)

| Context file:line | Why |
|---|---|
| `CLAUDE.md` nginx-removed guard restated ~6× (`57, 193, 197-198, 275, 369, 477`) | over-documented historical removal; consolidate to one canonical spot |
| `docs/setup/CLAUDE.md:19` + `docs/CLAUDE.md:13` n8n setup step | deprecated no-op in an ordered list |
| service "Docker Build Pattern" one-liners (`analysis:141-143, config:15-17, identity:15-17, indicators:26-28, ingest:17-19, ledger:15-17`) | bare "see docker-build.md" pointer, no service-specific directive |

## Context budget (file-level, measured — advisory)

| File | Lines | ~chars |
|---|---|---|
| `CLAUDE.md` (root) | 512 | ~31,000 |
| `analysis/CLAUDE.md` | 377 | ~28,500 |
| `ui/CLAUDE.md` | 401 | ~25,000 |
| `trading/CLAUDE.md` | 269 | ~19,500 |
| `docs/patterns/ui-ux-governance.md` | 258 | ~14,500 |
| `marketdata/CLAUDE.md` | 165 | ~14,000 |
| `agent/CLAUDE.md` | 201 | ~14,200 |
| `portfolio/CLAUDE.md` | 149 | ~11,000 |

All are well over the ~2,000-char soft budget — expected for a mature monorepo; advisory only.

## Protected blocks (reported, never trimmed — CF-N11)

- behavioral contract — `CLAUDE.md:1-22` (`context-forge:behavioral-contract`)
- constitution pointer — every service + `packages/{otel,proto}` `CLAUDE.md:3-5` (`context-forge:constitution-pointer`)

## Keep-but-verify (CF-1 — unproven, questions)

- `CLAUDE.md:113-125` version table restates manifest values — trim to notes only if each value matches its manifest?
- `ui-ux-governance.md:35,45` literal token values (`hsl(...)`, `--radius`) — redundant vs `globals.css` if they match?
- `README.md:45-73` § Agentic Development — human-facing landing prose; keep if README is not truly agent-context here.
- `docs/roadmap/features/` reused sequence numbers (058/064/065 twice) vs `CLAUDE.md:407` "never reuse" — repo-state drift; triage.
- `TRADING_MODE=paper` in `analysis:375, identity:87, indicators:148, ingest:135, ledger:120` — config axis removed by 147; survives only as an OTel label — annotate or drop?
- `ui/CLAUDE.md:250` "20-connection budget" vs root "~22" — reconcile to one figure (root wins).

## Silent skills

None flagged in this pass (skill audit not run — the skills live under `.claude/skills/` and `plugins/`; deferred, no silent-skill claim made).
