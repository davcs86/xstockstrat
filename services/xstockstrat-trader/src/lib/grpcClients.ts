/**
 * lib/grpcClients.ts
 * Server-side gRPC clients for xstockstrat-trader.
 * Used inside Next.js Route Handlers (app/api/**) — NOT in browser components.
 */
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';

const PROTO_DIR = path.resolve(process.cwd(), '../../packages/proto');

function loadProto(protoPath: string) {
  const packageDef = protoLoader.loadSync(path.join(PROTO_DIR, protoPath), {
    keepCase: false,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  return grpc.loadPackageDefinition(packageDef) as any;
}

// ── Trading Service client ──────────────────────────────────────────────────
const tradingProto = loadProto('trading/v1/trading.proto');
export const tradingClient = new tradingProto.xstockstrat.trading.v1.TradingService(
  process.env.TRADING_ENDPOINT ?? 'xstockstrat-trading:50051',
  grpc.credentials.createInsecure(),
);

// ── Portfolio Service client ────────────────────────────────────────────────
const portfolioProto = loadProto('portfolio/v1/portfolio.proto');
export const portfolioClient = new portfolioProto.xstockstrat.portfolio.v1.PortfolioService(
  process.env.PORTFOLIO_ENDPOINT ?? 'xstockstrat-portfolio:50052',
  grpc.credentials.createInsecure(),
);

// ── Notify Service client ───────────────────────────────────────────────────
const notifyProto = loadProto('notify/v1/notify.proto');
export const notifyClient = new notifyProto.xstockstrat.notify.v1.NotifyService(
  process.env.NOTIFY_ENDPOINT ?? 'xstockstrat-notify:50059',
  grpc.credentials.createInsecure(),
);

// ── Identity Service client ─────────────────────────────────────────────────
const identityProto = loadProto('identity/v1/identity.proto');
export const identityClient = new identityProto.xstockstrat.identity.v1.IdentityService(
  process.env.IDENTITY_ENDPOINT ?? 'xstockstrat-identity:50058',
  grpc.credentials.createInsecure(),
);
