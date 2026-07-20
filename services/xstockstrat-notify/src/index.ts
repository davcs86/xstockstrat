import { initTelemetry } from './telemetry';
initTelemetry();

import * as grpc from '@grpc/grpc-js';
import { Pool } from 'pg';
import { ConfigWatcher } from './services/configWatcher';
import { NotifyServiceImpl } from './grpc/notifyServiceImpl';
import { createNotifyServiceDefinition } from './grpc/serviceDefinition';
import { getLogger } from './services/logger';

const log = getLogger('notify:server');

async function main() {
  const grpcPort = process.env.GRPC_PORT ?? '50059';
  const configEndpoint = process.env.CONFIG_ENDPOINT ?? 'xstockstrat-config:50060';
  const databaseUrl = process.env.DATABASE_URL ?? '';

  const configWatcher = new ConfigWatcher(configEndpoint, 'notify');
  await configWatcher.waitForSnapshot(90_000);
  log.info('Config snapshot received');

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
    // (see root CLAUDE.md). notify makes light DB use (alert history only), so
    // it defaults to 1. Override with DB_POOL_MAX.
    max: parseInt(process.env.DB_POOL_MAX ?? '1', 10),
    ssl: sslDisabled ? false : {
      rejectUnauthorized: !!caCert,
      ...(caCert ? { ca: caCert } : {}),
    },
  });

  const notifyImpl = new NotifyServiceImpl(pool, configWatcher);

  // ── gRPC server (internal service-to-service, port 50059) ──────────────
  const grpcServer = new grpc.Server();
  grpcServer.addService(createNotifyServiceDefinition(), notifyImpl as unknown as grpc.UntypedServiceImplementation);

  grpcServer.bindAsync(
    `0.0.0.0:${grpcPort}`,
    grpc.ServerCredentials.createInsecure(),
    (err, port) => {
      if (err) { log.error('Bind failed', { error: err.message }); process.exit(1); }
      grpcServer.start();
      log.info(`Notify gRPC service listening on port ${port}`);
    }
  );

  const shutdown = () => {
    grpcServer.tryShutdown(() => { pool.end(); process.exit(0); });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
