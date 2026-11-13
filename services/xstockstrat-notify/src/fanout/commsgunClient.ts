import { networkErrorClass } from './webhookWorker';

export type CommsgunSendResult =
  | { kind: 'delivered' }
  | {
      kind: 'retry';
      errorClass: string;
      outcome: 'http_error' | 'timeout' | 'error';
      retryAfterSeconds: number | null;
    }
  | { kind: 'permanent'; errorClass: string };

export interface CommsgunRequest {
  url: string;
  appId: string;
  key: string;
  alertId: string;
  body: string;
}

interface ClientConfig {
  getInt(key: string, def?: number): number;
}

const PERMANENT_OWN_CLASS = new Set([401, 403, 409, 413, 422]);

// Fixed key order and no sender: every retry of one row must be byte-identical for commsgun.
export function commsgunBody(row: { recipient: string; subject: string; text: string }): string {
  return JSON.stringify({ channel: 'email', to: [row.recipient], subject: row.subject, text: row.text });
}

/** 2xx delivered; 429 and 5xx retried; everything else ends the row. Classes only, never text. */
export function classifyStatus(status: number, opaqueRedirect = false): CommsgunSendResult {
  if (status >= 200 && status < 300) return { kind: 'delivered' };
  if (status === 429) return { kind: 'retry', errorClass: '429', outcome: 'http_error', retryAfterSeconds: null };
  if (status >= 500 && status < 600) {
    return { kind: 'retry', errorClass: '5xx', outcome: 'http_error', retryAfterSeconds: null };
  }
  if (PERMANENT_OWN_CLASS.has(status)) return { kind: 'permanent', errorClass: String(status) };
  if (opaqueRedirect || (status >= 300 && status < 400)) return { kind: 'permanent', errorClass: '3xx' };
  if (status >= 400 && status < 500) return { kind: 'permanent', errorClass: '4xx' };
  return { kind: 'permanent', errorClass: 'other' };
}

// commsgun sends Retry-After as integer seconds; any other form is ignored.
export function parseRetryAfter(value: string | null): number | null {
  const text = value?.trim() ?? '';
  return /^\d{1,9}$/.test(text) ? Number(text) : null;
}

export class CommsgunClient {
  constructor(private readonly config: ClientConfig) {}

  /** One enqueue POST. Never throws; the URL, the key and error text never reach the result. */
  async send(request: CommsgunRequest, controller: AbortController): Promise<CommsgunSendResult> {
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs());
    try {
      // redirect 'manual': a followed redirect would carry the bearer key to another host.
      const res = await fetch(request.url, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'Content-Type': 'application/json',
          'X-Commsgun-App': request.appId,
          Authorization: `Bearer ${request.key}`,
          'Idempotency-Key': `alert:${request.alertId}`,
        },
        body: request.body,
        signal: controller.signal,
      });
      void res.body?.cancel().catch(() => {});
      const result = classifyStatus(res.status, res.type === 'opaqueredirect');
      if (result.kind === 'retry') result.retryAfterSeconds = parseRetryAfter(res.headers.get('retry-after'));
      return result;
    } catch (error: any) {
      // The error text may quote the URL: only its class is kept.
      if (error?.name === 'AbortError') {
        return { kind: 'retry', errorClass: 'timeout', outcome: 'timeout', retryAfterSeconds: null };
      }
      return { kind: 'retry', errorClass: networkErrorClass(error), outcome: 'error', retryAfterSeconds: null };
    } finally {
      clearTimeout(timer);
    }
  }

  private requestTimeoutMs(): number {
    const v = this.config.getInt('commsgun.request_timeout_seconds', 10);
    return Math.min(60, Math.max(1, v > 0 ? v : 10)) * 1000;
  }
}
