# Runbook — Provision the codegen toolchain on a bare host (no Docker)

**Trigger:** You need to run `./scripts/buf-gen.sh` (regenerate proto stubs) and the normal
Docker path (`scripts/localenv-setup.sh` → `Dockerfile.codegen`) is either not worth the setup
(you only need a single proto step) or fails in this environment — e.g. GitHub-releases egress is
blocked so `buf` can't be fetched, or the codegen build's `curl` to nodejs.org / github.com fails
TLS verification because those hosts route through the agent proxy (see [Using Docker in an
agent-proxy environment](#using-docker-in-an-agent-proxy-environment) below). In a
managed agent/execute session a Docker daemon **can** be started (`dockerd &` as root), so Docker
is not inherently unavailable — this host path is usually just the faster route for a lone step.

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
- **Node.js 24** + **pnpm 9.15.9** — for the TypeScript plugins and to compile the TS package.
- **Python 3.13** + `pip` — for `grpcio-tools`.

## Steps

### 1. Install `buf`

`Dockerfile.codegen` downloads the `buf` release binary from GitHub releases, pinned via its
`BUF_VERSION` ARG. **Try that first** — egress is not always blocked, and it is the same binary
the container uses. Match the pinned version (re-read `Dockerfile.codegen`; currently `1.72.0`):

```bash
BUF_VERSION=1.72.0
curl -fsSL "https://github.com/bufbuild/buf/releases/download/v${BUF_VERSION}/buf-Linux-x86_64" \
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

## Using Docker in an agent-proxy environment

Docker is **not** inherently unavailable in a managed agent/execute session: the daemon simply
isn't running by default. As root you can start it and it comes up in about a second:

```bash
dockerd >/tmp/dockerd.log 2>&1 &
until docker info >/dev/null 2>&1; do sleep 0.5; done   # overlayfs driver
```

The one catch is TLS. Outbound HTTPS in these sessions is re-terminated by the agent egress proxy,
which presents a cert signed by `/root/.ccr/ca-bundle.crt`. The host trusts that CA, but a fresh
build container does not — so any `curl`/`fetch` to a host **not** on the proxy's `noProxy`
allowlist fails with `curl: (60) SSL certificate problem`. `Dockerfile.codegen` fetches Node from
`nodejs.org` and `buf` from `github.com` (neither is on the allowlist; `registry.npmjs.org`,
`pypi.org`, `proxy.golang.org` and the Debian mirrors are, which is why apt / npm / pip / `go
install` succeed while the Node and buf steps do not). `curl -sS "$HTTPS_PROXY/__agentproxy/status"`
prints the live `noProxy` list.

To build the codegen image here, trust the proxy CA **inside** the build — do this in a throwaway
Dockerfile that wraps the committed one, never by editing `Dockerfile.codegen` (the real image must
not carry sandbox-specific trust):

```dockerfile
# validation-only wrapper — inject right after the system-deps apt layer
COPY ca-bundle.crt /usr/local/share/ca-certificates/ccr-proxy.crt
RUN update-ca-certificates
ENV CURL_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt \
    NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt
```

`Dockerfile.codegen` itself `COPY`s nothing from the build context, so the context can be a tiny
temp dir holding just the wrapper Dockerfile and a copy of `ca-bundle.crt`. Once built, run codegen
against the repo exactly as `localenv-setup.sh` does (`docker run --rm -v "$PWD:/workspace" -w
/workspace <image> bash -c 'git config --global --add safe.directory /workspace &&
./scripts/buf-gen.sh'`) and confirm an empty `git diff packages/proto/gen/`. For a single proto
step the host path above is still less setup; reach for Docker when you want the full,
version-pinned container end-to-end.

## References

- `Dockerfile.codegen` — authoritative version pins (re-read at task time)
- `scripts/buf-gen.sh` — the codegen entrypoint validated in Step 5
- `scripts/localenv-setup.sh` — the normal Docker-based path this runbook substitutes for
- `docs/runbooks/proto-versioning.md` — proto change / BSR workflow once the toolchain is ready
- `docs/roadmap/ledger/insights.md` (2026-07-09 `backtest-debug-info — ordering`) — origin note
