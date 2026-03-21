import { initTelemetry } from './telemetry';
initTelemetry();

import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as http from 'http';
import path from 'path';
import { Pool } from 'pg';
import { ConfigWatcher } from './services/configWatcher';
import { IdentityServiceImpl } from './grpc/identityServiceImpl';
import { createConnectRouter } from './connect/connectRouter';
import { connectNodeAdapter } from '@connectrpc/connect-node';
import { getLogger } from './services/logger';
import { createN8nRouter } from './n8n/webhookRouter';

const log = getLogger('identity:server');

async function main() {
  const grpcPort = process.env.GRPC_PORT ?? '50058';
  const httpPort = process.env.HTTP_PORT ?? '8058';
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

  const identityImpl = new IdentityServiceImpl(pool, configWatcher);

  // ── gRPC server (internal service-to-service, port 50058) ──────────────
  const grpcServer = new grpc.Server();
  grpcServer.addService(
    proto.xstockstrat.identity.v1.IdentityService.service,
    identityImpl as unknown as grpc.UntypedServiceImplementation,
  );

  grpcServer.bindAsync(
    `0.0.0.0:${grpcPort}`,
    grpc.ServerCredentials.createInsecure(),
    (err, port) => {
      if (err) { log.error('Bind failed', { error: err.message }); process.exit(1); }
      grpcServer.start();
      log.info(`Identity gRPC service listening on port ${port}`);
    }
  );

  // ── Connect-RPC HTTP server (browser + external clients, port 8058) ────
  const connectHandler = connectNodeAdapter({ routes: createConnectRouter(identityImpl) });
  const n8nRouter = createN8nRouter(identityImpl);
  const httpServer = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Connect-Protocol-Version, Connect-Timeout-Ms');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'xstockstrat-identity' }));
      return;
    }
    if (req.url?.startsWith('/webhooks/n8n/')) { n8nRouter(req, res); return; }
    connectHandler(req, res);
  });
  httpServer.listen(parseInt(httpPort, 10), () => {
    log.info(`Identity Connect-RPC HTTP service listening on port ${httpPort}`);
  });

  const shutdown = () => {
    httpServer.close();
    grpcServer.tryShutdown(() => { pool.end(); process.exit(0); });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
