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

export const MOCK_PORT = 9091;

// Canned responses keyed by Connect-RPC path: /<package>.<Service>/<Method>
const RESPONSES: Record<string, object> = {
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
};

let server: http.Server | null = null;

export function startMockBackend(): Promise<void> {
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      const path = req.url ?? '/';
      const body = RESPONSES[path] ?? {};
      res.writeHead(200, {
        'Content-Type': 'application/connect+json',
        'Access-Control-Allow-Origin': '*',
      });
      const jsonBytes = Buffer.from(JSON.stringify(body));
      const envelope = Buffer.alloc(5 + jsonBytes.length);
      envelope[0] = 0; // flags: no compression, regular message
      envelope.writeUInt32BE(jsonBytes.length, 1); // 4-byte BE message length
      jsonBytes.copy(envelope, 5);
      res.end(envelope);
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
