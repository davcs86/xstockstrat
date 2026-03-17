import * as grpc from '@grpc/grpc-js';
import * as http from 'http';
import { Pool } from 'pg';
import { ConfigWatcher } from './services/configWatcher';
import { NotifyServiceImpl } from './grpc/notifyServiceImpl';
import { createNotifyServiceDefinition } from './grpc/serviceDefinition';
import { createConnectRouter } from './connect/connectRouter';
import { connectNodeAdapter } from '@connectrpc/connect-node';
import { getLogger } from './services/logger';

const log = getLogger('notify:server');

async function main() {
  const grpcPort = process.env.GRPC_PORT ?? '50059';
  const httpPort = process.env.HTTP_PORT ?? '8059';
  const configEndpoint = process.env.CONFIG_ENDPOINT ?? 'xstockstrat-config:50060';
  const databaseUrl = process.env.DATABASE_URL ?? '';

  const configWatcher = new ConfigWatcher(configEndpoint, 'notify');
  await configWatcher.waitForSnapshot(10_000);
  log.info('Config snapshot received');

  const pool = new Pool({ connectionString: databaseUrl });

  const notifyImpl = new NotifyServiceImpl(pool, configWatcher);

  // ── gRPC server (internal service-to-service, port 50059) ──────────────
  const grpcServer = new grpc.Server();
  grpcServer.addService(createNotifyServiceDefinition(), notifyImpl);

  grpcServer.bindAsync(
    `0.0.0.0:${grpcPort}`,
    grpc.ServerCredentials.createInsecure(),
    (err, port) => {
      if (err) { log.error('Bind failed', { error: err.message }); process.exit(1); }
      grpcServer.start();
      log.info(`Notify gRPC service listening on port ${port}`);
    }
  );

  // ── Connect-RPC HTTP server (browser + external clients, port 8059) ────
  const connectHandler = connectNodeAdapter({ routes: createConnectRouter(notifyImpl) });
  const httpServer = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Connect-Protocol-Version, Connect-Timeout-Ms');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    connectHandler(req, res);
  });
  httpServer.listen(parseInt(httpPort, 10), () => {
    log.info(`Notify Connect-RPC HTTP service listening on port ${httpPort}`);
  });

  const shutdown = () => {
    httpServer.close();
    grpcServer.tryShutdown(() => { pool.end(); process.exit(0); });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
