# Runbook — Provision the codegen toolchain on a bare host (no Docker)

**Trigger:** You need to run `./scripts/buf-gen.sh` (regenerate proto stubs) but the normal
Docker path (`scripts/localenv-setup.sh` → `Dockerfile.codegen`) is unavailable — e.g. Docker
isn't installed in the execution environment, or GitHub-releases egress is blocked so `buf`
can't be fetched from its release binary.

This runbook reproduces the pinned toolchain from `Dockerfile.codegen` **directly on the host**,
then validates that codegen reproduces the committed stubs **byte-for-byte before you edit any
`.proto`**. Doing this validation first means any later, non-empty `git diff` on the generated
stubs is caused by *your* proto change, not by a toolchain drift.

> **Exceptions (provisioned separately, not covered here):** Docker itself and Postgres. When a
> step needs a database (e.g. verifying a migration up/down), run Postgres ad-hoc with
> `docker run postgres:16` — this runbook covers only the proto/codegen tools.

## Authoritative version source

**`Dockerfile.codegen` is the source of truth for every version pin.** Always re-read it at task
time and match its values — do **not** trust the snapshot versions below blindly; they are a
convenience copy and will drift. Also keep in mind the two known caveats in the
[Version caveats](#version-caveats) section.

## Prerequisites on the host

- **Go** (per root `CLAUDE.md` §Language Versions — 1.25) — needed both to build stubs and to
  `go install` the plugins and `buf`.
- **Node.js 22** + **pnpm 9.15.0** — for the TypeScript plugins and to compile the TS package.
- **Python 3.12** + `pip` — for `grpcio-tools`.

## Steps

### 1. Install `buf` via the Go module proxy (egress-safe)

`Dockerfile.codegen` downloads the `buf` release binary from GitHub releases. When
GitHub-releases egress is blocked (the download 403s), install `buf` from the Go module proxy
instead — `proxy.golang.org` is typically allowlisted:

```bash
go install github.com/bufbuild/buf/cmd/buf@latest
```

This lands `buf` in `$(go env GOPATH)/bin` (usually `~/go/bin`), which `buf-gen.sh` already adds
to `PATH`.

### 2. Install the Go proto plugins

Match the pins in `Dockerfile.codegen` (§"Go proto plugins"). They install into `~/go/bin`:

```bash
go install google.golang.org/protobuf/cmd/protoc-gen-go@v1.36.11
go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@v1.6.2   # see Version caveats
go install connectrpc.com/connect/cmd/protoc-gen-connect-go@v1.19.2
```

### 3. Install the TypeScript proto plugins (global npm)

Match the pins in `Dockerfile.codegen` (§"TypeScript proto plugins"), which in turn must match
`packages/proto/gen/ts/package.json` devDependencies:

```bash
npm install -g \
  ts-proto@2.11.8 \
  @bufbuild/protoc-gen-es@2.12.0 \
  @connectrpc/protoc-gen-connect-es@1.7.0
```

### 4. Install the Python gRPC tools

```bash
python3 -m pip install grpcio-tools==1.80.0
# On Debian trixie (PEP 668) add: --break-system-packages
```

### 5. Validate against the committed stubs (do this BEFORE any proto edit)

Run codegen and confirm the working tree is unchanged — an **empty** diff proves the host
toolchain matches the one that produced the committed stubs:

```bash
./scripts/buf-gen.sh
git diff --stat packages/proto/gen/
# → must print nothing. Any output means a plugin version is off — reconcile against
#   Dockerfile.codegen (see Version caveats) before touching a single .proto.
```

Only once this diff is empty should you start editing `.proto` files. After your change, re-run
`./scripts/buf-gen.sh` and commit the regenerated stubs alongside the proto change (CI's
`proto-freshness` job enforces this).

## Version caveats

- **`protoc-gen-go-grpc` — Dockerfile says `v1.6.1`, committed stubs are from `v1.6.2`.**
  As of feature 064, installing the `v1.6.1` pin from `Dockerfile.codegen` produced a non-empty
  stub diff; the committed stubs were generated with **`v1.6.2`**. Install `v1.6.2` to reach an
  empty diff. (The Dockerfile pin is stale and should be bumped to `v1.6.2` in a separate change —
  until then, the empty-diff check in Step 5 is the real arbiter, not the Dockerfile line.)
- **Exact patch versions matter.** A mismatched patch on any plugin surfaces as a non-empty
  generated-stub diff. Treat the Step 5 empty-diff check as the acceptance gate; when it fails,
  bisect by plugin.

## References

- `Dockerfile.codegen` — authoritative version pins (re-read at task time)
- `scripts/buf-gen.sh` — the codegen entrypoint validated in Step 5
- `scripts/localenv-setup.sh` — the normal Docker-based path this runbook substitutes for
- `docs/runbooks/proto-versioning.md` — proto change / BSR workflow once the toolchain is ready
- `docs/roadmap/ledger/insights.md` (2026-07-09 `backtest-debug-info — ordering`) — origin note
