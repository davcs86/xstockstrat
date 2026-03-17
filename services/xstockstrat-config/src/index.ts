import * as grpc from '@grpc/grpc-js';
import { Pool } from 'pg';
import { getLogger } from './services/logger';
import { ConfigServiceImpl } from './grpc/configServiceImpl';
import { createConfigServiceDefinition } from './grpc/serviceDefinition';

const log = getLogger('config:server');

async function main() {
  const grpcPort = process.env.GRPC_PORT ?? '50060';
  const databaseUrl = process.env.DATABASE_URL ?? '';

  // NOTE: xstockstrat-config does NOT subscribe to itself.
  // It is the config source of truth. All other services subscribe to it.
  log.info('xstockstrat-config is the config source — no self-subscription');

  const pool = new Pool({ connectionString: databaseUrl });
  await pool.query('SELECT 1');
  log.info('Database connected');

  const server = new grpc.Server();
  const configImpl = new ConfigServiceImpl(pool);
  await configImpl.initialize();

  server.addService(createConfigServiceDefinition(), configImpl);

  server.bindAsync(
    `0.0.0.0:${grpcPort}`,
    grpc.ServerCredentials.createInsecure(),
    (err, port) => {
      if (err) {
        log.error('Failed to bind', { error: err.message });
        process.exit(1);
      }
      server.start();
      log.info(`Config service listening on port ${port}`);
    }
  );

  const shutdown = () => {
    log.info('Shutting down config service...');
    server.tryShutdown(() => {
      pool.end();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
