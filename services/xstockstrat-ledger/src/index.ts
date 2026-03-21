import { initTelemetry } from './telemetry';
initTelemetry();

import * as grpc from '@grpc/grpc-js';
import * as http from 'http';
import { getLogger } from './services/logger';
import { ConfigWatcher } from './services/configWatcher';
import { LedgerServiceImpl } from './grpc/ledgerServiceImpl';
import { createLedgerServiceDefinition } from './grpc/serviceDefinition';
import { createConnectRouter } from './connect/connectRouter';
import { connectNodeAdapter } from '@connectrpc/connect-node';
import { Pool } from 'pg';
import { createN8nRouter } from './n8n/webhookRouter';

const log = getLogger('ledger:server');

async function main() {
  const configEndpoint = process.env.CONFIG_ENDPOINT ?? 'xstockstrat-config:50060';
  const grpcPort = process.env.GRPC_PORT ?? '50057';
  const httpPort = process.env.HTTP_PORT ?? '8057';
  const databaseUrl = process.env.DATABASE_URL ?? '';

  // Subscribe to config before accepting traffic
  log.info(`Connecting to config service at ${configEndpoint}`);
  const configWatcher = new ConfigWatcher(configEndpoint, 'ledger');
  await configWatcher.waitForSnapshot(10_000);
  log.info('Config snapshot received');

  // TimescaleDB connection pool
  const pool = new Pool({ connectionString: databaseUrl });
  await pool.query('SELECT 1'); // verify connectivity
  log.info('Database connected');

  const ledgerImpl = new LedgerServiceImpl(pool, configWatcher);

  // ── gRPC server (internal service-to-service, port 50057) ──────────────
  const grpcServer = new grpc.Server();
  grpcServer.addService(createLedgerServiceDefinition(), ledgerImpl as unknown as grpc.UntypedServiceImplementation);

  grpcServer.bindAsync(
    `0.0.0.0:${grpcPort}`,
    grpc.ServerCredentials.createInsecure(),
    (err, port) => {
      if (err) {
        log.error('Failed to bind gRPC server', { error: err.message });
        process.exit(1);
      }
      grpcServer.start();
      log.info(`Ledger gRPC service listening on port ${port}`);
    }
  );

  // ── Connect-RPC HTTP server (browser + external clients, port 8057) ────
  const connectHandler = connectNodeAdapter({ routes: createConnectRouter(ledgerImpl) });
  const n8nRouter = createN8nRouter(ledgerImpl);
  const httpServer = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Connect-Protocol-Version, Connect-Timeout-Ms');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'xstockstrat-ledger' }));
      return;
    }
    if (req.url?.startsWith('/webhooks/n8n/')) { n8nRouter(req, res); return; }
    connectHandler(req, res);
  });
  httpServer.listen(parseInt(httpPort, 10), () => {
    log.info(`Ledger Connect-RPC HTTP service listening on port ${httpPort}`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    log.info('Shutting down ledger service...');
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
  console.error('Fatal error:', err);
  process.exit(1);
});
