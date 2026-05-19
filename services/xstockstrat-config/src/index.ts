import { initTelemetry } from './telemetry';
initTelemetry();

import { propagationStore, extractFromHttpRequest } from './middleware/propagation';

import * as grpc from '@grpc/grpc-js';
import * as http from 'http';
import { Pool } from 'pg';
import { connectNodeAdapter } from '@connectrpc/connect-node';
import { getLogger } from './services/logger';
import { ConfigServiceImpl } from './grpc/configServiceImpl';
import { createConfigServiceDefinition } from './grpc/serviceDefinition';
import { createConnectRouter } from './connect/connectRouter';

const log = getLogger('config:server');

async function main() {
  const grpcPort = process.env.GRPC_PORT ?? '50060';
  const httpPort = process.env.HTTP_PORT ?? '8060';
  const databaseUrl = process.env.DATABASE_URL ?? '';

  // NOTE: xstockstrat-config does NOT subscribe to itself.
  // It is the config source of truth. All other services subscribe to it.
  log.info('xstockstrat-config is the config source — no self-subscription');

  const pool = new Pool({ connectionString: databaseUrl });
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

  // ── Connect-RPC HTTP server (browser + external clients, port 8060) ────
  const connectHandler = connectNodeAdapter({ routes: createConnectRouter(configImpl) });
  const httpServer = http.createServer((req, res) => {
    // Add CORS headers for browser clients
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Connect-Protocol-Version, Connect-Timeout-Ms');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'xstockstrat-config' }));
      return;
    }
    propagationStore.run(extractFromHttpRequest(req), () => connectHandler(req, res));
  });

  httpServer.listen(parseInt(httpPort, 10), () => {
    log.info(`Config Connect-RPC HTTP service listening on port ${httpPort}`);
  });

  const shutdown = () => {
    log.info('Shutting down config service...');
    httpServer.close();
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
