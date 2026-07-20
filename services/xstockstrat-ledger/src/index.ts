import { initTelemetry } from './telemetry';
initTelemetry();

import * as grpc from '@grpc/grpc-js';
import { getLogger } from './services/logger';
import { ConfigWatcher } from './services/configWatcher';
import { LedgerServiceImpl } from './grpc/ledgerServiceImpl';
import { createLedgerServiceDefinition } from './grpc/serviceDefinition';
import { EventNotifier } from './services/eventNotifier';
import { Pool, Client } from 'pg';

const log = getLogger('ledger:server');

async function main() {
  const configEndpoint = process.env.CONFIG_ENDPOINT ?? 'xstockstrat-config:50060';
  const grpcPort = process.env.GRPC_PORT ?? '50057';
  const databaseUrl = process.env.DATABASE_URL ?? '';

  // Subscribe to config before accepting traffic
  log.info(`Connecting to config service at ${configEndpoint}`);
  const configWatcher = new ConfigWatcher(configEndpoint, 'ledger');
  await configWatcher.waitForSnapshot(90_000);
  log.info('Config snapshot received');

  // TimescaleDB connection pool
  const sslDisabled = databaseUrl.includes('sslmode=disable');
  let dbUrl = databaseUrl;
  if (!sslDisabled) {
    try {
      const u = new URL(databaseUrl);
      u.searchParams.delete('sslmode');
      dbUrl = u.toString();
    } catch { /* keep original if URL parsing fails */ }
  }
  const caCert = process.env.DATABASE_CA_CERT;
  const sslOption = sslDisabled ? false : {
    rejectUnauthorized: !!caCert,
    ...(caCert ? { ca: caCert } : {}),
  };
  const pool = new Pool({
    connectionString: dbUrl,
    // Query pool. Live streaming no longer borrows from this pool (it uses the
    // dedicated EventNotifier connection below), so a small pool is sufficient.
    // Default 1 keeps the ledger's total DB connections at 2 (1 pool + 1
    // listener), within DigitalOcean's shared 20-connection budget (see root
    // CLAUDE.md). Override with DB_POOL_MAX.
    max: parseInt(process.env.DB_POOL_MAX ?? '1', 10),
    ssl: sslOption,
  });
  await pool.query('SELECT 1'); // verify connectivity
  log.info('Database connected');

  // Dedicated LISTEN/NOTIFY connection (separate from the query pool) that fans
  // live events out to every StreamEvents subscriber. Decoupling streaming from
  // the pool prevents N concurrent streams from starving AppendEvent.
  const notifier = new EventNotifier(() => new Client({ connectionString: dbUrl, ssl: sslOption }));
  await notifier.start();
  log.info('Event notifier started');

  const ledgerImpl = new LedgerServiceImpl(pool, configWatcher, notifier);

  // ── gRPC server (internal service-to-service, port 50057) ──────────────
  const grpcServer = new grpc.Server();
  grpcServer.addService(createLedgerServiceDefinition(), ledgerImpl as unknown as grpc.UntypedServiceImplementation);

  grpcServer.bindAsync(
    `0.0.0.0:${grpcPort}`,
    grpc.ServerCredentials.createInsecure(),
    (err, port) => {
      if (err) {
        log.error('Failed to bind gRPC server', { error: err.message });
        process.exit(1);
      }
      grpcServer.start();
      log.info(`Ledger gRPC service listening on port ${port}`);
    }
  );

  // Graceful shutdown
  const shutdown = async () => {
    log.info('Shutting down ledger service...');
    grpcServer.tryShutdown(async () => {
      await notifier.stop();
      await pool.end();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
