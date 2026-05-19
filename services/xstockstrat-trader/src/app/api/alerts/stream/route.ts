/**
 * SSE endpoint — proxies xstockstrat-notify alerts to the browser via
 * Server-Sent Events. Polls ListAlerts every 5 seconds and streams new
 * alerts as they arrive. The browser AlertStream component reconnects
 * automatically via EventSource.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest, rolesToAccessScope, generateTraceId } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const NOTIFY_BASE_URL =
  process.env.NOTIFY_HTTP_ENDPOINT ?? 'http://xstockstrat-notify:8059';

const SEVERITY_MAP: Record<string, number> = {
  ALERT_SEVERITY_INFO: 1,
  ALERT_SEVERITY_WARNING: 2,
  ALERT_SEVERITY_ERROR: 3,
  ALERT_SEVERITY_CRITICAL: 4,
};

export async function GET(request: NextRequest) {
  const claims = await getSessionFromRequest(request);
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const accessScope = String(rolesToAccessScope(claims.roles));
  const traceId = request.headers.get('x-trace-id') ?? generateTraceId();
  const propagationHeaders = {
    'x-user-id': claims.user_id,
    'x-access-scope': accessScope,
    'x-trace-id': traceId,
  };

  const listAlerts = async (): Promise<any[]> => {
    const res = await fetch(
      `${NOTIFY_BASE_URL}/xstockstrat.notify.v1.NotifyService/ListAlerts`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...propagationHeaders },
        body: JSON.stringify({
          userId: claims.user_id,
          categories: [],
          limit: 20,
          pageToken: '',
        }),
        // Short timeout to avoid blocking the polling loop
        signal: AbortSignal.timeout(4000),
      },
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.alerts ?? [];
  };

  const encoder = new TextEncoder();
  const seenIds = new Set<string>();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: string) => {
        try {
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        } catch {}
      };

      // Immediately send a keep-alive comment
      send(':ok');

      const poll = async () => {
        try {
          const alerts = await listAlerts();
          for (const a of alerts) {
            const id = a.alertId ?? a.alert_id;
            if (id && !seenIds.has(id)) {
              seenIds.add(id);
              send(
                JSON.stringify({
                  alert_id: id,
                  severity: SEVERITY_MAP[a.severity] ?? 1,
                  category: a.category ?? '',
                  title: a.title ?? '',
                  body: a.body ?? '',
                  source_service: a.sourceService ?? a.source_service ?? '',
                }),
              );
            }
          }
          // Keep seenIds bounded
          if (seenIds.size > 500) seenIds.clear();
        } catch {}
      };

      await poll();

      // Poll every 5 seconds while connected
      const intervalId = setInterval(poll, 5000);

      // Close after 10 minutes — EventSource will automatically reconnect
      const timeoutId = setTimeout(() => {
        clearInterval(intervalId);
        try { controller.close(); } catch {}
      }, 10 * 60 * 1000);

      // Clean up if the request is aborted (client disconnected)
      request.signal.addEventListener('abort', () => {
        clearInterval(intervalId);
        clearTimeout(timeoutId);
        try { controller.close(); } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
