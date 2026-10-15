# Context Log: fix-indicators-sandbox-matrix

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-15 (/sdd-triage)

- Bug recorded as `docs/reports/2026-10-15-indicators-sandbox-blas-memory-flake-defect.md` (Issues disabled). Found while driving PR #1247, whose indicators job went red on code it
  does not touch.
- Severity: SEV-3. Routed to SDD path (Track C).
- Created: feature.md, product-spec.md, acceptance.feature (regression scenarios), context.md.
- Affected services: xstockstrat-indicators.
- Root cause hypothesis: the sandbox child sits at its 128 MiB `RLIMIT_DATA` cap, and headroom is host-dependent
  (likely OpenBLAS's runtime kernel/buffer selection). Not a #1246 regression: identical tree b5a7ca59 both
  passed and failed. #1246's "attempt 2 pass" was a copied job that never executed.
- Production exposure: latent. User formulas run under the same 128 MiB default.
- Feature number: 228. 226 is on main-dev; 227 is held by open PR #1247 (`fix-opportunities-read-hangs`).
- Recommended design depth: quick → `/sdd-design fix-indicators-sandbox-matrix quick`. Rationale: SEV-3 and a single service, but the root
  cause is not yet confirmed and a config-default change is a candidate fix.
- Development branch: feature/fix-indicators-sandbox-matrix.
