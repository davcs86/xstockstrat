# Smoke verification needs — read-only vs write, and which identity — 2026-10-30

Evidence for the staging smoke-check design (`docs/superpowers/specs/2026-10-29-staging-smoke-checks-design.md`):
how much of what features specify can be verified on a deployed environment with reads only, and which
caller identity the verifying calls need. Point-in-time; reproducible from the method below.

## Method

- **Corpus:** every Gherkin scenario in `services/*/acceptance/*.feature`, `docs/sdd/business-rules/*.feature`
  and `docs/roadmap/features/*/acceptance.feature`, deduplicated on `(feature, @AC, title)` (888 duplicates of
  promoted scenarios removed) → 1,236 scenarios: 880 launched, 329 unlaunched, 27 abandoned (excluded).
  A further 113 features without scenarios (107 launched, 6 unlaunched) were classified per feature from
  their `context.md` archive synthesis.
- **Classification (LLM, shared rubric):** mode — `N0` not live-verifiable (mocks, error text, offline renders),
  `R1` read-only, `W2` scoped write (disposable fixture owned by a test identity), `W3` platform-wide or
  privileged write; identity — `I0` none, `I1` one ordinary user, `I2` system/non-user actor, `I3` admin,
  `I4` two or more ordinary users; plus whether `R1` depends on pre-existing seed data.
- **Counting:** by script from validated TSVs, never from model-reported tallies.
- **Reliability:** 120 stratified scenarios were re-rated blind by two independent raters. First pass vs
  blind: 76% exact mode agreement (κ 0.67), 88% live/not-live, 86% R1-vs-write, 81% identity. Blind rater vs
  blind rater on 15 shared items: κ 0.72. The second raters leaned toward needing writes, so figures are
  given as first pass → reweighted by the observed disagreement.

## Results (launched + unlaunched, 1,209 scenarios)

| Mode | First pass | Reweighted |
|---|---|---|
| Not live-verifiable | 680 (56%) | 50% |
| Read-only (R1) | 181 (15%) | 13% |
| Scoped write (W2) | 224 (19%) | 22% |
| Platform/privileged write (W3) | 124 (10%) | 15% |

- Of live-verifiable scenarios (529 first pass): read-only 34% → 26%; scoped write 42% → 44%; platform or
  privileged write 23% → 30%. Launched features: read-only 36% (161/447); unlaunched: 24% (20/82).
- Of 98 features with at least one live-verifiable scenario, 18 (18%) are fully read-only verifiable; 38 top
  out at scoped writes and 42 at platform/privileged writes.
- 49% of the read-only scenarios (89/181) depend on pre-existing representative data.
- Identity among live-verifiable scenarios: none 20%, one ordinary user 49%, system 8%, admin 17%, multi-user
  6%. Among read-only scenarios: none 48%, one ordinary user 43%, system 3% (5/181), admin 7% (12/181).
- System-identity scenarios (42): 25 platform/privileged writes, 12 scoped writes, 5 read-only; they concern a
  specific peer service's identity (notify, marketdata) or background producers/loops, not a generic user.
- Admin read-only scenarios (12): `ListUsers`/`GetUser`/profile metadata, config-ui namespace lists, agent
  tool listing.
- 107 launched features without scenarios: of 85 with live behavior, 29% read-only; identity one ordinary
  user 52%, admin 24%, system 4%.

## Caveats

- Acceptance scenarios include many error and edge paths; a smoke probe is thinner. Write needs here are an
  upper bound for smoke. A liveness probe for a write-heavy feature may still be read-only (not measured).
- The unlaunched corpus is small (329 scenarios); five of its six scenario-less features were classified from
  headers at low confidence.
- Classification is model judgement; the batch whose classifier read truncated scenarios flipped 3 of 18
  N0 rows on re-rating, within normal disagreement.

## Decisions this supported

No system identity and no admin identity in v1; one dedicated non-admin smoke user; a scoped-write phase
immediately after the read-only phase; platform/privileged writes stay out of smoke scope.
