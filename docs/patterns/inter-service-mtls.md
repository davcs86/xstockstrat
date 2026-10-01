# Inter-Service mTLS — Cert-Material Contract & Env Convention

Feature 210 (`inter-service-mtls`). Every inter-service gRPC connection is **mutually authenticated**:
each server requires + verifies the client's certificate and presents its own, both chaining to the
platform CA, with the client verifying the server's identity by **native chain + SAN matching**. This
is the transport layer beneath the `x-user-id` / `x-access-scope` / `x-trace-id` header propagation —
it does not change what those headers carry (FR-5).

## The three env vars (boot-time PEM strings)

| Var | Contents | Notes |
|---|---|---|
| `MTLS_CERT` | This service's leaf certificate, PEM | SAN = the registry service name (`xstockstrat-<svc>`); carries `serverAuth`+`clientAuth` EKUs, so one leaf serves both directions |
| `MTLS_KEY` | This service's private key, PEM | **secret** — `type: SECRET` in `.do/app*.yaml` |
| `MTLS_CA_CERT` | The platform CA bundle, PEM | During a CA rotation window this holds **old+new** CA, concatenated |

**Boot-time env, never over `WatchConfig`.** Cert material is read from `process.env` / `os.environ` /
`getEnv` *before* the gRPC server binds. It is deliberately NOT a config-service key: `xstockstrat-config`
serves `WatchConfig`, so it cannot secure its own inbound channel with material delivered over that
same channel (bootstrap circularity). This honors **F-07** — the values are external config (same class
as `DATABASE_URL`, `JWT_SECRET`, `CONFIG_SECRETS_ENCRYPTION_KEY`, and the `DATABASE_CA_CERT` string-env
precedent), just sourced from env rather than the config stream. These three vars are a distinct class
from the `<SERVICE>_ENDPOINT` connection vars and take **no** `_ENDPOINT`/`_URL` suffix.

**Fail-closed.** A process started without valid `MTLS_CERT`/`MTLS_KEY`/`MTLS_CA_CERT` **fails to start**.
There is no plaintext listener, no permissive mode, and no verification-disabling flag in any
environment. Dev and prod run identical full mutual mTLS; the only difference is which CA/certs load
(dev material from `scripts/gen-dev-certs.sh`; prod material from the production platform CA).

## Authority pinning — pin to the service name, never the dial host

The client's server-identity verification is pinned to the **target service name**
(`xstockstrat-<target>`), not the dialed host. This is load-bearing: the DO App Platform deploy specs
dial `${xstockstrat-<svc>.PRIVATE_DOMAIN}:<port>` (`.do/app.yaml` / `.do/app.dev.yaml`), whose FQDN ≠
the leaf SAN, while docker-compose dials the bare `xstockstrat-<svc>`. Pinning the expected name to the
service name makes verification **env-independent** (works in both) and avoids baking the DO-generated,
env-specific PRIVATE_DOMAIN FQDN into a self-signed SAN.

Per language (all run native chain+SAN verification — never Go `InsecureSkipVerify`, a fail-open footgun):

- **Go** — client `&tls.Config{RootCAs: ca, Certificates: [leaf], ServerName: "xstockstrat-<target>"}`;
  server `&tls.Config{ClientAuth: RequireAndVerifyClientCert, ClientCAs: ca, Certificates: [leaf]}`.
- **Python** — `grpc.ssl_channel_credentials(root_certificates=CA, private_key=KEY, certificate_chain=CERT)`
  + channel option `('grpc.ssl_target_name_override', 'xstockstrat-<target>')`; server
  `grpc.ssl_server_credentials([(KEY,CERT)], root_certificates=CA, require_client_auth=True)`.
- **Node** — client `credentials.createSsl(CA, KEY, CERT)` + `grpc.ssl_target_name_override`;
  server `ServerCredentials.createSsl(CA, [{private_key, cert_chain}], true)`.
- **UI BFF (connect-node)** — `createGrpcTransport({ baseUrl: 'https://<endpoint>',
  nodeOptions: { ca, cert, key, checkServerIdentity } })` (gRPC transport is inherently HTTP/2 — there
  is no `httpVersion` option; `checkServerIdentity` pins to `'xstockstrat-<target>'`).

## connect-node client-cert spike (resolved, Step 1)

`@connectrpc/connect-node@^2.1.0`'s `createGrpcTransport` accepts
`nodeOptions?: http2.SecureClientSessionOptions`
(`node_modules/@connectrpc/connect-node/dist/cjs/node-transport-options.d.ts:30`), and
`SecureClientSessionOptions` carries `ca`/`cert`/`key`/`checkServerIdentity`. So the UI BFF presents a
client certificate and pins the server authority **natively through `nodeOptions`** — no fallback
needed. (Had it not: the known-good fallback was a native `@grpc/grpc-js` stub behind the single
`makeTransport` choke point, `connectClients.ts:26-28`.)

## Local development

`scripts/gen-dev-certs.sh` (invoked by `scripts/localenv-setup.sh`) generates one self-signed dev
platform CA + one leaf per service under a git-ignored `./certs/<svc>/` tree
(`cert.pem`/`key.pem`/`ca.pem`). `docker-compose.yml` interpolates these as PEM **strings** per
service (`${<SVC>_MTLS_CERT}`/`${<SVC>_MTLS_KEY}`) plus the shared CA on the `x-common-env` anchor
(`${MTLS_CA_CERT}`) — the same PEM-as-string delivery prod uses, so the code path is identical.
Because Compose's `.env` parser cannot carry a multiline PEM, **`source scripts/mtls-dev-env.sh`**
first to export those vars from `./certs/` into the shell, then `docker compose up`.
`scripts/gen-dev-certs.sh --rotate <svc>` mints a rotated leaf off the same CA (`cert.rotated.pem`),
used by the cert-rotation test (@AC-6).

```bash
scripts/gen-dev-certs.sh          # once — mints ./certs/ (CA + per-service leaves)
source scripts/mtls-dev-env.sh    # export the PEMs into this shell
docker compose up -d              # compose interpolates ${<SVC>_MTLS_*} from the env
```

Rollout, rotation, and rollback procedure → `docs/runbooks/inter-service-mtls-rollout.md`.
