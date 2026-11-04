import { initTelemetry, shutdownTelemetry } from './telemetry';
initTelemetry();

import * as grpc from '@grpc/grpc-js';
import * as mtls from './mtls';
import { resolveDbConnection } from './dbTls';
import { Pool } from 'pg';
import { getLogger } from './services/logger';
import { ConfigServiceImpl } from './grpc/configServiceImpl';
import { createConfigServiceDefinition } from './grpc/serviceDefinition';
import { loadMasterKey } from './crypto';

const log = getLogger('config:server');

async function main() {
  const dbConn = resolveDbConnection(process.env.DATABASE_URL, process.env.DATABASE_CA_CERT);
  if (dbConn.ssl !== false) {
    log.info('db-tls: verifying server cert against DATABASE_CA_CERT');
  }
  const grpcPort = process.env.GRPC_PORT ?? '50060';

  // Fail fast: the service must never boot able to serve GetSecret with a missing/short master key.
  loadMasterKey();
  log.info('CONFIG_SECRETS_ENCRYPTION_KEY validated');

  // Config source of truth — never subscribes to itself.
  log.info('xstockstrat-config is the config source — no self-subscription');

  const pool = new Pool({
    connectionString: dbConn.connectionString,
    // Cap pool size for DigitalOcean's shared DB connection budget (root CLAUDE.md).
    max: parseInt(process.env.DB_POOL_MAX ?? '2', 10),
    ssl: dbConn.ssl,
  });
  await pool.query('SELECT 1');
  log.info('Database connected');

  const configImpl = new ConfigServiceImpl(pool);
  await configImpl.initialize();

  const grpcServer = new grpc.Server();
  grpcServer.addService(createConfigServiceDefinition(), configImpl as unknown as grpc.UntypedServiceImplementation);

  grpcServer.bindAsync(
    `0.0.0.0:${grpcPort}`,
    mtls.serverCredentials(),
    (err, port) => {
      if (err) {
        log.error('Failed to bind gRPC', { error: err.message });
        process.exit(1);
      }
      grpcServer.start();
      log.info(`Config gRPC service listening on port ${port}`);
    }
  );

  const shutdown = () => {
    log.info('Shutting down config service...');
    // Open WatchConfig streams block tryShutdown, so flush telemetry in parallel and force the stop.
    const flush = shutdownTelemetry();
    setTimeout(() => {
      grpcServer.forceShutdown();
      flush.finally(() => process.exit(0));
    }, 5000).unref();
    grpcServer.tryShutdown(async () => {
      await flush;
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
