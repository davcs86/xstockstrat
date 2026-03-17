import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';
import { Pool } from 'pg';
import { ConfigWatcher } from './services/configWatcher';
import { IdentityServiceImpl } from './grpc/identityServiceImpl';
import { getLogger } from './services/logger';

const log = getLogger('identity:server');

async function main() {
  const grpcPort = process.env.GRPC_PORT ?? '50058';
  const configEndpoint = process.env.CONFIG_ENDPOINT ?? 'xstockstrat-config:50060';
  const databaseUrl = process.env.DATABASE_URL ?? '';

  const configWatcher = new ConfigWatcher(configEndpoint, 'identity');
  await configWatcher.waitForSnapshot(10_000);
  log.info('Config snapshot received');

  const pool = new Pool({ connectionString: databaseUrl });

  const PROTO_PATH = path.resolve(__dirname, '../../../packages/proto/identity/v1/identity.proto');
  const pkgDef = protoLoader.loadSync(PROTO_PATH, {
    keepCase: false, longs: String, enums: String, defaults: true, oneofs: true
  });
  const proto = grpc.loadPackageDefinition(pkgDef) as any;

  const server = new grpc.Server();
  const identityImpl = new IdentityServiceImpl(pool, configWatcher);
  server.addService(
    proto.xstockstrat.identity.v1.IdentityService.service,
    identityImpl,
  );

  server.bindAsync(
    `0.0.0.0:${grpcPort}`,
    grpc.ServerCredentials.createInsecure(),
    (err, port) => {
      if (err) { log.error('Bind failed', { error: err.message }); process.exit(1); }
      server.start();
      log.info(`Identity service listening on port ${port}`);
    }
  );

  const shutdown = () => {
    server.tryShutdown(() => { pool.end(); process.exit(0); });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
