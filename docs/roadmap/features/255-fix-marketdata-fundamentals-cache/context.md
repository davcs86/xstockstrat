# Context Log: fix-marketdata-fundamentals-cache

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-21 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-21-marketdata-fundamentals-cache-defect.md` (Issues disabled).
- Source: repo-surveyor debt-radar scan `docs/repo-surveyor/debt-radar-findings.md` @ 4535695, findings **D-19**, **D-50**,
  **D-51**, **D-52**, **D-53**. All five re-verified on main-dev @ a053b0e and all reproduce in code. None excluded.
  D-19 is latent: no in-repo consumer of `StreamBars`/`StreamQuotes`.
- Severity: SEV-3. Impact type: stale-or-missing-fundamentals. Environment: dev (main-dev) @ a053b0e. Config-only: no.
- Operator decisions (2026-10-21): grouped by service+theme from the debt-radar scan; Track C for all SEV-2 (precedent #1264); batch launched via /sdd-batch with designGate halt.
  This group is SEV-3 but was routed Track C by the same grouping decision.
- Routed to SDD path (Track C).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..8), context.md; report sidecar `.status` (`triaged`).
- Affected services: xstockstrat-marketdata only.
- Root cause hypothesis:
  - D-50: the `cap > 0` short-circuit is missing.
  - D-51/D-52: the `source` column is read only on the edgar axis.
  - D-53: ignored errors, with no partial marker.
  - D-19: the lifetime-scoped counter, plus `time.Sleep` with no ctx.
- Line drift (scan @ 4535695 → a053b0e):
  - Unchanged: `stream.go:147-172`, `fmp_client.go:97`, `:127`, `:195`, `:198`, `marketdata_service.go:1676`, `:1688`,
    `:1734`, `:1742`, `:1850`, `:1958`, `marketdata_repo.go:548`, `:582`, `:836`, `:889`, `cmd/server/main.go:129-130`.
  - Minor drift: the D-51 SQL sits at `marketdata_repo.go:656-659` / `:669-670` (cited `:656-660` / `:669-672`), and the
    Finnhub window call at `marketdata_service.go:1935`.
- Test-design notes for /sdd-spec:
  - AC-6's "hex-garbled" input is illustrative of the `:582` hazard; refine it to whatever `extra` value actually fails the decode.
  - AC-5's "partial marker" mechanism is a design choice: a shortened TTL, a flag, or no upsert of the partial row.
- Overlaps:
  - **246-fix-fundsignal-neutral-score** (implementation-ready) reads `fmp_client.go`, `finnhub_client.go` and
    `marketdata_repo.go:537-562` only as evidence. Its fix is analysis-only. No code conflict. Its residual risk on cache rows
    with missing metrics (`246/implementation-spec.md:308`) is adjacent to D-53: a D-53 partial marker would help 246's
    absence detection. Note this in design.
  - **253-fix-edgar-companyfacts-decode** (code-completed) edits `internal/edgar/edgar_client.go` only. No conflict, but
    `marketdata_service.go` edgar-path anchors may shift if 253 merges first.
  - **254-fix-marketdata-secret-exposure** edits `fmp_client.go:243` and `finnhub_client.go:118`, the transport-error wrap.
    It is the same file as D-50/D-53 but different functions. Rebase onto whichever lands first.
  - **240-offline-account-full-pnl** (launched) touched `marketdata_service.go` (BatchGetBars), not the fundamentals path.
- Recommended design depth: quick → `/sdd-design fix-marketdata-fundamentals-cache quick` (rationale: SEV-3 and a single
  service with no proto or migration, but D-50 changes the observable semantics of config key
  `marketdata.fmp.daily_request_cap`, which is the C-0 quick trigger, and there are five D-ids with a partial-marker design fork).
- Development branch: feature/fix-marketdata-fundamentals-cache
