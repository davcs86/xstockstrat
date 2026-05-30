# Config Service Startup Readiness Pattern

Every service that depends on `xstockstrat-config` must block startup until it has received at least one config snapshot. This document describes the timeout, retry, and healthcheck conventions that make this safe in both local Docker Compose and DigitalOcean App Platform environments.

---

## Why 90 seconds?

DigitalOcean App Platform starts all services concurrently — there is no `depends_on` ordering. The config service itself may take 20–40 s to pull its image, initialize its DB connection, and begin serving WatchConfig streams. A 10 s timeout fails reliably in this scenario.

90 s is chosen to be:
- Well above the observed worst-case cold-start time on DO (≈40 s)
- Short enough to surface a real misconfiguration (wrong endpoint, missing secret) within a reasonable deployment window
- Consistent with the `start_period: 15s` + `retries: 5` × `interval: 5s` = 40 s worst-case healthcheck window in Docker Compose

The WatchConfig background loop retries the gRPC stream every 2 s on error, so if the config service becomes available at any point within the 90 s window the service proceeds normally.

---

## Docker Compose: healthcheck + `condition: service_healthy`

In `docker-compose.yml`, `xstockstrat-config` declares a healthcheck so dependent services wait until its gRPC port is accepting connections before attempting to connect. (config is gRPC-only — the former HTTP `8060` `/health` endpoint was removed, so the probe is a TCP check on `50060`.)

```yaml
xstockstrat-config:
  healthcheck:
    test: ["CMD", "nc", "-z", "localhost", "50060"]
    interval: 5s
    timeout: 3s
    start_period: 15s
    retries: 5
```

Every service that depends on config uses `condition: service_healthy` in its `depends_on` block:

```yaml
xstockstrat-trading:
  depends_on:
    xstockstrat-config:
      condition: service_healthy
    # other deps...
```

**This has no effect on DigitalOcean App Platform**, which ignores `depends_on` entirely. The `WaitForSnapshot` timeout is the only defense there.

---

## Per-language patterns

### Go

The config `Watcher` runs a `watch()` goroutine that retries the WatchConfig stream every 2 s on error. `WaitForSnapshot` blocks on a channel until the first snapshot arrives:

```go
func (w *Watcher) WaitForSnapshot(ctx context.Context) error {
    select {
    case <-w.snapshotCh:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    case <-time.After(90 * time.Second):
        return fmt.Errorf("config snapshot timeout: 90s elapsed")
    }
}
```

Call site in `main()`:

```go
watcher, err := config.NewWatcher(cfg.ConfigEndpoint, "myservice")
if err != nil {
    log.Fatal("config watcher init", err)
}
ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
defer cancel()
if err := watcher.WaitForSnapshot(ctx); err != nil {
    log.Fatal("config snapshot timeout", err)
}
```

Reference implementations: `services/xstockstrat-trading/internal/config/config.go`, `services/xstockstrat-marketdata/internal/config/config.go`.

---

### Python (asyncio)

The `ConfigWatcher` runs a background `_watch_loop` task that retries the WatchConfig stream every 2 s on `AioRpcError`. `wait_for_snapshot` uses `asyncio.wait_for` to enforce the timeout:

```python
async def wait_for_snapshot(self, timeout_seconds: float = 90.0):
    try:
        await asyncio.wait_for(self._snapshot_event.wait(), timeout=timeout_seconds)
    except TimeoutError:
        raise RuntimeError(
            f"Timed out waiting for config snapshot from {self.endpoint} "
            f"namespace={self.namespace}"
        )
```

Call site in `serve()`:

```python
config_watcher = ConfigWatcher(endpoint=CONFIG_ENDPOINT, namespace="myservice")
await config_watcher.wait_for_snapshot(timeout_seconds=90)
log.info("config snapshot received")
```

Reference implementations: `services/xstockstrat-indicators/app/config/watcher.py`, `services/xstockstrat-ingest/app/config/watcher.py`, `services/xstockstrat-analysis/app/config/watcher.py`.

---

### Node.js (TypeScript)

The `ConfigWatcher` starts the WatchConfig stream in the constructor. On `'end'` or `'error'` it calls `setTimeout(() => this.startWatch(), 2000)` to retry. `waitForSnapshot` races the resolved promise against a timeout:

```typescript
async waitForSnapshot(timeoutMs = 90_000): Promise<void> {
  return Promise.race([
    this.snapshotPromise,
    new Promise<void>((_, reject) =>
      setTimeout(
        () => reject(new Error(
          `Config snapshot timeout after ${timeoutMs}ms for namespace=${this.namespace} at ${this.endpoint}`
        )),
        timeoutMs,
      )
    ),
  ]);
}
```

Call site in startup:

```typescript
const configWatcher = new ConfigWatcher(configEndpoint, 'myservice');
await configWatcher.waitForSnapshot(90_000);
log.info('Config snapshot received');
```

Reference implementations: `services/xstockstrat-ledger/src/services/configWatcher.ts`, `services/xstockstrat-identity/src/services/configWatcher.ts`, `services/xstockstrat-notify/src/services/configWatcher.ts`.

---

## Checklist for a new service that depends on config

- [ ] Add `healthcheck` to `xstockstrat-config` in `docker-compose.yml` (already present — do not add a second one)
- [ ] Add `depends_on: xstockstrat-config: condition: service_healthy` in `docker-compose.yml`
- [ ] Use `WaitForSnapshot` / `wait_for_snapshot` / `waitForSnapshot` with timeout **90 s** (Go: `time.After(90 * time.Second)`; Python: `timeout_seconds=90`; Node: `timeoutMs = 90_000`)
- [ ] Verify the watcher's reconnect loop retries every 2 s on stream error (all existing watchers already do this)
