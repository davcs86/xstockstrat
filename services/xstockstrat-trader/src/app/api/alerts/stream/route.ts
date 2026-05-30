/**
 * SSE endpoint — proxies xstockstrat-notify alerts to the browser via
 * Server-Sent Events. Subscribes to the notify gRPC StreamAlerts server-stream
 * and forwards each alert as it arrives. The browser AlertStream component
 * reconnects automatically via EventSource.
 */
import { NextRequest, NextResponse } from 'next/server';
import { ConnectError, Code } from '@connectrpc/connect';
import { notifyClient } from '@/lib/connectClients';
import { getSessionFromRequest, rolesToAccessScope, generateTraceId } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const claims = await getSessionFromRequest(request);
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const propagationHeaders = new Headers({
    'x-user-id': claims.user_id,
    'x-access-scope': String(rolesToAccessScope(claims.roles)),
    'x-trace-id': request.headers.get('x-trace-id') ?? generateTraceId(),
  });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (payload: string) => {
        try {
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        } catch {}
      };
      const close = () => {
        if (closed) return;
        closed = true;
        try { controller.close(); } catch {}
      };

      // Immediately send a keep-alive comment so the browser opens the stream.
      send(':ok');

      // Abort the upstream gRPC stream on client disconnect or periodic recycle.
      const abortController = new AbortController();

      // Recycle the connection after 10 minutes — EventSource auto-reconnects.
      const timeoutId = setTimeout(() => {
        abortController.abort();
        close();
      }, 10 * 60 * 1000);

      request.signal.addEventListener('abort', () => {
        clearTimeout(timeoutId);
        abortController.abort();
        close();
      });

      try {
        const alerts = notifyClient.streamAlerts(
          {
            userId: claims.user_id,
            categories: [],
            severities: [],
            includeAcknowledged: false,
          },
          { headers: propagationHeaders, signal: abortController.signal },
        );
        for await (const a of alerts) {
          const alert = a as any;
          send(
            JSON.stringify({
              alert_id: alert.alertId ?? '',
              // severity is already the numeric AlertSeverity enum (1–4)
              severity: alert.severity ?? 1,
              category: alert.category ?? '',
              title: alert.title ?? '',
              body: alert.body ?? '',
              source_service: alert.sourceService ?? '',
            }),
          );
        }
      } catch (err) {
        // Aborts (client disconnect / recycle) surface as Canceled — expected.
        if (!(err instanceof ConnectError) || err.code !== Code.Canceled) {
          send(JSON.stringify({ error: 'alert stream interrupted' }));
        }
      } finally {
        clearTimeout(timeoutId);
        close();
      }
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
