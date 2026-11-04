# Context Log: fix-app-specs-omit

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-04 (/sdd-triage)

- Bug reported via defect report `docs/reports/2026-11-04-app-specs-omit-db-vpc-defect.md`: App specs omit
  DB VPC attachment and trusted source.
- Severity: SEV-2. Environment: production.
- Routed to Track C by **operator override** of T-4, which would pick Track A. The operator's rationale:
  - production is torn down by design, so nothing live is degraded;
  - the gap also threatens staging's `main-dev` deploy path;
  - verification can dispatch `prod-up` from `main-dev`.
- Created feature.md, product-spec.md, acceptance.feature (AC-1..AC-4), and context.md.
- Affected: deploy pipeline (specs, renderer, deploy/prod-up/prod-down workflows, DO docs and skill).
- Operator decisions, recorded verbatim in intent:
  - VPC ID comes from a doctl lookup, with SOPS only as a fallback.
  - Keep the public DB host.
  - prod-up and prod-down manage the trusted-source rule for the app.
- Facts gathered:
  - DO docs: the app-spec `vpc: {id: <uuid>}` field exists, and removing it detaches the app.
  - The console auto-adds trusted sources when you attach an existing cluster. `doctl apps create`
    evidently does not: the prod app was absent from the firewall list.
  - The `doctl databases list --format` columns do not include the private network UUID. The JSON
    output (`-o json`) carries the API's `private_network_uuid`.
- Recommended design depth: quick, `/sdd-design fix-app-specs-omit quick` (rationale: SEV-2, multi-file
  deploy pipeline, operator decisions already settle the main forks).
- Development branch: feature/fix-app-specs-omit

## Session 2026-11-04 (sdd-design)

- **Phase 0 Recon.** Wrote recon.md.
  - Scope: deploy pipeline only.
  - Reuse: the `db-connect.sh` firewall verbs, the `deploy.yml` exactly-one-by-name pattern, the renderer literal-placeholder fill, and stub-doctl run extraction in `sops-secrets.test.sh`.
- **Phase 1 Grilling.** 5 rounds. It was invoked `quick`, and the operator chose "Run another round" at each gate up to the cap.
- **Chosen approach.**
  - `vpc: {id: YOUR_VPC_ID}` in both specs, filled by a required, UUID-validated `--vpc-id`.
  - A new `scripts/do-db-cluster.sh lookup|trust|untrust`.
  - deploy.yml: lookup only.
  - prod-up: lookup, then idempotent trust, then one gated redeploy.
  - prod-down: delete, then best-effort untrust that never empties the list, with a step-summary remediation on failure.
  - The four manual render sites and the P6 render site in the docs/skill are updated or pointed at the workflows.
- **Rejected:** a literal UUID, the SOPS key (YAGNI), a composite action, doctl calls inside the renderer, untrust before delete, manual race remediation, trust in deploy.yml.
- **Constitution rules touched:** F-02/03/04/05, C-15/16/18, P-01/02/06. No Floor breaches.
- **Operator confirmed** proceeding although the Track C product spec skipped /sdd-review (status was `draft`).
- **Status:** draft → design-approved.
- **Open threads:**
  - Operator pre-merge check: DO token has database read+update scope.
  - The first staging deploy after merge is the `vpc:` canary.
  - Operator verification: run prod-up, confirm `db-migrator` connects, then run prod-down.
