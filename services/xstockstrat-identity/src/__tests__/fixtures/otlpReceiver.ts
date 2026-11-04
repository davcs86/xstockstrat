import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export type Received = { path: string; auth: string | undefined; body: string };

/**
 * In-process OTLP/HTTP receiver. It accepts /v1/traces, /v1/metrics and /v1/logs and records each
 * request; with rejectTracesAfterFirst the first trace export succeeds and later ones get a 400.
 */
export function startOtlpReceiver(opts: { rejectTracesAfterFirst?: boolean } = {}) {
  const received: Received[] = [];
  let traceRequests = 0;
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      received.push({
        path: req.url ?? '',
        auth: req.headers.authorization,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      if (req.url?.endsWith('/v1/traces')) {
        const reject = opts.rejectTracesAfterFirst && traceRequests++ > 0;
        res.writeHead(reject ? 400 : 200).end();
      } else if (req.url?.endsWith('/v1/metrics') || req.url?.endsWith('/v1/logs')) {
        res.writeHead(200).end('{}');
      } else {
        res.writeHead(404).end();
      }
    });
  });
  return {
    received,
    at: (suffix: string) => received.filter((r) => r.path.endsWith(suffix)),
    async listen(): Promise<number> {
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      return (server.address() as AddressInfo).port;
    },
    close() {
      server.closeAllConnections();
      server.close();
    },
  };
}

export async function waitFor(cond: () => boolean, ms = 5000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return cond();
}
