/**
 * Lightweight mock Connect-RPC HTTP server for xstockstrat-trader tests.
 *
 * Handles POST requests to Connect-RPC method paths and returns canned
 * JSON responses shaped to match what the real backend services return.
 * Field names use snake_case matching proto field names (the Go services
 * use UseProtoNames: true in their Connect-RPC JSON encoding).
 *
 * Port 9091 — pointed at by TRADING_HTTP_ENDPOINT, PORTFOLIO_HTTP_ENDPOINT,
 * and NOTIFY_HTTP_ENDPOINT in playwright.config.ts webServer.env.
 */
import * as http from 'http';
import { SignJWT } from 'jose';

export const MOCK_PORT = 9091;

const TEST_JWT_SECRET = 'test-jwt-secret-for-e2e-tests-min32c';

// Canned responses keyed by Connect-RPC path: /<package>.<Service>/<Method>
let RESPONSES: Record<string, object> = {
  '/xstockstrat.trading.v1.TradingService/PlaceOrder': {
    order_id: 'mock-order-001',
    status: 'ORDER_STATUS_FILLED',
    trading_mode: 1,
  },
  '/xstockstrat.trading.v1.TradingService/ListOrders': {
    orders: [
      {
        order_id: 'mock-order-001',
        symbol: 'AAPL',
        side: 'ORDER_SIDE_BUY',
        qty: 10,
        filled_qty: 10,
        filled_avg_price: '175.50',
        status: 'ORDER_STATUS_FILLED',
        trading_mode: 1,
      },
      {
        order_id: 'mock-order-002',
        symbol: 'TSLA',
        side: 'ORDER_SIDE_SELL',
        qty: 5,
        filled_qty: 0,
        filled_avg_price: '0',
        status: 'ORDER_STATUS_NEW',
        trading_mode: 1,
      },
    ],
  },
  '/xstockstrat.portfolio.v1.PortfolioService/GetPortfolio': {
    equity: '52341.89',
    cash: '18200.00',
    buying_power: '36400.00',
    day_pnl: '341.89',
    day_pnl_pct: '0.0066',
    total_pnl: '2341.89',
    positions: [
      { symbol: 'AAPL', unrealized_pnl: '215.30' },
      { symbol: 'MSFT', unrealized_pnl: '-87.40' },
    ],
  },
  '/xstockstrat.notify.v1.NotifyService/ListAlerts': {
    alerts: [
      {
        alert_id: 'alert-001',
        severity: 'ALERT_SEVERITY_WARNING',
        category: 'RISK',
        title: 'Position limit approaching',
        body: 'AAPL position is at 80% of max allowed.',
        source_service: 'trading',
      },
      {
        alert_id: 'alert-002',
        severity: 'ALERT_SEVERITY_CRITICAL',
        category: 'SYSTEM',
        title: 'Order rejected',
        body: 'Insufficient buying power for TSLA order.',
        source_service: 'trading',
      },
    ],
  },
  '/xstockstrat.trading.v1.TradingService/ListBrokerAccounts': {
    accounts: [
      {
        account_id: 'alpaca-default',
        display_name: 'Alpaca Paper',
        broker_type: 1,
        is_paper: true,
        is_active: true,
      },
      {
        account_id: 'ibkr-001',
        display_name: 'IBKR Paper',
        broker_type: 2,
        is_paper: true,
        is_active: true,
      },
    ],
  },
  '/xstockstrat.trading.v1.TradingService/RegisterBrokerAccount': {
    account: {
      account_id: 'new-account-001',
      display_name: 'New Account',
      broker_type: 1,
      is_paper: true,
      is_active: true,
    },
  },
  '/xstockstrat.trading.v1.TradingService/DeregisterBrokerAccount': {},
  '/xstockstrat.portfolio.v1.PortfolioService/ListPortfolios': {
    portfolios: [
      {
        portfolio_id: 'port-001',
        account_id: 'alpaca-default',
        equity: '50000.00',
        cash: '20000.00',
        buying_power: '40000.00',
        day_pnl: '150.00',
        day_pnl_pct: '0.003',
        total_pnl: '1500.00',
        positions: [{ symbol: 'AAPL', unrealized_pnl: '100.00' }],
      },
    ],
  },
  '/xstockstrat.marketdata.v1.MarketDataService/GetBars': {
    bars: [
      {
        symbol: 'AAPL',
        time: { seconds: 1716422400, nanos: 0 },
        open: 188.0,
        high: 190.5,
        low: 187.2,
        close: 189.8,
        volume: 45000000,
        vwap: 189.1,
        trade_count: 120000,
        timeframe: '1Day',
        source: 'alpaca',
      },
      {
        symbol: 'AAPL',
        time: { seconds: 1716508800, nanos: 0 },
        open: 189.8,
        high: 192.0,
        low: 188.5,
        close: 191.5,
        volume: 38000000,
        vwap: 190.5,
        trade_count: 98000,
        timeframe: '1Day',
        source: 'alpaca',
      },
    ],
    page: { next_page_token: '', total_count: 2 },
  },
  '/xstockstrat.marketdata.v1.MarketDataService/ListAssets': {
    assets: [
      { symbol: 'AAPL', exchange: 'NASDAQ', asset_class: 'us_equity' },
      { symbol: 'MSFT', exchange: 'NASDAQ', asset_class: 'us_equity' },
      { symbol: 'TSLA', exchange: 'NASDAQ', asset_class: 'us_equity' },
    ],
  },
};

let server: http.Server | null = null;

export async function startMockBackend(): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const secret = new TextEncoder().encode(TEST_JWT_SECRET);
  const testAccessToken = await new SignJWT({
    user_id: 'test-user-001',
    email: 'test@example.com',
    roles: [],
    issued_at: now,
    expires_at: now + 3600,
  }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(secret);

  const identityPayload = {
    access_token: testAccessToken,
    refresh_token: 'test-refresh-token',
    claims: { user_id: 'test-user-001', email: 'test@example.com', roles: [] },
  };
  RESPONSES['/xstockstrat.identity.v1.IdentityService/AuthenticateUser'] = identityPayload;
  RESPONSES['/xstockstrat.identity.v1.IdentityService/RefreshToken'] = identityPayload;
  RESPONSES['/xstockstrat.identity.v1.IdentityService/RevokeToken'] = { success: true };

  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      const path = req.url ?? '/';
      const body = RESPONSES[path] ?? {};
      res.writeHead(200, {
        'Content-Type': 'application/connect+json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify(body));
    });

    server.on('error', reject);
    server.listen(MOCK_PORT, '127.0.0.1', () => resolve());
  });
}

export function stopMockBackend(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server) return resolve();
    server.close((err) => (err ? reject(err) : resolve()));
    server = null;
  });
}
