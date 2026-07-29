# QA reference — Go

Services: `xstockstrat-trading`, `xstockstrat-portfolio`, `xstockstrat-marketdata`.
Load this file only when the target is one of them.

## Layout

Framework is the standard library's `testing` — no testify, no mocking library. A test lives
**beside its source** as `<name>_test.go` in the same package. Table-driven with `t.Run(name, …)`
subtests is the house style; follow whatever the neighbouring `_test.go` already does.

Existing tests to imitate: `internal/config/config_test.go`,
`internal/broker/{alpaca,ibkr}_test.go`, `internal/service/trading_{helpers,sync}_test.go`.

## Commands

`GOWORK=off` is mandatory — the repo has a `go.work` at root and CI runs every Go job with the
workspace disabled. Without it you build against the workspace and diverge from CI.

```bash
cd services/xstockstrat-<svc>
GOWORK=off go test ./internal/<pkg>/... -run <TestName> -v -count=1   # one test, verbose
GOWORK=off go test ./... -race -count=1                                # full suite as CI runs it
GOWORK=off golangci-lint run --modules-download-mode=mod               # lint
```

`-count=1` defeats the test cache; without it a "pass" may be a replayed result, which is useless
when you are checking a RED assertion.

## The coverage trap

CI does **not** measure every package. `.github/workflows/ci.yml:241` builds the covered set by
exclusion:

```bash
COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | ...)
```

So `cmd`, `handler`, `repository`, `telemetry`, and **`service`** are outside the threshold check.
A new test in `internal/service/` is worth writing — it just **will not move the coverage number**.
Say so explicitly rather than promising a delta that cannot materialize. The packages that do count
are the pure-logic ones: `internal/config`, `internal/broker`.

Threshold is 40% for all three Go services; `docs/patterns/ci-overview.md` is the reference and
`.github/workflows/ci.yml` is the authority. Do not restate the number anywhere else.

```bash
GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic \
  -coverpkg="$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//')"
go tool cover -func=coverage.out
```

## Designing a case

A Go test that only asserts a struct field round-trips is a tautology. Assert the **behavior**: an
error path returns the right sentinel, a boundary value flips the branch, a computation matches a
hand-worked expectation. For a RED run, the assertion must fail because the behavior is missing —
not because the file does not compile. A compile error is not a red test; fix it and re-run.
