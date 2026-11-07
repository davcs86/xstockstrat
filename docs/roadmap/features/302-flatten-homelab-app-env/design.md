# Design: flatten-homelab-app-env

**Created**: 2026-11-07
**Rounds**: 5 (quick, extended at the operator's request; termination: approved at the cap)
**Approved by**: user @ 2026-11-07
**Grounded in**: recon.md

---

## Chosen Approach

The `KEYS` table stays the only layout source and `keys_for(target)` becomes the single merged view; nothing derived from `KEYS` is computed at import time (recon: `scripts/sops_secrets.py:22-76`).

**sops_secrets.py**
- KEYS (`:39`): replace the `app_env` row with homelab `DB_PASSWORD`, `APP_URL`, `SEED_USER_ID` (required, target homelab, that order).
- `OWN = {DO: "digitalocean", HOMELAB: "homelab"}`. `keys_for(target)` reads `KEYS` at call time and returns `[(name, required, namespaces)]`: rows that target `target`, merged by name in first-appearance order (an overridden name keeps its `common` slot), `required` = OR of the merged rows, namespaces listed own-first then `common`. Before filtering it validates the unfiltered table: a non-common row must target exactly its own namespace's target, and no namespace may declare a name twice (`SecretError` naming the key).
- `legacy_name(n) = "LEGACY_" + n`; `legacy_names` dedupes via the merged view.
- `resolve`: masks every decrypted string leaf, then every `LEGACY_<name>`, before any output. The winner is the first namespace, own then `common` (never table order), with a non-empty value; an empty override falls through. Label: `sops`; `sops (<ns>)` only when a non-common namespace beat a declared `common` row; `; differs from legacy` appended inside the parentheses (or `sops (differs from legacy)` unchanged for others). An undeclared `homelab.<common name>` is never in the namespace list, so it is ignored (AC-15).
- Delete: `COMMON`, `HOMELAB_TAIL`, `VAR_NAME`, `LEGACY_COMMON_LINE`, `_strings`, the `_sha` dict branch, the `app_env` branch of `decrypt` (the generic leaf check yields `homelab.app_env must be a string`), `homelab_app_env`, the `app_env` loop in `cmd_resolve`, `_quoted`'s `label` parameter.
- `_quoted`: quote/newline refusal first (wording unchanged), then the new `{key}: value contains the reserved heredoc delimiter`. `write_github_env` keeps its check for direct exports.
- `cmd_resolve`: `APP_ENV` = merged `keys_for(HOMELAB)` names present in `values` and not in `HOMELAB_EXPORTS` (the CI-only set: `TS_AUTHKEY`, `TS_AUTHKEY_EXPIRES`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`, `MTLS_CA`), names without a `common` namespace first, then those with one, each in KEYS order, each through `_quoted` before `write_github_env` opens the file. `cmd_build` and `SEEDED` are unchanged.

**Other files (step 1, atomic with the code):** `scripts/do-render-app-spec.py:99-103` filter becomes `"common" in nss and n != "MTLS_CA"`; `deploy-homelab.yml:106` `LEGACY_APP_ENV` becomes `LEGACY_DB_PASSWORD`/`LEGACY_APP_URL`/`LEGACY_SEED_USER_ID` from the same-named secrets.

**Tests (`scripts/sops-secrets.test.sh`):** a test-side `T_KEYS_EXTRA` prelude patches `s.KEYS` (never read by `sops_secrets.py`); `cli` runs through `python3 -c`. Cases 7-11 rewritten on flat keys with the hostile values `p$w #1 "x"` / `j$t`, exact-blob equality for AC-2, exact messages for AC-4/6/7/11, `[ ! -s ghenv ]` for the empty-file checks; new cases for AC-13 (incl. `JWT_SECRET` before `BROKER_ACCOUNTS_ENCRYPTION_KEY`, empty override, differs-from-legacy label), AC-15 (`only_masked sg-homelab`), AC-16, `required` OR, and the table check (wrong namespace, duplicate). `expected_legacy` derives from the merged view (a homelab-own name expects plain `secrets.<K>`; a multi-namespace DO name raises until a DO convention is agreed); `no_unprefixed` skips the lines `check_legacy` owns; build case 1 probes the real `LEGACY_DB_PASSWORD/APP_URL/SEED_USER_ID` names. A reviewed literal list of homelab-own names in `keys_for` order guards the exclusion model.

**Steps:** (1) tests RED, then code + renderer + workflow GREEN in one atomic PR step; (2) `docs/runbooks/sops-secrets.md` (AC-10 greps live here) and the `homelab-render.test.sh` comment. Promotion (AC-12) is separate.

**Consumer surface:** none (operator-facing deploy tooling).

## Rejected Alternatives

- Free-form `app_env` map or any escape hatch — rejected by the operator.
- Deriving the VM `.env` body from `compose.yml` references (mimic DO placeholders) — operator chose the exclusion model.
- Explicit `HOMELAB_ENV` tuple + partition assertion — operator chose exclusion; a literal list test is the tripwire.
- Subset-of-common-targets and `required >=` guards — namespaces are independent and overlap partially; `required` is an OR.
- Keeping raw `keys_for` plus a second `_merged` view — drifts; one merged view.
- Seeding only into `common` in `cmd_build` — speculative while no override ships.
- Failing on duplicate names across namespaces (no precedence) — contradicts FR-7.

## Open Risks

- [ ] Exclusion model: a future deploy-only homelab key missing from `HOMELAB_EXPORTS` ships to the VM `.env` — tripwire: the reviewed literal list in `group_homelab` (step 1).
- [ ] A future `digitalocean` override seeds both namespaces at bootstrap; `expected_legacy` raises loudly, but `cmd_build` must be revisited — at the first DO override.
- [ ] Unverified, operator-asserted: no `APP_ENV` GitHub environment secret exists — preflight before the first homelab deploy; the runbook lists it as deletable.
- [ ] Masking every decrypted leaf also masks other targets' values of 4+ characters in a run's logs — accepted.
- [ ] An undeclared `homelab.<common name>` is silently not an override — stated in the runbook (step 2).
- [ ] Case 8 no longer covers an app map carrying `DB_HOST`; `scripts/homelab-render.test.sh` still covers it.
- [ ] The real `__main__` entry is exercised only by ruff and the workflow, since `cli` runs through the patch wrapper.
- [ ] Sibling repo runbooks (homelab-edge) still describe the 1Password/`APP_ENV` layout — separate follow-up.

## Constitution Rules Touched

- `C-11` — honored: SDD story and quick design before code.
- `C-15` — honored: scenarios AC-1..AC-16 trace to the cases above; FR-7 text aligned with `required` OR.
- `C-16` — honored: three CHANGEs signed off (below); supersession recorded at promotion only.
- `C-18` — honored: dead code deleted, speculative seeding change dropped.
- `F-05`/`P-06` — honored: code, renderer, tests and workflow land in one green step.
- `F-11` — no unresolved Floor breach.

## Business Rules Touched (C-16)

- CHANGE `@AC-5 @feature-286` "The homelab APP_ENV is rendered so compose reads every value literally" (`platform.feature:901`) — Given re-expressed over flat keys; signed off by user @ 2026-11-07 (context.md).
- CHANGE `@AC-12 @feature-286` "Homelab deploy no longer touches 1Password" (`:952`, last Then `:959`) — APP_URL now from `homelab.APP_URL`; signed off by user @ 2026-11-07.
- CHANGE `@AC-23 @feature-286` "Homelab app_env may not carry a common key" (`:1014`) — superseded (no collisions, only overrides); "no value in the log" kept; signed off by user @ 2026-11-07.
- CHANGE (wording) `@AC-20 @feature-286` (`:895`) — Given mentions `APP_ENV`; listed as superseded by FR-6.
- EXTEND `@AC-2 @feature-279` (`:1072`) — resolver fails earlier, naming the key.
- PRESERVE `@AC-13/@AC-2/@AC-18/@AC-14/@AC-24 @feature-286`, DO `@AC-8/9/10`, and `@feature-279` `@AC-4,8,9,16,22,28,31,32` (`APP_ENV` stays an opaque blob).
