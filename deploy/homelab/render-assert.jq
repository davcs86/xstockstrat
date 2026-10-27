# Input: `docker compose config --format json`; output: failed-check labels ([] passes).
# Values are projected away first, so no secret can reach the output or a jq error.
def want: {production: {appenv: "production", mode: "live", db: "xstockstrat-production", user: "xstockstrat_production"},
           staging: {appenv: "development", mode: "paper", db: "xstockstrat-staging", user: "xstockstrat_staging"}} | .[$target];
def apps: ["xstockstrat-config","xstockstrat-ledger","xstockstrat-identity","xstockstrat-notify",
  "xstockstrat-marketdata","xstockstrat-portfolio","xstockstrat-indicators","xstockstrat-ingest",
  "xstockstrat-trading","xstockstrat-analysis","xstockstrat-ui","xstockstrat-agent"];
def pooled: ["xstockstrat-marketdata","xstockstrat-portfolio","xstockstrat-indicators",
  "xstockstrat-ingest","xstockstrat-trading","xstockstrat-analysis"];
def direct: ["db-migrator","xstockstrat-config","xstockstrat-ledger","xstockstrat-identity",
  "xstockstrat-notify","xstockstrat-ui"];
def dsn: if type == "string" then (capture("^postgresql://(?<user>[^:@/]+):[^@]*@(?<tail>[^@]+)$") // null) else null end;
def pem: type == "string" and startswith("-----BEGIN");
def project: (if type == "object" and (.services | type) == "object" then .services else {} end) | with_entries(.value |= {
  image: ((.image | type == "string") and (.image | test("@sha256:[0-9a-f]{64}$"))),
  bv: (has("build") or ((.volumes // []) | length > 0)),
  hc: (.healthcheck.test != null),
  ports: [(.ports // [])[] | (.published | tostring)],
  env: ((.environment // {}) | {APPLICATION_ENV, TRADING_MODE, OTEL_ENABLED, HOSTNAME, DB_PGBOUNCER, pool: .DB_POOL_MAX,
        db: (.DATABASE_URL | dsn), mtls: ((.MTLS_CERT | pem) and (.MTLS_KEY | pem))})
});
project as $s | want as $w | [
  (if $w == null then "target" else empty end),
  (if ($s | keys) != ((apps + ["db-migrator"]) | sort) then "services" else empty end),
  ($s | to_entries[] | .key as $k | .value |
    (if .image | not then "image:\($k)" else empty end),
    (if .bv then "build-or-volumes:\($k)" else empty end),
    (if $k != "db-migrator" and (.hc | not) then "healthcheck:\($k)" else empty end)),
  (apps[] as $k | ($s[$k].env // {}) |
    (if .APPLICATION_ENV != $w.appenv then "application-env:\($k)" else empty end),
    (if .TRADING_MODE != $w.mode then "trading-mode:\($k)" else empty end),
    (if .OTEL_ENABLED != "false" then "otel:\($k)" else empty end),
    (if .mtls != true then "mtls:\($k)" else empty end)),
  (pooled[] as $k | ($s[$k].env // {}) | if .db != {user: $w.user, tail: "db.ts.natanddavehouse.com:6432/\($w.db)?sslmode=require"} or .DB_PGBOUNCER != "true" then "pooled:\($k)" else empty end),
  (direct[] as $k | ($s[$k].env // {}) | if .db != {user: $w.user, tail: "db.ts.natanddavehouse.com:5432/\($w.db)?sslmode=require"} or .DB_PGBOUNCER != null then "direct:\($k)" else empty end),
  # 7 explicit direct slots + ledger's LISTEN connection = the 8 homelab-edge sizes each role for (a floor, not a cap).
  (if ([direct[] | select(. != "db-migrator") as $k | ($s[$k].env.pool | tonumber?) // 99] | add // 99) > 7 then "pool-budget" else empty end),
  (pooled[] as $k | if $s[$k].env.pool != null then "pool-budget:\($k)" else empty end),
  (if $s["xstockstrat-agent"].env.db != null then "agent-db" else empty end),
  (if $s["xstockstrat-ui"].env.HOSTNAME != "0.0.0.0" then "ui-hostname" else empty end),
  (if ([$s | to_entries[] | select(.value.ports | length > 0) | "\(.key)=\(.value.ports | join(","))"] | sort) != ["xstockstrat-agent=9000","xstockstrat-ui=3000"] then "ports" else empty end)
]
