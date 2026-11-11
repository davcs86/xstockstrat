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

## Session 2026-11-11 — operator answers after re-review

- OQ1 (operator): staging and production share one Grafana Cloud instance. Per-environment endpoints question RESOLVED; nothing is outstanding before `/sdd-spec`. Consequence recorded: `deployment.environment` and `host.provider` are independent axes on one stack, so AC-10/AC-11/AC-12 now require the documented queries to filter on both.
- OQ2 (operator): agreed to the merge-order entry. Added to `docs/roadmap/features/merge-order.md`: a table row `homelab-otel-host-provider` (332) after `ui-env-themed-bundles` (307), qualified "merge order only; 307 need not be `launched`" (the 304/305 precedent), plus a prose note for the non-blocking overlap with 329 and 331. Note for the record: the file's coverage note says textual overlap is normally NOT listed (the 300↔304 overlap is a prose note); the row was written as approved because the `deploy-homelab.yml` step order and `sops-secrets.test.sh` pins are a coupling, and can be downgraded to prose if the gate proves too strict.

## Session 2026-11-11 — sdd-design (Phase 0 recon, Phase 1 round 1)

- Phase 0 Recon: wrote recon.md (12 runtimes + homelab/SOPS pipeline + DO/local specs + OTel packages/docs + business rules; 7 discovery digests, all stamped `ccr-6307b904-swdg1c@3fdf7ba`). Live Grafana checks corrected the spec's Queryability premise: `deployment_environment` IS a series label (Grafana default promotion), `host.provider` would not be; Go/Node series carry no `instance`.
- Phase 1 round 1: design-proposer → design-adversary (verdict NEEDS WORK, 2 blocking, 0 Floor). Register on disk: debate.md (D-1..D-8, R-1..R-6, O-1..O-13).
- **Operator sign-offs at the round-1 gate (2026-11-11), recorded per C-16/P-04:**
  - C-16 CHANGE of `@AC-13 @FR-9 @feature-279` "OTel is off on the homelab" (`platform.feature` ≈1146-1150): homelab `OTEL_ENABLED` becomes "true" for the 12 runtimes; "no otel-collector service" stays. Signed off.
  - AC-9 rewording (Authorization= prefix applied in `sops_secrets.py resolve --target homelab`, shared helper also used by `do-render-app-spec.py`) and AC-10/AC-11 as structural guard checks. Accepted.
  - Steer: "Homelab staging must be staging environment, not development." Homelab staging `APPLICATION_ENV` becomes `staging`, which changes the `development` half of `@AC-22 @FR-6 @feature-279` ("the same build for staging renders \"development\"", `platform.feature:1196`). Recorded as the user's explicit sign-off for that CHANGE; TRADING_MODE stays `paper`. Knock-on verification is objection O-13 (round 2).
  - Decisions: both homelab targets export, alert/dashboard scoping is a named follow-up feature (D-8); deterministic `<provider>-<service>` instance id for Go/Node/UI (D-7).
- Correction recorded: earlier statements that homelab staging and DO dev "both report staging" were an unverified premise; the pipeline renders `development`. The operator's D-6 steer makes the original statement true going forward.
- Open Threads: O-4 (rollback text + manual old-tag test), O-12 (homelab egress to the Grafana OTLP gateway is an operator precondition), O-13 (D-6 knock-on).

## Session 2026-11-11 — sdd-design (Phase 1 round 2 and gate)

- Round 2: design-proposer then design-adversary (NEEDS WORK: 1 blocking, 11 non-blocking, 0 Floor, 0 register violations). All adopted into the register: D-9 (the `target_info` join's right-hand side is wrapped in `group by (job, instance, host_provider)`, because every Node/UI restart adds a `target_info` row under the unchanged deterministic `instance`; verified live: 7 distinct `(process_pid, host_name)` rows per Node job in 6h), D-10 (test and acceptance hygiene), D-11 (stale `application_env` comments at `trading.proto:295` and `config.go:31` become a findings entry, no proto edit), D-12 (design.md must record the DO rolling-deploy overlap, the shared staging token, the 3-stack budget, the paging semantics and the egress precondition), R-7.
- Round-2 gate (operator): O-20 settled as D-13 (`OTEL_ENABLED: "true"` and `HOST_PROVIDER: homelab` are fixed compose literals; no owned-regex entries or release-env writes for them). The operator asked for another round (round 3), so approval was not taken.
- Round 3 proposer (consolidation) found G-1..G-4, now O-25..O-28 and petition P-1 in `debate.md`. G-2 (O-26) needs the operator's C-16 sign-off for the `@AC-9 @FR-3 @feature-302` Given; P-1 needs the operator's reopen decision on one clause of D-10.
- Open Threads: O-25/P-1 (pending operator), O-26 (pending operator sign-off).

## Session 2026-11-11 — sdd-design (Phase 1 round 3)

- Round 3 (consolidation): design-proposer (found G-1..G-4 -> O-25..O-28, P-1) then design-adversary (NEEDS WORK: 1 blocking, 9 non-blocking, 0 Floor, 0 register violations; filed REOPEN O-6 as P-2; conditional P-3 on D-9). Register now D-1..D-17, R-1..R-7, O-1..O-39, P-1..P-3.
- Adopted without reopen: D-14 (PromQL left selector carries `deployment_environment`; aggregation wraps the whole join), D-15 (AC-12 queries `target_info` directly), D-16 (guard zero-block case; S8 guard + doc blocks land together; TSV row claim corrected), D-17 (test and doc corrections incl. the runbook precondition that both `common.OTEL_*` keys must be non-empty in both SOPS files).
- Awaiting the operator: P-1 (reopen D-10 case-3 clause), P-2 (reopen the `OTEL_RESOURCE_ATTRIBUTES` owned entry), P-3 (reopen D-9: join on `deployment_environment` too), and the C-16 sign-off O-26 (`@AC-9 @FR-3 @feature-302` Given).

## Session 2026-11-11 — sdd-design (round-3 gate)

- **C-16 sign-off (operator, 2026-11-11):** CHANGE of `@AC-9 @FR-3 @feature-302` (`platform.feature:1525-1530`). The Given is reworded so the shared resolver output includes the two OTLP lines; OTEL_EXPORTER_OTLP_ENDPOINT/HEADERS stay required `${VAR:?}`, so a SOPS file lacking them now fails every homelab render at the named variable (fails closed, before anything ships). Signed off. Together with the round-1 sign-offs, all three C-16 CHANGEs in this design are now on record: `@AC-13 @FR-9 @feature-279`, the `development` half of `@AC-22 @FR-6 @feature-279`, and `@AC-9 @FR-3 @feature-302`.
- **Reopens (operator, 2026-11-11):** P-1 (D-10 case-3 `evil` clause), P-2 (the `OTEL_RESOURCE_ATTRIBUTES` owned entry of D-5/O-6), P-3 (D-9/D-14 join keys). Round 4 runs as an amendment round; the operator chose no resolution for P-2, so the proposer weighs keep-as-waived / replace with a render-assert check / drop under C-18 and the ledger rule.
- Open Threads: O-25 and O-39 resolve in round 4.

## Session 2026-11-11 — sdd-design (Phase 1 round 4, amendment round)

- Round 4: proposer applied the three operator-reopened clauses; adversary verdict SOUND (0 blocking, 9 non-blocking, 0 Floor, 0 register violations). All 9 adopted: D-18 (P-1: case 3 feeds `OTEL_ENABLED=false` and `HOST_PROVIDER=digitalocean`, a precondition grep for each; AC-20 drops the vacuous 'no evil' clause), D-19 (P-2: the `OTEL_RESOURCE_ATTRIBUTES` owned entry is dropped; O-6 waived as an Open Risk pending the operator's acknowledgement; constraint text corrected to 'several runtimes merge it'), D-20 (P-3: final PromQL joins on `(job, instance, deployment_environment)`; AC-10/AC-11 wording; guard allows exactly one tagged block per language; AC-12 adds the 'run the documented query, expect at least one series' check), D-21 (design-approval writes for FR-3 and the acceptance edits).
- Register now D-1..D-21, R-1..R-7, O-1..O-48, P-1..P-3; every objection closed except O-6 (waiver awaiting operator acknowledgement).
- Open Risks carried to design.md: DO rolling-deploy overlap; shared staging OTLP token; ~3,600-series budget and Python restart churn; paging semantics (follow-up `otel-env-provider-scoped-alerts`); homelab egress precondition; the O-6 waiver; Part 4 not scanning `deploy/homelab/compose.yml`; one-time relabel of DO dev Go/Node/UI series; mask ordering (O-27); `host.*` semconv namespace collision; `${VAR:?}` makes missing OTLP keys fail every homelab render (signed off).
