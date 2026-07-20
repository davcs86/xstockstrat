import { initTelemetry } from './telemetry';
initTelemetry();

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
    // Cap pool size to stay within DigitalOcean's shared 20-connection budget
    // (see root CLAUDE.md). Override with DB_POOL_MAX.
    max: parseInt(process.env.DB_POOL_MAX ?? '2', 10),
    ssl: sslDisabled ? false : {
      rejectUnauthorized: !!caCert,
      ...(caCert ? { ca: caCert } : {}),
    },
  });
  await pool.query('SELECT 1');
  log.info('Database connected');

  const configImpl = new ConfigServiceImpl(pool);
  await configImpl.initialize();

  // ── gRPC server (internal service-to-service, port 50060) ──────────────
  const grpcServer = new grpc.Server();
  grpcServer.addService(createConfigServiceDefinition(), configImpl as unknown as grpc.UntypedServiceImplementation);

  grpcServer.bindAsync(
    `0.0.0.0:${grpcPort}`,
    grpc.ServerCredentials.createInsecure(),
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
    grpcServer.tryShutdown(() => {
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
