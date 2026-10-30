import { initTelemetry } from './telemetry';
initTelemetry();

import * as grpc from '@grpc/grpc-js';
import * as mtls from './mtls';
import { resolveDbConnection } from './dbTls';
import { IdentityServiceService } from '@xstockstrat/proto/identity/v1/identity';
import { Pool } from 'pg';
import { ConfigWatcher } from './services/configWatcher';
import { IdentityServiceImpl } from './grpc/identityServiceImpl';
import { createLedgerAudit } from './grpc/ledgerAudit';
import { getLogger } from './services/logger';

const log = getLogger('identity:server');

async function main() {
  const dbConn = resolveDbConnection(process.env.DATABASE_URL, process.env.DATABASE_CA_CERT);
  if (dbConn.ssl !== false) {
    log.info('db-tls: verifying server cert against DATABASE_CA_CERT');
  }
  const grpcPort = process.env.GRPC_PORT ?? '50058';
  const configEndpoint = process.env.CONFIG_ENDPOINT ?? 'xstockstrat-config:50060';

  const configWatcher = new ConfigWatcher(configEndpoint, 'identity');
  await configWatcher.waitForSnapshot(90_000);
  log.info('Config snapshot received');

  const pool = new Pool({
    connectionString: dbConn.connectionString,
    // Cap pool size to stay within the shared DB connection budget. Override with DB_POOL_MAX.
    max: parseInt(process.env.DB_POOL_MAX ?? '2', 10),
    ssl: dbConn.ssl,
  });
  await pool.query('SELECT 1');
  log.info('Database connected');

  // Best-effort ledger audit for admin user-management mutations.
  const ledgerAudit = createLedgerAudit();
  const identityImpl = new IdentityServiceImpl(pool, configWatcher, ledgerAudit);

  // ── gRPC server (internal service-to-service) ──────────────
  const grpcServer = new grpc.Server();
  grpcServer.addService(
    IdentityServiceService,
    identityImpl as unknown as grpc.UntypedServiceImplementation,
  );

  grpcServer.bindAsync(
    `0.0.0.0:${grpcPort}`,
    mtls.serverCredentials(),
    (err, port) => {
      if (err) { log.error('Bind failed', { error: err.message }); process.exit(1); }
      grpcServer.start();
      log.info(`Identity gRPC service listening on port ${port}`);
    }
  );

  const shutdown = () => {
    grpcServer.tryShutdown(() => { pool.end(); process.exit(0); });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
