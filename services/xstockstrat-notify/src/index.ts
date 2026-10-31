import { initTelemetry, shutdownTelemetry } from './telemetry';
initTelemetry();

import * as grpc from '@grpc/grpc-js';
import * as mtls from './mtls';
import { resolveDbConnection } from './dbTls';
import { Pool } from 'pg';
import { ConfigWatcher } from './services/configWatcher';
import { NotifyServiceImpl } from './grpc/notifyServiceImpl';
import { FanoutDispatcher } from './fanout/fanout';
import { WebPushDispatcher } from './fanout/webPush';
import { createAdminDirectory } from './services/adminDirectory';
import { createNotifyServiceDefinition } from './grpc/serviceDefinition';
import { getLogger } from './services/logger';

const log = getLogger('notify:server');

async function main() {
  const dbConn = resolveDbConnection(process.env.DATABASE_URL, process.env.DATABASE_CA_CERT);
  if (dbConn.ssl !== false) {
    log.info('db-tls: verifying server cert against DATABASE_CA_CERT');
  }
  const grpcPort = process.env.GRPC_PORT ?? '50059';
  const configEndpoint = process.env.CONFIG_ENDPOINT ?? 'xstockstrat-config:50060';

  const configWatcher = new ConfigWatcher(configEndpoint, 'notify');
  await configWatcher.waitForSnapshot(90_000);
  log.info('Config snapshot received');

  const pool = new Pool({
    connectionString: dbConn.connectionString,
    // Cap pool size to stay within DigitalOcean's shared connection budget (root CLAUDE.md);
    // notify's DB use is light (alert history), so default 1. Override with DB_POOL_MAX.
    max: parseInt(process.env.DB_POOL_MAX ?? '1', 10),
    ssl: dbConn.ssl,
  });
  await pool.query('SELECT 1');
  log.info('Database connected');

  const fanout = new FanoutDispatcher(configWatcher);
  const webPush = new WebPushDispatcher(pool, configWatcher, createAdminDirectory());
  const notifyImpl = new NotifyServiceImpl(pool, configWatcher, fanout, webPush);

  const grpcServer = new grpc.Server();
  grpcServer.addService(
    createNotifyServiceDefinition(),
    notifyImpl as unknown as grpc.UntypedServiceImplementation,
  );

  grpcServer.bindAsync(`0.0.0.0:${grpcPort}`, mtls.serverCredentials(), (err, port) => {
    if (err) {
      log.error('Bind failed', { error: err.message });
      process.exit(1);
    }
    grpcServer.start();
    log.info(`Notify gRPC service listening on port ${port}`);
  });

  const shutdown = () => {
    // Open streams block tryShutdown, so flush telemetry in parallel and force the stop.
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
