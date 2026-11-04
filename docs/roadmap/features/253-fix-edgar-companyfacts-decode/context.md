# Context: fix-edgar-companyfacts-decode  (archived 2026-11-04)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

Cite convention: `old context.md@1ed63958:N` is a line of the pre-archive context.md (rewritten here); `<file>@1ed63958:N` is a line of a deleted spec (`git show 1ed63958:docs/roadmap/features/253-fix-edgar-companyfacts-decode/<file>`). Code anchors were re-checked at the archive-time tree (origin/main-dev lineage); drifted ones are marked.

## Archive Synthesis — 2026-11-04 — /sdd-archiver

**What**: SEC serves the companyfacts `cik` as a zero-padded string for some filers (CRCL `0001876042`, ELWT `0002063863`, PSKY `0002041610`, RDDT `0001713445`). The typed `companyFacts.CIK json.Number` field rejected it, so the whole document failed to decode and those symbols never stored filing history (`edgar snapshot not producible — falling back to vendor`, `reason: zero_history`). Shipped fix: the unused field was deleted from `companyFacts` (now `edgar_client.go:104-107`, only `EntityName` + `Facts`); regression test `TestFetchHistorical_DecodesCIKStringOrNumber_AC1_feature253` (`edgar_client_test.go:424`). SEV-3, marketdata only, no proto/migration/config. Found by staging fundamentals backfill job `8de93c4c-08e8-4ebf-a8cf-0d99e503ceca` (35 symbols, `docs/reports/2026-10-21-edgar-companyfacts-string-cik-defect.md:12`; ended PARTIAL, `product-spec.md@1ed63958:12`) during feature 231's post-deploy verification (old context.md@1ed63958:9-10). Integration PR #1274 -> main-dev (feature.md:21; old context.md@1ed63958:45); promoted via PR #1295 -> main, commit 38e2e104 (feature.md:9, 23).

**Why (irrecoverable rationale)**:
- Delete, don't retype. Nothing reads the field (only `tickerEntry.CIK` was read, at `:145` then, `:144` at HEAD), `encoding/json` ignores unmapped keys, and a `json.RawMessage` or string-or-number unmarshaler would be code for a value no caller uses (C-18 YAGNI). Verified with a scratch program: a `json.Number` field rejects `"0001876042"`; the struct without the field decodes both forms (implementation-spec.md@1ed63958:20-24, 76-78; old context.md@1ed63958:27-31).
- No inline comment on `companyFacts` explaining the missing `cik`: deliberate, the Step 2 regression test is what stops a typed `cik` field from coming back (implementation-spec.md@1ed63958:89). The scratch ran on Go 1.24.7 (spec) while the execute session used Go 1.27.0 (old context.md@1ed63958:47) — not a conflict, different runs. The `json.Number` error wording is Go-version-dependent (`invalid number literal, trying to unmarshal ... into Number` at implementation-spec.md@1ed63958:78 vs `...: invalid syntax` in the Go 1.27.0 RED run, old context.md@1ed63958:51), so tests must not match error text.
- No `DerivationVersion` bump (MARKETDATA-13): the period builder's output is unchanged, and the four symbols have no stored rows, so a plain re-backfill inserts them under `ON CONFLICT DO NOTHING` (implementation-spec.md@1ed63958:28-31; old context.md@1ed63958:36-37). `DerivationVersion` is `1` at `edgar_client.go:493` (spec cited `:494`; anchor drifted by 1).
- The test pre-seeds `c.cikCache["CRCL"]` (cache-hit return in `resolveCIK`) so it reuses `newTestClientCF211` (`edgar_client_test.go:238`) without a second round-tripper (DRY). The CRCL companyfacts literal stays inline in the test: single consumer, so C-13 does not require `internal/testdata/` (implementation-spec.md@1ed63958:111, 139-140). NI value 1.0e8 and filed date 2026-02-25 are illustrative; the real CRCL figure was never pulled (implementation-spec.md@1ed63958:133-134).

**Rejected alternatives**:
- Retype `CIK` as `json.RawMessage` / custom string-or-number unmarshaler — lost: dead code for an unread value (C-18) (old context.md@1ed63958:27-31).
- Also harden `tickerEntry.CIK` (`cik_str`, `edgar_client.go:100`, also `json.Number`) — deferred, not rejected on merit: SEC sends it as a number today and it is read, so a string would fail CIK resolution for every symbol at once (loud, unlike this per-filer silent gap). Left out of scope to avoid a silent change (P-03) and flagged for `/sdd-review`, which never ran (implementation-spec.md@1ed63958:49-53; old context.md@1ed63958:38-39).
- Rate-limit the `edgar snapshot not producible` WARN — explicitly out of scope; separate log-noise concern (product-spec.md@1ed63958:51). Feature 230's context also notes this WARN flood stays open after 253 (230-fix-etf-flag-fill/context.md:68-70).

**Scars & gotchas**:
- Every pre-existing test fixture sent a numeric `cik` (`edgar_client_test.go` fixtures, `ttm_roe_test.go:35` at spec time), so the string form was uncovered and only a real staging backfill exposed it (implementation-spec.md@1ed63958:114). RED evidence: `cik_string` failed with `companyfacts CRCL: json: cannot unmarshal string "0001876042" into Go value of type json.Number: invalid syntax`, identical to the staging error; `cik_number` passed pre- and post-fix (old context.md@1ed63958:50-52).
- Test written and run BEFORE the fix (TDD gate); `cik_number` row is a guard, not a RED row (old context.md@1ed63958:50, 56; implementation-spec.md@1ed63958:41-42, 116).
- Gate evidence at execute: full suite `-race` ok, coverage total 71.0% (>= 40), golangci-lint 0 issues, `TestDerivationVersion_GoldenDriftGuard_feature223` PASS (old context.md@1ed63958:53-54).

**Permanent deviations — process/gate deviations only (no design.md existed; no shipped-vs-design divergence possible)**:
- No design.md/recon.md ever existed: `/sdd-design` skipped on triage's `skip` recommendation (bug-triage Track C); the delete-vs-retype choice is recorded only here (implementation-spec.md@1ed63958:22-24).
- Unrecorded-waiver gates: `/sdd-review product-spec` never ran (status was still `draft` at `/sdd-spec`); `/sdd-review impl-spec` was not run — operator asked to proceed straight through a 2-step SEV-3 (old context.md@1ed63958:24-26, 46). Sequential mode was entered on a bare operator "go ahead" taken as the up-front confirmation (old context.md@1ed63958:44).
- Branch: feature.md names `feature/fix-edgar-companyfacts-decode` but work landed on harness branch `ccr-9f55a8ac-dtw4iv` (PR #1274 is the integration PR), as for feature 231 (old context.md@1ed63958:44-45).
- `acceptance.feature` `@AC-1` carries no `@FR-N` tag and the product spec has no FR list — a triage-template artifact `/sdd-review` might flag under C-15; the promoted suite likewise has no @FR (old context.md@1ed63958:40-41).
- Feature number 253: 241-252 were already claimed by other branches' feature dirs at triage time (max+1 across `origin/*`, old context.md@1ed63958:17) — a local max+1, which `docs/runbooks/feature-workflow.md:109` now forbids in favor of the allocator (inference: whether the allocator existed at the time is not stated).

**Cross-feature signal**:
- Surfaced by feature 231's post-deploy staging backfill; same family as the EDGAR derivation defects 222 (quarterly ROE) and 223 (stored D/E / `DerivationVersion`) — 222 and 223 were also first observed on staging SEC data (`docs/reports/2026-10-06-edgar-quarterly-roe-not-annualized-defect.md:6,12`; `docs/reports/2026-10-06-edgar-stored-de-predates-financial-debt-defect.md:6,12`). Feature 230 cites 253 as reducing, not removing, the `zero_history` flood.

**Deferred follow-ons**:
- Post-deploy re-run of the fundamentals backfill for CRCL, ELWT, PSKY, RDDT (expect `SUCCEEDED`, no `failed_symbols`) — no session in the repo records it having been done. AARD also failed the 2026-10-21 watchlist backfill (`aa5804de`), cause unconfirmed, to be included in the re-run (old context.md@1ed63958:68-69; feature.md Next Action). Treat as unverified.
- `tickerEntry.CIK` (`cik_str`) remains `json.Number` (see Rejected alternatives).
- Rate-limiting the `edgar snapshot not producible` WARN remains open.
- Defect report `docs/reports/2026-10-21-edgar-companyfacts-string-cik-defect.md` (sidecar `triaged`, `ref: feature:253-fix-edgar-companyfacts-decode`) is still on disk; its fix feature is launched, so it is prunable by `/sdd-archiver reports`. The promoted suite header text still points at it.

**Ledger entries written**: insights.md (0), fails.md (1) — see the 2026-11-04 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: MARKETDATA candidate: "Vendor decode structs declare only fields the code reads; an unread typed field is a latent whole-document decode failure when the vendor changes a JSON type" — `services/xstockstrat-marketdata/internal/edgar/edgar_client.go:99-107` (`tickerEntry` still has a read `json.Number`); regression guard is the `@feature-253` test. Borderline; inference, not stated in the old context (grounded in implementation-spec.md@1ed63958:20-23, 89).
**Pruned artifacts**: product-spec.md, implementation-spec.md — last present at 1ed63958 (no recon.md, no design.md existed).
