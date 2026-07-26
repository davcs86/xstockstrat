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
convenience copy and will drift. Also keep in mind the caveat in the
[Version caveats](#version-caveats) section.

## Prerequisites on the host

- **Go** (per root `CLAUDE.md` §Language Versions — 1.25) — needed both to build stubs and to
  `go install` the plugins and `buf`.
- **Node.js 22** + **pnpm 9.15.0** — for the TypeScript plugins and to compile the TS package.
- **Python 3.12** + `pip` — for `grpcio-tools`.

## Steps

### 1. Install `buf`

`Dockerfile.codegen` downloads the `buf` release binary from GitHub releases. **Try that first** —
egress is not always blocked, and it is the same binary the container uses:

```bash
curl -fsSL "https://github.com/bufbuild/buf/releases/latest/download/buf-Linux-x86_64" \
  -o "$(go env GOPATH)/bin/buf" && chmod +x "$(go env GOPATH)/bin/buf"
```

If that 403s or times out, fall back to the Go module proxy — `proxy.golang.org` is typically
allowlisted:

```bash
go install github.com/bufbuild/buf/cmd/buf@latest
```

This lands `buf` in `$(go env GOPATH)/bin` (usually `~/go/bin`), which `buf-gen.sh` already adds
to `PATH`.

### 2. Install the Go proto plugins

Match the pins in `Dockerfile.codegen` (§"Go proto plugins"). They install into `~/go/bin`:

```bash
go install google.golang.org/protobuf/cmd/protoc-gen-go@v1.36.11
go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@v1.6.2
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

### 4b. Install the TS package's own dependencies

`buf-gen.sh`'s final step compiles `gen/ts` to `gen/ts/dist/` with `tsc`, and **`dist/` is
committed** (48 tracked files), so this step is not optional — skipping it leaves the compiled
output stale and fails the `proto-freshness` CI gate. It needs the package's own `node_modules`:

```bash
cd packages/proto/gen/ts && pnpm install
```

Without it, `pnpm build` falls back to whatever global `tsc` is on PATH. A newer global
TypeScript fails with `TS5107: Option 'moduleResolution=node10' is deprecated`, which looks like
a repo misconfiguration but is really just the wrong compiler — the package pins
`typescript ^5.4.5`.

### 5. Validate against the committed stubs (do this BEFORE any proto edit)

> **Create a local `main-dev` ref first, or the breaking check silently no-ops.** `buf-gen.sh`
> guards its `buf breaking` step with `git show-ref --verify refs/heads/main-dev`, which tests for
> a **local branch**. On a fresh clone that only has `origin/main-dev`, the guard fails and the
> whole breaking check is skipped **without any warning** — you get a green run that never
> compared anything. Fix it before relying on the result:
>
> ```bash
> git branch -f main-dev origin/main-dev
> ```
>
> A correct run prints `==> buf breaking (against main-dev)`. If that line is absent, the check
> did not run.

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

- **`protoc-gen-go-grpc` pin history.** As of feature 064, `Dockerfile.codegen` pinned
  `protoc-gen-go-grpc@v1.6.1` while the committed stubs were generated with `v1.6.2`, producing a
  non-empty stub diff on a from-scratch host install. That pin has since been corrected to
  `v1.6.2` in `Dockerfile.codegen` so the Docker path and this host runbook now agree — Step 2
  above already reflects the fixed pin. If a future `buf-gen.sh` run against a fresh Dockerfile.codegen
  produces a non-empty diff again, treat it as a new drift: bisect by plugin and update the stale
  pin, don't just re-add a workaround note here.
- **Exact patch versions matter.** A mismatched patch on any plugin surfaces as a non-empty
  generated-stub diff. Treat the Step 5 empty-diff check as the acceptance gate; when it fails,
  bisect by plugin.

## References

- `Dockerfile.codegen` — authoritative version pins (re-read at task time)
- `scripts/buf-gen.sh` — the codegen entrypoint validated in Step 5
- `scripts/localenv-setup.sh` — the normal Docker-based path this runbook substitutes for
- `docs/runbooks/proto-versioning.md` — proto change / BSR workflow once the toolchain is ready
- `docs/roadmap/ledger/insights.md` (2026-07-09 `backtest-debug-info — ordering`) — origin note
