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
  await configWatcher.waitForSnapshot(10_000);
  log.info('Config snapshot received');

  // TimescaleDB connection pool
  const pool = new Pool({ connectionString: databaseUrl });
  await pool.query('SELECT 1'); // verify connectivity
  log.info('Database connected');

  // gRPC server
  const server = new grpc.Server();
  const ledgerImpl = new LedgerServiceImpl(pool, configWatcher);
  server.addService(createLedgerServiceDefinition(), ledgerImpl);

  server.bindAsync(
    `0.0.0.0:${grpcPort}`,
    grpc.ServerCredentials.createInsecure(),
    (err, port) => {
      if (err) {
        log.error('Failed to bind gRPC server', { error: err.message });
        process.exit(1);
      }
      server.start();
      log.info(`Ledger service listening on port ${port}`);
    }
  );

  // Graceful shutdown
  const shutdown = async () => {
    log.info('Shutting down ledger service...');
    server.tryShutdown(() => {
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
