# Defect: Node services and the UI audit route silently disable DB TLS certificate verification when DATABASE_CA_CERT is unset

**Recorded**: 2026-10-21
**Severity**: SEV-2
**Impact type**: db-tls-unverified
**Environment**: dev (main-dev) @ a053b0e
**Affected service(s)**: xstockstrat-ledger, xstockstrat-config, xstockstrat-identity, xstockstrat-notify, xstockstrat-ui
**Config-only fix possible**: no
**Source**: repo-surveyor debt-radar scan (`docs/repo-surveyor/debt-radar-findings.md` @ 4535695), finding D-32 (flagged security). Re-verified against main-dev @ a053b0e on 2026-10-21; current lines below.

## Observed

### D-32 — DB TLS verification silently disabled when `DATABASE_CA_CERT` is unset

Every Node-side `pg.Pool` builds its `ssl` option as `{ rejectUnauthorized: !!caCert, ...(caCert ? { ca } : {}) }`.
When `DATABASE_CA_CERT` is missing or empty, the connection is still TLS-encrypted but the server certificate is
**not verified**, so a network-position attacker can present any certificate and read or alter the traffic
(credentials, config ciphertext and audit rows, identity password hashes and refresh-token hashes, ledger events).
Nothing is logged; the service boots exactly as if verification were on.

This is live in both deployed environments for the UI: `.do/app.yaml` and `.do/app.dev.yaml` give
`xstockstrat-ui` a `DATABASE_URL` but **no** `DATABASE_CA_CERT`, so the config-ui audit route's pool connects to
the managed cluster with `rejectUnauthorized: false` today. The four Node backends (ledger, identity, notify, config)
do receive `DATABASE_CA_CERT: ${xstockstrat.CA_CERT}` in both specs, so for them the gap is latent: dropping or
mistyping the binding silently downgrades to unverified TLS instead of failing.

## Expected

Outside an explicit `sslmode=disable` (local docker-compose), a Node DB pool either verifies the server certificate
against a configured CA or refuses to start. In production (and staging) a missing `DATABASE_CA_CERT` is a
fail-closed boot error with a clear log line, matching the platform's fail-closed handling of `MTLS_*` material.
The UI component in both `.do` specs is given `DATABASE_CA_CERT` so its audit route verifies the cluster.

## Reproduction

1. Start any of ledger/config/identity/notify (or call the UI `/config-ui/api/audit` route) with a `DATABASE_URL`
   that does not contain `sslmode=disable` and with `DATABASE_CA_CERT` unset.
2. Point it at a Postgres presenting a self-signed certificate (or a TLS-terminating proxy with an arbitrary cert).
3. The pool connects and serves queries with no warning. Correct behaviour: refuse to connect / refuse to boot.
4. For the deployed UI: `awk '/- name:/{n=$NF} /DATABASE_CA_CERT/{print n}' .do/app.yaml` lists only ledger,
   identity, notify and config; `xstockstrat-ui` is absent though it has `DATABASE_URL`.

## Evidence

### D-32 — DB TLS verification silently disabled when `DATABASE_CA_CERT` is unset

`services/xstockstrat-ledger/src/index.ts:35-38`
> const caCert = process.env.DATABASE_CA_CERT;
> const sslOption = sslDisabled ? false : {
>   rejectUnauthorized: !!caCert,

`services/xstockstrat-config/src/index.ts:34`, `:39-41`
> const caCert = process.env.DATABASE_CA_CERT;
> ssl: sslDisabled ? false : {
>   rejectUnauthorized: !!caCert,

`services/xstockstrat-identity/src/index.ts:33`, `:39` and `services/xstockstrat-notify/src/index.ts:34`, `:41`
> rejectUnauthorized: !!caCert,

`services/xstockstrat-ui/src/app/config-ui/api/audit/route.ts:23`, `:29-31`
> const caCert = process.env.DATABASE_CA_CERT;
> ssl: sslDisabled
>   ? false
>   : { rejectUnauthorized: !!caCert, ...(caCert ? { ca: caCert } : {}) },

`.do/app.yaml` / `.do/app.dev.yaml`: `DATABASE_CA_CERT` is bound for `xstockstrat-ledger`, `-identity`, `-notify`,
`-config` only (e.g. `.do/app.yaml:434-436`); `xstockstrat-ui` receives `DATABASE_URL` without it.

## Root cause hypothesis

The CA was treated as an optional hardening knob ("verify if we happen to have a CA") rather than a required
production input, and the same five-line pool setup was copy-pasted per service (debt-radar D-20), so the
fail-open default spread to every Node pool and the UI was never wired with the CA.

## Confidence

high (direct read of current code and both app specs; the UI's unverified connection follows from the spec, not
yet observed on the wire).
