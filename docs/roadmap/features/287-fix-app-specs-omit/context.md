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
