# Context: flatten-homelab-app-env  (archived 2026-11-10)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-11-10 — /sdd-archiver

**What**: Feature 286's free-form `homelab.app_env` map is gone.
- Its three values (`DB_PASSWORD`, `APP_URL`, `SEED_USER_ID`) are now required flat `homelab` rows in `KEYS`.
- Each one falls back to a GitHub environment secret of the same name.
- `keys_for(target)` is the single merged view.

A general namespace-precedence rule shipped alongside: a target's own namespace beats `common`. The operator asked for it mid-design, and no override row uses it yet. The exported `APP_ENV` dotenv blob is unchanged, so `homelab-release-env.sh` and feature 279's scenarios still hold (`scripts/sops_secrets.py` `keys_for`).

**Why (irrecoverable rationale)**:
- **No escape hatch, no blob fallback (operator calls).** No migration was needed.
  - Checked in the repo at origin/main-dev ab8a9ce: neither `secrets/staging.enc.yaml` nor `secrets/production.enc.yaml` had a `homelab` section (key names are plaintext).
  - That no `APP_ENV` GitHub secret exists is operator-asserted only, on the grounds that homelab had never deployed.
- **`APP_ENV` stays one exported blob.** This was the agent's default; the operator was never asked. It keeps `scripts/homelab-release-env.sh`, the render tests and the 279 `APP_ENV` scenarios valid without edits.
- **Overrides exist because of the operator's framing:** "the SOPS file has namespaces; there are no name collisions, only overrides". For that reason 286's "`homelab.app_env` must not contain common key" guard was dropped rather than ported (286 @AC-23 superseded).
- **`required` is the OR of the merged rows.** An override can never make a required `common` key optional. An empty override falls through to `common`, like any empty stored value.
- **`keys_for` reads `KEYS` at call time,** and nothing derived from `KEYS` is computed at import. The test-side `T_KEYS_EXTRA` prelude patches `s.KEYS` to inject override rows that do not ship. An import-time cache would make that patch silently do nothing (`scripts/sops-secrets.test.sh` prelude).
- **VM `.env` = every resolved homelab key except the CI-only `HOMELAB_EXPORTS`.** This exclusion model was the operator's choice, with the silent-ship risk accepted. The mitigation is a reviewed literal list in the tests.
- **Every decrypted leaf is masked,** in all namespaces, undeclared keys included. That also masks other targets' values (4+ characters) in a run's logs, which was accepted. It is needed so an undeclared `homelab.<common name>` value never leaks (AC-15).

**C-16 classification (design gate, operator, 2026-11-07)**: platform.feature's supersession block cites "302 context.md and design.md"; the design.md half is recorded here.
- **CHANGE:**
  - 286 @AC-5 (Given).
  - 286 @AC-12 (last Then; the summary Then was added at the feature-end checkpoint).
  - 286 @AC-23: superseded, but its "no value in the log" clause is kept.
  - 286 @AC-20 (wording).
- **EXTEND:** 279 @AC-2. The resolver now fails earlier, naming the key, alongside the existing compose failure.
- **PRESERVE:** 286 @AC-13/2/18/14/24, DO @AC-8/9/10, and 279 @AC-4/8/9/16/22/28/31/32, because `APP_ENV` stays an opaque blob.

**Rejected alternatives**:
- **Free-form `app_env` map, or any escape hatch:** the operator rejected it.
- **Building the VM `.env` from the names `compose.yml` references (like DO placeholders):** the operator chose the exclusion model.
- **An explicit `HOMELAB_ENV` tuple plus a partition assertion:** the operator chose exclusion; the literal-list test is the tripwire.
- **"Subset of common targets" and `required >=` guards:** namespaces are independent and overlap only partially, and `required` is an OR, so these guards would reject valid tables.
- **Keeping the raw `keys_for` plus a second `_merged` view:** two views would drift apart.
- **Seeding only into `common` in `cmd_build`:** speculative while no override ships (C-18).
- **Failing on duplicate names across namespaces:** contradicts FR-7.

**Scars & gotchas**:
- **Sandbox toolchain.**
  - `sops` was missing at spec time. At execute it was sops 3.13.3, as a pinned binary.
  - The `yq` (mikefarah v4.44.3) binary download was refused, so it was built with `go install`.
  - shellcheck and shfmt came from pip (`shellcheck-py`, `shfmt-py`).
  - `docker compose config` works with the daemon down.
- **The trailing `grep -nE 'LEGACY_APP_ENV|secrets\.APP_ENV'` exits 1 on a clean tree.** Use it with `if` or `||`; never chain it under `set -e`.
- **Table-check cases must run via `cli`, not `lib`.** `main()` catches `SecretError`, so the new KEYS-table check messages only surface through the CLI path.
- **The real `__main__` entry is not covered by tests.** `cli` now goes through the `python3 -c` patch wrapper, so only ruff and the live workflow exercise it. Case 8 no longer covers an app map that carries `DB_HOST`; `scripts/homelab-render.test.sh` still does.
- **Anti-vacuity proof:** flipping the precedence in `keys_for` makes case 14 fail (`JWT_SECRET label is 'sops'`).
- **Branch-topology trap.**
  - No `feature/flatten-homelab-app-env` branch ever existed, although `feature.md` names it as the Development Branch.
  - The work lived on the harness branch `ccr-9bdbcd90-kgj5ev`, and the integration PR targeted main-dev.
  - Tree freshness had to be checked against that branch, because switching to main-dev would have removed the feature directory.

**Permanent deviations**:
- **`no_unprefixed` skip.**
  - Design: `no_unprefixed` skips the lines `check_legacy` owns (the `LEGACY_*:` lines).
  - Shipped: the skip was written, then removed.
  - Because: the three new `secrets.*` names do not match `COMMON_RE`, so it was dead code (C-18, flagged at impl-spec review).
  - Do not re-add it unless an override row actually produces a line that `COMMON_RE` matches.
- **286 @AC-12 supersession.**
  - Design: only 286 @AC-12's last Then (`APP_URL from homelab.app_env`) is a CHANGE.
  - Shipped: the promotion supersedes both the summary Then and the last Then.
  - Because: operator choice at the feature-end checkpoint. The step summary now lists three flat keys instead of one APP_ENV entry.

**Cross-feature signal**:
- **Same arc as feature 286, launched days earlier.** A free-form escape-hatch map was replaced by named, table-driven rows. A map is not individually required, has no per-key legacy fallback or summary line, and needs its own parser and collision guard. Lesson: a one-off map inside a table-driven config costs a follow-up feature.
- **Feature 297 depends on `KEYS` staying the deploy-secret source of truth.**
- **Quick design depth was kept against advice.** Review recommended full depth because of the overlap with promoted 286/279 scenarios, and escalation was offered again after recon (three 286 CHANGEs). The operator kept quick, and a mid-design FR-7 scope amendment then forced a product-spec re-review and stretched quick to five rounds.
- **A feature can ship on a harness `ccr-*` branch with no `feature/<slug>`.** The SDD artifacts still assume the slug branch, so every phase had to re-explain the base.

**Deferred follow-ons**:
- **First `digitalocean` override row.** `expected_legacy` deliberately raises (there is no DO `LEGACY_*` convention), and `cmd_build` would seed both namespaces at bootstrap. Revisit both at the first DO override.
- **Preflight before the first homelab deploy (unverified, operator-asserted).** `gh secret list --env staging` and `--env production` must not list `APP_ENV`; delete it if present.
- **Sibling repo runbooks.** homelab-edge `deploy-compose-app.md` and `home-side.md` still describe the 1Password / `APP_ENV` layout. This is a separate follow-up there.
- **A string-valued stale `homelab.app_env` is ignored, not refused** (accepted scope, FR-5). Only a map-valued one is refused.
- **Unknown or misspelled keys under `homelab` are still undetected.** An undeclared `homelab.<common name>` is silently not an override.
- **Pre-existing, unrelated finding.** `check-config-wiring.mjs --final` reports `trading.fill_poller.interval_ms` read-unseeded.

**Ledger entries written**: insights.md (3), fails.md (2) — see the 2026-11-10 entries.

**Runtime-invariant recommendations (→ /context-constitution)**:
- **PLAT deploy tooling.** The call-time read is not documented. The exclusion model is only partly documented: runbook `docs/runbooks/sops-secrets.md` states it, but not the literal-list tripwire.
  - `KEYS` in `scripts/sops_secrets.py` is the only deploy-secret layout source.
  - A target's own namespace overrides `common` only for names declared under both.
  - An undeclared `homelab.<common name>` is silently ignored, but still masked.
  - Homelab `APP_ENV` = resolved homelab keys minus `HOMELAB_EXPORTS` (the exclusion model).
  - `keys_for` must read `KEYS` at call time.

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 2d91b5671335fcce267679b50caa494440205f51.

## Retained verbatim records

Operator decisions and C-16 sign-offs copied verbatim from the pre-archive session log, because durable suites and later features cite "<NNN> context.md" as their provenance. Headings are demoted one level.

_From: Session 2026-11-07T00:42:31Z — sdd-design_

- C-16 CHANGE sign-off (operator, approving the design at the gate on 2026-11-07): 286 @AC-5 (Given), @AC-12 (last Then), @AC-23 (superseded; collision guard dropped), @AC-20 (wording). Supersession is written at promotion only (AC-12).

_From: Session 2026-11-07 — sdd-spec_

- Flags for `/sdd-review impl-spec`: AC-12 has no step by design (promotion time, C-16); AC-10 is covered by the docs Step 5 rather than a test step; FR-7 corners (required OR, empty override, `differs from legacy` label, table check) have no dedicated `@AC-*`, so they trace to FR-7 only.
