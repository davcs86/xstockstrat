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
  await configWatcher.waitForSnapshot(10_000);
  log.info('Config snapshot received');

  const pool = new Pool({ connectionString: databaseUrl });

  const server = new grpc.Server();
  const notifyImpl = new NotifyServiceImpl(pool, configWatcher);

  server.addService(createNotifyServiceDefinition(), notifyImpl);

  server.bindAsync(
    `0.0.0.0:${grpcPort}`,
    grpc.ServerCredentials.createInsecure(),
    (err, port) => {
      if (err) { log.error('Bind failed', { error: err.message }); process.exit(1); }
      server.start();
      log.info(`Notify service listening on port ${port}`);
    }
  );

  const shutdown = () => {
    server.tryShutdown(() => { pool.end(); process.exit(0); });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
