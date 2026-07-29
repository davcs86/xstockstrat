# Context Log: fix-config-value-roundtrip

Append-only. Each session appends a new ## Session entry.

---

## Session 2026-07-29 — triage (split out of feature 073's review)

- Both defects were surfaced by `/sdd-review 073 product-spec` and then **confirmed directly in the
  code** this session (not taken on the reviewer's word).
- Split into their own bug feature rather than bundled into 073, following the precedent set when
  074 (`fix-config-write-authz`) was split out of 073's FR-7 for the same reason: they are
  pre-existing defects, independent of whether 073 ever ships, and 073 is merely the first consumer
  to depend on them being correct.
- Severity SEV-2, not SEV-1: defect 1 corrupts config values written through the UI (data
  correctness, no trading halt); defect 2 is latent — it has no consumer today because `/config-ui`
  happens to read `isSecret` from `ListKeys` instead of the snapshot.
- Relationship to 073: **073's FR-1 redaction cannot be implemented correctly until defect 2 is
  fixed.** 073 must consume this fix, not reimplement it.
