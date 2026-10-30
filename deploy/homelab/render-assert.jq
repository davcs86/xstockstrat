# Input: `docker compose config --format json`; output: failed-check labels ([] passes).
# Optional --arg bind <SMOKE_BIND_ADDR> and overlay yes|no (staging merged with compose.smoke.yml).
# Values are projected away first, so no secret can reach the output or a jq error.
def bind: $ARGS.named.bind // "";
def overlay: $ARGS.named.overlay == "yes";
def want: {production: {appenv: "production", mode: "live", db: "xstockstrat-production", user: "xstockstrat_production"},
           staging: {appenv: "development", mode: "paper", db: "xstockstrat-staging", user: "xstockstrat_staging"}} | .[$target];
def pooled: ["xstockstrat-marketdata","xstockstrat-portfolio","xstockstrat-indicators",
  "xstockstrat-ingest","xstockstrat-trading","xstockstrat-analysis"];
def direct: ["db-migrator","xstockstrat-config","xstockstrat-ledger","xstockstrat-identity",
  "xstockstrat-notify","xstockstrat-ui"];
def dsn: if type == "string" then (capture("^postgresql://(?<user>[^:@/]+):[^@]*@(?<tail>[^@]+)$") // null) else null end;
# A failed migration fails --wait only for services that (transitively) depend on db-migrator.
def reach($s; $k; $seen): if $k == "db-migrator" then true elif ($seen | index([$k])) then false
  else any($s[$k].deps[]?; reach($s; .; $seen + [$k])) end;
# compose renders durations as e.g. "2m0s".
def secs: if type != "string" then 0 else
  (capture("^(?:(?<h>[0-9]+)h)?(?:(?<m>[0-9]+)m)?(?:(?<s>[0-9]+)s)?$") // {}
   | ((.h // "0" | tonumber) * 3600) + ((.m // "0" | tonumber) * 60) + (.s // "0" | tonumber)) end;
def pem: type == "string" and startswith("-----BEGIN");
def project: (if type == "object" and (.services | type) == "object" then .services else {} end) | with_entries(.value |= {
  image: ((.image | type == "string") and (.image | test("@sha256:[0-9a-f]{64}$"))),
  bv: (has("build") or ((.volumes // []) | length > 0)),
  hc: (.healthcheck.test != null),
  deps: ((.depends_on // {}) | keys),
  ports: [(.ports // [])[] | (.published | tostring)],
  hostips: [(.ports // [])[] | .host_ip],
  restart: .restart, log: .logging.driver, start: (.healthcheck.start_period | secs),
  env: ((.environment // {}) | {APPLICATION_ENV, TRADING_MODE, OTEL_ENABLED, HOSTNAME, DB_PGBOUNCER, pool: .DB_POOL_MAX, smoke: .SMOKE_ENV,
        db: (.DATABASE_URL | dsn), mtls: ((.MTLS_CERT | pem) and (.MTLS_KEY | pem))})
});
project as $s | want as $w | ($s | keys - ["db-migrator"]) as $apps | [
  (if $w == null then "target" else empty end),
  (if ($host | test("^[a-z0-9.-]+$")) | not then "db-host" else empty end),
  (if ($s | has("db-migrator")) | not then "services" else empty end),
  # Every app must be classified, so a new service cannot skip the DB-route checks.
  (($apps - pooled - direct - ["xstockstrat-agent","xstockstrat-smoke"])[] | "unclassified:\(.)"),
  ($apps[] | select(reach($s; .; []) | not) | "depends-migrator:\(.)"),
  ($s | to_entries[] | .key as $k | .value |
    (if .image | not then "image:\($k)" else empty end),
    (if .bv then "build-or-volumes:\($k)" else empty end),
    (if $k != "db-migrator" and (.hc | not) then "healthcheck:\($k)" else empty end)),
  ($apps[] as $k | ($s[$k].env // {}) |
    (if .APPLICATION_ENV != $w.appenv then "application-env:\($k)" else empty end),
    (if .TRADING_MODE != $w.mode then "trading-mode:\($k)" else empty end),
    (if .OTEL_ENABLED != "false" then "otel:\($k)" else empty end),
    (if .mtls != true then "mtls:\($k)" else empty end)),
  (pooled[] as $k | ($s[$k].env // {}) | if .db != {user: $w.user, tail: "\($host):6432/\($w.db)?sslmode=require"} or .DB_PGBOUNCER != "true" then "pooled:\($k)" else empty end),
  (direct[] as $k | ($s[$k].env // {}) | if .db != {user: $w.user, tail: "\($host):5432/\($w.db)?sslmode=require"} or .DB_PGBOUNCER != null then "direct:\($k)" else empty end),
  # 7 explicit direct slots + ledger's LISTEN connection = the 8 homelab-edge sizes each role for (a floor, not a cap).
  (if ([direct[] | select(. != "db-migrator") as $k | ($s[$k].env.pool | tonumber?) // 99] | add // 99) > 7 then "pool-budget" else empty end),
  (pooled[] as $k | if $s[$k].env.pool != null then "pool-budget:\($k)" else empty end),
  (if $s["xstockstrat-agent"].env.db != null then "agent-db" else empty end),
  (if $w != null and $w.appenv == "production" and ($s | has("xstockstrat-smoke")) then "smoke-in-production" else empty end),
  (if $target == "staging" and overlay and ($s | has("xstockstrat-smoke") | not) then "smoke-missing" else empty end),
  ($s["xstockstrat-smoke"] // empty | . as $m |
    (if $m.env.db != {user: "xstockstrat_staging_smoke_ro", tail: "\($host):5432/\($w.db)?sslmode=require"} or $m.env.DB_PGBOUNCER != null then "smoke-dsn" else empty end),
    (if $m.env.pool != "1" then "smoke-pool" else empty end),
    (if $m.env.smoke != "homelab-staging" then "smoke-env" else empty end),
    (if $m.start < 90 then "smoke-healthcheck" else empty end),
    (if $m.restart != "unless-stopped" then "smoke-restart" else empty end),
    (if $m.log != "local" then "smoke-logging" else empty end),
    (if bind == "" or bind == "0.0.0.0" or $m.hostips != [bind] then "smoke-bind" else empty end)),
  (if $s["xstockstrat-ui"].env.HOSTNAME != "0.0.0.0" then "ui-hostname" else empty end),
  (if ([$s | to_entries[] | select(.value.ports | length > 0) | "\(.key)=\(.value.ports | join(","))"] | sort) != (["xstockstrat-agent=9000","xstockstrat-ui=3000"] + (if overlay then ["xstockstrat-smoke=9110"] else [] end) | sort) then "ports" else empty end)
]
