# Config Governance Rules

All runtime configuration is served by **xstockstrat-config** via `WatchConfig` streaming RPC (gRPC port 50060). config is gRPC-only.

## Rules (apply to every service)

1. **No hardcoded config values** in service source code. All env-specific values must be registered in the config service.
2. **Config key naming**: `<service-short-name>.<category>.<key>` — e.g., `indicators.sandbox.timeout_ms`
3. **All services subscribe to xstockstrat-config at startup** before accepting traffic, passing `environment` and `trading_mode` in the WatchConfig request.
4. **Config values are scoped** by `environment` (`dev`/`production`) and `trading_mode` (`paper`/`live`/`all`). Rows with `trading_mode='all'` apply to all modes.
5. **Config changes flow**: agent or webhook caller → config webhook handler → config service → WatchConfig stream → all subscribers.
6. **Sensitive keys** use the `secret.*` prefix and are resolved from the secret store at runtime — never stored in config service state.
7. **Default values** must be declared in each service's `CLAUDE.md` under "Config Keys".
8. **Config UI** at `http://localhost:3002` — manage config values by environment and trading mode.

## Global Config Keys

| Key | Type | Default | Description |
|---|---|---|---|
| `platform.maintenance_mode` | bool | false | Halts all trading operations |
| `platform.log_level` | string | info | Global log level override |
| `platform.ledger_endpoint` | string | — | xstockstrat-ledger gRPC address |
| `platform.config_endpoint` | string | — | xstockstrat-config gRPC address |
| `platform.otel.enabled` | bool | false | Master OTel export switch |
| `platform.otel.endpoint` | string | — | OTLP endpoint (set via secret) |
| `platform.otel.sample_rate` | float | 1.0 | Trace sample rate (0.0–1.0) |

## Registering a new config key

1. Add the key to the config service's seed data.
2. Declare it in the consuming service's `CLAUDE.md` under "Config Keys Consumed".
3. Approval: service owner + config team (see `docs/runbooks/approval-flow.md`).
