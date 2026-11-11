# Context: homelab-otel-host-provider

**Feature**: `docs/roadmap/features/332-homelab-otel-host-provider/feature.md`
**Product Spec**: `docs/roadmap/features/332-homelab-otel-host-provider/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/332-homelab-otel-host-provider/implementation-spec.md`

---

## Session 2026-11-11 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Number 332 reserved on origin via `scripts/sdd-allocate-feature-number.sh`.
- Operator decisions (Q&A before story): (1) Grafana Cloud free tier acceptable now, self-hosted migration is future work; (2) attribute name is `host_provider`; (3) reuse the DO OTLP endpoint/credential mechanism where possible; (4) Grafana Cloud usage is not a constraint, DO will be cut over to homelab.
- Pre-story recon: `deploy/homelab/compose.yml:7` hardcodes `OTEL_ENABLED: "false"`; Grafana `deployment_environment` has only `staging`; `host_name` values are k8s pod names; resource attributes are on `target_info`, not on metric series.
- Branch note: harness branch is `ccr-6307b904-swdg1c`; the `feature/homelab-otel-host-provider` name in feature.md is the SDD convention, the PR still targets `main-dev`.

## Session 2026-11-11 — rename

- Operator renamed the resource attribute `host_provider` -> `host.provider` (OTel dotted form, matching `deployment.environment`). Prometheus/Loki label form is `host_provider` (dots -> underscores). Env var stays `HOST_PROVIDER`; slug/directory unchanged.
- Flag for review: `host.*` is an OTel semantic-convention namespace; `host.provider` is not a defined semconv attribute (the standard one is `cloud.provider`), so a future semconv addition could collide. Recorded, operator decision stands.

## Session 2026-11-11 — product-spec fixes after review FAIL

- First `/sdd-review product-spec` returned FAIL: criterion 9 (7 unchecked Open Questions) and trading-domain C-1 (no per-target `HOST_PROVIDER`/`OTEL_ENABLED` values). No Floor breach; overlap scan clean (WARN-level shared files only: 307 `deploy-homelab.yml`, 329 telemetry resource builders, 331 `.do/app*.yaml`, 297 dashboards).
- Operator decisions: unset or unrecognised `HOST_PROVIDER` resolves to `unknown`; DO dev and DO prod set `digitalocean` explicitly; fixes approved.
- Spec changes: FR-1 binds only the deploy interface (mechanism left to design); FR-2 value set gains `unknown`; FR-6 excludes `db-migrator` and names the `render-assert.jq:22,39` inversion; new FR-8 plus a per-target table (local compose `${OTEL_ENABLED:-false}`, DO dev `"true"`, DO prod `"false"`, homelab pipeline-owned `"true"`). Open Questions checked off as resolved or deferred with an owner.
- Finding recorded: DO production (`.do/app.yaml:33`) has `OTEL_ENABLED "false"`, so only DO dev exports to Grafana Cloud today. Enabling prod telemetry is out of scope.
- Acceptance: AC-3/AC-4 pinned to `unknown`; AC-6 uses the `us-central-0` example and excludes `db-migrator`; AC-7 asserts the `otel:xstockstrat-ui` label; AC-10/AC-11 made concrete and tagged `@smoke`; added AC-13 (exact lowercase match), AC-14 (wrong provider fails the render check), AC-15 (per-target values, FR-8).

## Session 2026-11-11 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Tree: ccr-6307b904-swdg1c@b6c71c0 ≡ origin/ccr-6307b904-swdg1c.
- Warnings: (1) homelab-production OTLP header/instance not yet confirmed — operator, before /sdd-spec; AC-8 assumes the production SOPS file holds it. (2) Deferred Open Questions 1, 3, 4 name a design phase as owner; pin a role at design. (3) AC-6 gateway region `us-central-0` is illustrative, unverified against the real stack. (4) AC-10/AC-11 are `@smoke` checks needing live Grafana; design says where they run and the pass condition. (5) Overlap sequencing below.
- Overlap findings (no FAIL-level; no merge-order row written): 307 `ui-env-themed-bundles` (code-completed, unmerged) edits `deploy-homelab.yml` and pins step order via `sops-secrets.test.sh` — rebase after 307; 329 `fix-telemetry-startup-log` edits startup-log lines in the same telemetry files (disjoint lines) — coordinate; 331 `fix-agent-mcp-transport-fallthrough` edits `.do/app*.yaml` agent health_check — rebase; 297 `grafana-dashboards-ci-deploy` owns `packages/otel/dashboards/**` — only if design adds a `host.provider` selector.
- Recommended design depth: full (12 affected services; warning-level overlaps).

## Session 2026-11-11 — acceptance change after spec-ready

- Operator: live smoke checks are not feasible without multiple PRs (they need DO and homelab both deployed with the change, i.e. post-merge). Resolves review warning (4) (AC-10/AC-11 `@smoke` placement).
- AC-10/AC-11 rewritten (IDs kept) as deterministic repo tests that parse the PromQL/LogQL blocks documented in `docs/patterns/observability.md` and assert the `host_provider="homelab"` matcher. AC-12 now also requires a documented manual post-deploy check with a concrete expected result. FR-5/FR-7 updated to match. Live verification is an operator step, not an acceptance gate. Status stays `spec-ready`: no FR was added, removed or changed in behavior, only how FR-5 is verified.

## Session 2026-11-11 — warnings addressed, spec re-reviewed

- Warning "homelab-production OTLP header": recon found `common.OTEL_EXPORTER_OTLP_ENDPOINT/_HEADERS` in BOTH `secrets/staging.enc.yaml` and `secrets/production.enc.yaml`, but `scripts/sops_secrets.py:32-33` scopes them to `(DO,)` (runbook line 9: "OTEL: DO only"), so `resolve --target homelab` did not emit them. The earlier FR-4/AC-8 premise ("existing SOPS path") was false. FR-4 now extends the target to homelab; homelab adds the `Authorization=` prefix once (DO does it at `do-render-app-spec.py:104-107`); a missing key fails the compose render via the `${VAR:?}` idiom because the keys stay `required=False` for DO. Still open for the operator: confirm homelab production should write to the destination in `production.enc.yaml` (values are encrypted, so same-stack vs separate-stack is not visible in the repo).
- Warning "deferred owners": pinned to Platform Lead (injection mechanism, queryability). Credential delivery question closed by the recon above.
- Warning "AC-6 region": the example now uses a fake `https://otlp.example.test/otlp` fixture value.
- AC-8 and AC-9 rewritten to match reality; AC-16 (missing key fails render) and AC-17 (DO resolution unchanged) added. AC-10/AC-11 were already made deterministic.
- Review hygiene: an Edit in this session briefly deleted two Open Questions bullets (malformed parameter); caught by a grep and restored with the recon-based text before commit.

## Session 2026-11-11 — sdd-review product-spec (re-run, operator request)

- Result: PASS WITH WARNINGS, no blockers. Status stays `spec-ready`. Tree: ccr-6307b904-swdg1c@e4b866d ≡ origin/ccr-6307b904-swdg1c.
- Verified by the reviewer: FR-4 citations; the carry chain `cmd_resolve` -> `APP_ENV` -> `homelab-release-env.sh` `owned` filter -> compose `--env-file` works once HOMELAB is added to the two KEYS rows; per-target table matches the tree.
- Warnings addressed in the spec: AC-16 expected text now matches `homelab-render-check.sh:15-17` ("required variable OTEL_EXPORTER_OTLP_HEADERS is missing a value"); FR-4 names the new `LEGACY_OTEL_EXPORTER_OTLP_*` lines in `deploy-homelab.yml` (needed by `sops-secrets.test.sh:1067` `check_legacy … homelab`) and the moving test pins (`COMMON_RE` :747, `check_legacy` :1067; the :155-159/:522/:579 pins are DO-side and unaffected); FR-3 states `homelab-release-env.sh` owns `OTEL_ENABLED` and `HOST_PROVIDER` and FR-4 that it rewrites the header line to add the prefix; AC-5 names the notify service; the AC-10/AC-11 parser choice is recorded as a design decision.
- Overlap (no FAIL-level): new WARN on `scripts/sops-secrets.test.sh` shared with 307 (pins around `resolve`); 307/329/331/297 sequencing as before. The scan recommended a blocking `merge-order.md` row (332 after 307); NOT written, awaiting operator confirmation.
- Open for the operator: (1) confirm homelab production should write to the destination in `production.enc.yaml`; (2) merge-order row for 307.
