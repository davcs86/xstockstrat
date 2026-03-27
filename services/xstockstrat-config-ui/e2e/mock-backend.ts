/**
 * Lightweight mock Connect-RPC HTTP server for xstockstrat-config-ui tests.
 *
 * Port 9093 — pointed at by CONFIG_ENDPOINT in playwright.config.ts.
 *
 * The /api/config route calls ListKeys and SetConfig on the config service.
 * The mock returns a realistic set of keys including one secret, matching the
 * exact ConfigKey interface the [namespace]/page.tsx component expects.
 */
import * as http from 'http';

export const MOCK_PORT = 9093;

// Default keys returned for any namespace
const MOCK_KEYS = [
  {
    key: 'platform.log_level',
    description: 'Global log level for all services',
    defaultValue: 'info',
    isSecret: false,
    consumingService: 'all',
    environment: 1,   // dev
    tradingMode: 0,   // all modes
  },
  {
    key: 'platform.maintenance_mode',
    description: 'Halts all trading operations when true',
    defaultValue: 'false',
    isSecret: false,
    consumingService: 'all',
    environment: 1,
    tradingMode: 0,
  },
  {
    key: 'secret.alpaca_api_key',
    description: 'Alpaca API key for live trading',
    defaultValue: '[secret]',
    isSecret: true,
    consumingService: 'trading',
    environment: 2,   // production
    tradingMode: 2,   // live
  },
];

const RESPONSES: Record<string, object> = {
  '/xstockstrat.config.v1.ConfigService/ListKeys': { keys: MOCK_KEYS },
  '/xstockstrat.config.v1.ConfigService/SetConfig': {},
};

let server: http.Server | null = null;

export function startMockBackend(): Promise<void> {
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      const path = req.url ?? '/';
      const body = RESPONSES[path] ?? {};
      res.writeHead(200, {
        'Content-Type': 'application/json',
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
