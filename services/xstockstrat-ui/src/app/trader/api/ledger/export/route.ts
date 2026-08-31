import { NextRequest, NextResponse } from 'next/server';
import { Code, ConnectError } from '@connectrpc/connect';
import { timestampDate, timestampFromDate } from '@bufbuild/protobuf/wkt';
import type { LedgerEvent } from '@xstockstrat/proto/ledger/v1/ledger_pb';
import { ledgerClient } from '@/lib/connectClients';
import { getSessionFromRequest, rolesToAccessScope, generateTraceId } from '@/lib/auth';
import { HEADER_USER_ID, HEADER_ACCESS_SCOPE, HEADER_TRACE_ID } from '@/lib/headers';

/**
 * Ledger event export (feature 021) — session-gated BFF streaming route on the /trader segment.
 * Streams the caller's own ledger events (NDJSON default, `?format=csv` for CSV) from the ledger
 * `ExportEvents` server-streaming RPC. Not a Connect-router entry: the browser saves the raw byte
 * stream. Errors are mapped explicitly (NOT connectCodeToHttp): the ledger returns
 * FAILED_PRECONDITION when disabled (→ 403, AC-10) and INVALID_ARGUMENT over-window (→ 400, AC-5),
 * whereas connectCodeToHttp maps FailedPrecondition→400.
 */

// AC-8: the exact column set surfaced per event.
const CSV_HEADER =
  'event_id,event_type,occurred_at,source_service,correlation_id,sequence,stream_key,user_id,payload';

interface ExportRow {
  event_id: string;
  event_type: string;
  occurred_at: string;
  source_service: string;
  correlation_id: string;
  sequence: number;
  stream_key: string;
  user_id: string;
  payload: unknown;
}

function toRow(ev: LedgerEvent): ExportRow {
  return {
    event_id: ev.eventId,
    event_type: ev.eventType,
    // protobuf-es v2: occurredAt is a Timestamp; payload is already a plain JsonObject.
    occurred_at: ev.occurredAt ? timestampDate(ev.occurredAt).toISOString() : '',
    source_service: ev.sourceService,
    correlation_id: ev.correlationId,
    sequence: Number(ev.sequence),
    stream_key: ev.streamKey,
    user_id: ev.userId,
    payload: ev.payload ?? {},
  };
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function toCsvLine(r: ExportRow): string {
  return [
    r.event_id,
    r.event_type,
    r.occurred_at,
    r.source_service,
    r.correlation_id,
    String(r.sequence),
    r.stream_key,
    r.user_id,
    JSON.stringify(r.payload ?? {}),
  ]
    .map((v) => csvEscape(String(v)))
    .join(',');
}

function mapError(err: unknown): NextResponse {
  if (err instanceof ConnectError) {
    if (err.code === Code.FailedPrecondition) {
      return NextResponse.json({ error: err.rawMessage }, { status: 403 });
    }
    if (err.code === Code.InvalidArgument) {
      return NextResponse.json({ error: err.rawMessage }, { status: 400 });
    }
    if (err.code === Code.Unauthenticated) {
      return NextResponse.json({ error: err.rawMessage }, { status: 401 });
    }
  }
  return NextResponse.json(
    { error: err instanceof Error ? err.message : 'Unknown error' },
    { status: 500 },
  );
}

export async function GET(req: NextRequest) {
  // AC-6: reject unauthenticated before any ledger call.
  const claims = await getSessionFromRequest(req);
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const start = searchParams.get('start');
  const end = searchParams.get('end');
  const eventType = searchParams.get('event_type') ?? '';
  const format = searchParams.get('format') ?? 'ndjson';

  // Propagate the three identity headers (C-03) — replicated here (a raw route has no Connect
  // HandlerContext for backendHeaders): the ledger scopes the export to this x-user-id.
  const headers = {
    [HEADER_USER_ID]: claims.user_id,
    [HEADER_ACCESS_SCOPE]: String(rolesToAccessScope(claims.roles)),
    [HEADER_TRACE_ID]: req.headers.get(HEADER_TRACE_ID) ?? generateTraceId(),
  };

  const request = {
    ...(start ? { start: timestampFromDate(new Date(start)) } : {}),
    ...(end ? { end: timestampFromDate(new Date(end)) } : {}),
    eventType,
  };

  // Pull the first page BEFORE returning a Response so the config-gate (FAILED_PRECONDITION → 403)
  // and window-bound (INVALID_ARGUMENT → 400) errors are mapped pre-stream, not swallowed mid-body.
  const iterator = ledgerClient.exportEvents(request, { headers })[Symbol.asyncIterator]();
  let first: IteratorResult<{ events: LedgerEvent[] }>;
  try {
    first = await iterator.next();
  } catch (err) {
    return mapError(err);
  }

  const isCsv = format === 'csv';
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        if (isCsv) controller.enqueue(encoder.encode(CSV_HEADER + '\n'));
        let result = first;
        while (!result.done) {
          for (const ev of result.value.events) {
            const row = toRow(ev);
            const line = isCsv ? toCsvLine(row) : JSON.stringify(row);
            controller.enqueue(encoder.encode(line + '\n'));
          }
          result = await iterator.next();
        }
        controller.close();
      } catch (err) {
        // Bytes may already be in flight — terminate the stream rather than change status.
        controller.error(err);
      }
    },
  });

  return new NextResponse(stream, {
    status: 200,
    headers: {
      'Content-Type': isCsv ? 'text/csv' : 'application/x-ndjson',
      'Content-Disposition': `attachment; filename="ledger-events.${isCsv ? 'csv' : 'ndjson'}"`,
    },
  });
}
