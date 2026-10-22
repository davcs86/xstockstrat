# Context Log: fix-marketdata-secret-exposure

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-21 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-21-marketdata-secret-exposure-defect.md` (Issues disabled).
- Source: repo-surveyor debt-radar scan `docs/repo-surveyor/debt-radar-findings.md` @ 4535695, findings **D-39**, **D-40**.
  Both re-verified on main-dev @ a053b0e and both reproduce. None excluded.
- Severity: SEV-2. Impact type: secret-disclosure. Environment: dev (main-dev) @ a053b0e. Config-only: no.
- Operator decisions (2026-10-21): grouped by service+theme from the debt-radar scan; Track C for all SEV-2 (precedent #1264); batch launched via /sdd-batch with designGate halt.
- Routed to SDD path (Track C).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..4), context.md; report sidecar `.status` (`triaged`).
- Affected services: xstockstrat-marketdata (D-39), xstockstrat-config (D-40).
- Root cause hypothesis:
  - D-39: the `%w` wrap of the `*url.Error` on the transport path. Redaction exists only on the status branch.
  - D-40: feature 224 deliberately left the marketdata grant without `peerSan`
    (`224-private-by-default-templates/implementation-spec.md:1615`, `context.md:741`).
- Line drift (scan @ 4535695 → a053b0e): none. `fmp_client.go:243`, `finnhub_client.go:118`, `:110`, `:126`,
  `fmp_client.go:254`, `marketdata_service.go:1704`, `authz.ts:110`, `:115-119` all match. Additional sites:
  - the FMP key is set at `fmp_client.go:222`;
  - a second `CodeUnavailable` `%w` wrap is at `marketdata_service.go:1760`;
  - the gap is pinned by test `services/xstockstrat-config/src/__tests__/perUserSecrets.test.ts:236` ("no SAN required"). The fix must flip it.
- Feasibility of the D-40 binding: `scripts/gen-dev-certs.sh:28`, `:50` mint the marketdata leaf with
  `DNS:xstockstrat-marketdata`, and marketdata dials config over mTLS (`internal/config/config.go:70`). Design should
  confirm that the prod leaves from `scripts/mtls-provision.sh` carry the same SAN. A mismatch would stop marketdata
  resolving credentials at boot (warn-and-start, `config.go:111-112`).
- Overlaps:
  - **241-fix-config-audit-author-spoof** (implementation-ready) edits `services/xstockstrat-config/src/grpc/authz.ts`
    (SetConfig/author paths). It scopes the SetConfig-grant `peerSan` gap out as a follow-up defect
    (`241/design.md:20`, `:167`). This feature fixes the analogous GetSecret gap. Same file, so rebase onto whichever
    lands first. Design may also choose to absorb the SetConfig follow-up.
  - **242-fix-push-untargeted-broadcast** copies `peerDnsSans` from `authz.ts` into identity. No conflict expected.
  - **263-fix-edge-owner-scope** (same 2026-10-21 batch) also names config `authz.ts` as a textual merge risk.
    Check merge-order.
  - **246-fix-fundsignal-neutral-score** cites `fmp_client.go`/`finnhub_client.go` read-only (analysis-only fix). No conflict.
- Recommended design depth: full → `/sdd-design fix-marketdata-secret-exposure` (rationale: 2 affected services,
  which is the C-0 full trigger, plus a security-sensitive authz change that needs a cert-SAN deploy check).
- Development branch: feature/fix-marketdata-secret-exposure
