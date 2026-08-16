# Design: fix-fundamentals-upsert-invalid-json

**Created**: 2026-08-16
**Rounds**: 1 (quick; termination: approved)
**Approved by**: user @ 2026-08-16
**Grounded in**: recon.md

---

## Chosen Approach

Add the missing `::jsonb` cast to the `extra_metrics` bind parameter in `UpsertFundamentals`'s
INSERT text — `services/xstockstrat-marketdata/internal/repository/marketdata_repo.go:316`:

```go
// before
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, now())
// after
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16, now())
```

`extraJSON` stays `[]byte` (unchanged); the cast is purely SQL text, matching the established
repo-wide convention every sibling Python service already follows for its own jsonb binds
(`services/xstockstrat-analysis/app/repositories/strategy_scores.py:47`,
`services/xstockstrat-indicators/app/services/formulas_repository.py:63,103,179`). Confirmed via
independent re-grep (adversary round) that no other jsonb-typed column or bind exists anywhere in
the Go codebase — `extra_metrics` is the only jsonb column in the `marketdata` schema, and this is
the only Go SQL text touching a jsonb parameter platform-wide. Genuinely a one-line fix; no lint
rule or broader convention gap is warranted for a single instance (CF-N4 minimum-diff).

### Mandatory pre-merge verification gate (user-required)

The adversary round raised a blocking objection this design must resolve, not defer: recon never
captured the actual Postgres error DETAIL/CONTEXT (only SQLSTATE 22P02 + a summary), and CI has no
live-Postgres container for any Go repository-layer test — so nothing in the automated pipeline
would catch a wrong hypothesis before merge. The `::jsonb` cast is well-evidenced and symbol-agnostic
by construction (correct whether the bug is universal or UPRO-specific-for-an-unknown-reason), but
its *completeness* was unconfirmed.

User chose to require, as a mandatory (not optional) step before this fix is merged:

1. Start local `docker-compose`'s TimescaleDB.
2. Configure the test connection with `DB_PGBOUNCER=true` (matching staging/production — this
   activates `pgx.QueryExecModeExec`, per `services/xstockstrat-marketdata/internal/repository/pool.go:36-38`,
   which local dev/CI never otherwise exercises).
3. Run migration `002_fundamentals.up.sql`.
4. Call `UpsertFundamentals` against the **current (unfixed)** code with a realistic `ExtraMetrics`
   payload (including the empirically-relevant case: Finnhub's always-empty `{}`, since that's the
   default provider and recon found it never populates `ExtraMetrics` regardless of symbol —
   confirming or refuting the driver-level hypothesis independent of any UPRO-specific data shape).
5. Confirm SQLSTATE 22P02 reproduces — **capture the verbatim error DETAIL/CONTEXT for the first
   time**, closing recon's evidentiary gap.
6. Apply the `::jsonb` cast, re-run, confirm success.
7. Record the full repro (before/after, verbatim error text) in `context.md` as the fix's actual
   verification evidence — not the pgxmock test alone.

This step is required precisely because it's cheap (local Postgres is already available via
`docker-compose`) relative to the risk of closing a bug report on an unconfirmed hypothesis with no
CI gate to catch a wrong guess later.

### Testing

Two tests, both required, with an honest division of what each proves:

1. **`pgxmock` SQL-text pin** — `marketdata_repo_test.go`, asserting the emitted query contains
   `$14::jsonb`. Explicitly a "don't delete the cast" tripwire only — `pgxmock` never runs pgx's
   real extended-protocol encoder or talks to real Postgres, so it structurally cannot catch the
   actual OID-inference bug class. Named as such in the test's comment, not presented as proof of
   correctness.
2. **The mandatory manual repro above** — the test that actually exercises `QueryExecModeExec`
   against real Postgres and is the only one that would have caught this before it shipped. Not
   automated in CI (no Postgres service container exists for any Go job today —
   `.github/workflows/ci.yml`'s `go-lint` matrix confirmed to have none); run once as the required
   pre-merge verification gate above, with results recorded in `context.md`. Adding a Postgres
   service container to Go CI is named explicitly as a **separate**, optional future hardening item
   — out of scope for this SEV-3 single-column fix (CF-N4 minimum-diff) — not silently bundled in.

## Rejected Alternatives

- **Ship on the current hypothesis without a mandatory repro** — the original proposal's framing
  (manual live-DB test as "recommended follow-up"). Rejected by user: the adversary's objection that
  this could close a SEV-3 with an unconfirmed fix, with nothing in CI able to catch a wrong guess,
  was accepted as a real risk worth the small cost of running the repro before merge.
- **Add a Postgres service container to Go CI as part of this fix** — rejected as scope creep for a
  one-column SEV-3 bug; the manual repro gate above achieves the needed verification at a fraction of
  the cost. Recorded as a candidate future hardening item, not actioned here.
- **A repo-wide lint rule enforcing `::jsonb` casts on all jsonb binds** — rejected: confirmed via
  grep this is the only jsonb bind anywhere in the Go codebase; a rule for one instance is
  speculative scaffolding the task didn't ask for.

## Open Risks

- [ ] If the mandatory repro (step 5 above) does **not** reproduce SQLSTATE 22P02 against the
      current unfixed code, the driver/OID hypothesis is wrong and this design's fix does not
      address the real bug — escalate back to recon/design rather than shipping the `::jsonb` cast
      anyway. To be resolved at execute time, before the fix step is considered done.
  - [ ] Never confirmed whether the original observed failure occurred with `DB_PGBOUNCER=true`
      actually in effect — the mandatory repro (step 2) sets this explicitly, closing the gap.
  - [ ] UPRO-specificity remains formally unexplained even after this fix — the repro step tests with
      Finnhub's always-empty `{}` payload (symbol-agnostic), so it confirms/refutes the driver-level
      hypothesis but does not independently prove UPRO has no special-case behavior elsewhere. If the
      repro reproduces and resolves cleanly with the empty-payload case, this is treated as sufficient
      (the fix is correct and complete under the "incidental, not causal" reading of UPRO), per
      recon's own assessment that ExtraMetrics content doesn't meaningfully vary by symbol.

## Constitution Rules Touched

- `C-01` (evidence-cited claims) — honored: the `::jsonb` fix and "no other latent instance" claim
  are both grep-verified (independently re-confirmed by the adversary round), not assumed.
- `P-03` (no silent deviation — escalate, never guess) — honored by the mandatory repro gate: the
  previously-unconfirmed hypothesis is now required to be confirmed (or escalated) before merge,
  rather than carried forward silently.
- `P-06` (red-before-green) — honored: the mandatory repro step (4-5) IS the red state (reproduce
  the failure against unfixed code) before the fix (6, green); the `pgxmock` test alone would have
  been red-before-green in form only, not substance, per the adversary's objection.
- `F-04` (never invent) — honored: no other jsonb bind site was invented/assumed to exist; the
  "only instance" claim is grep-confirmed.
- No Floor (`F-*`) breach identified.
