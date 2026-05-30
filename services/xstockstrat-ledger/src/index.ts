import { initTelemetry } from './telemetry';
initTelemetry();

import * as grpc from '@grpc/grpc-js';
import { getLogger } from './services/logger';
import { ConfigWatcher } from './services/configWatcher';
import { LedgerServiceImpl } from './grpc/ledgerServiceImpl';
import { createLedgerServiceDefinition } from './grpc/serviceDefinition';
import { Pool } from 'pg';

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
  const pool = new Pool({
    connectionString: dbUrl,
    ssl: sslDisabled ? false : {
      rejectUnauthorized: !!caCert,
      ...(caCert ? { ca: caCert } : {}),
    },
  });
  await pool.query('SELECT 1'); // verify connectivity
  log.info('Database connected');

  const ledgerImpl = new LedgerServiceImpl(pool, configWatcher);

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
    grpcServer.tryShutdown(() => {
      pool.end();
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
