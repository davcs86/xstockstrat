'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { notifyClient } from '@/lib/browserClients/notifyClient';
import type { Alert } from '@xstockstrat/proto/notify/v1/notify_pb';
import { Bell, BellOff } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '../ui/sheet';
import { Separator } from '../ui/separator';
import { CardNotice } from './CardNotice';
import {
  ALERTS_QUERY_KEY,
  ALERT_UNREAD_COUNT_KEY,
  UNREAD_PAGE_SIZE,
  drainUnread,
  mergeUnread,
  pruneStreamed,
  severityLabel,
  severityVariant,
} from '@/lib/alertShared';
import { useReconnectingStream } from '@/hooks/useReconnectingStream';
import { useInvalidatingMutation } from '@/hooks/useInvalidatingMutation';

export function AlertStream() {
  const queryClient = useQueryClient();
  const [streamed, setStreamed] = useState<{ alert: Alert; seq: number }[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());
  const seqRef = useRef(0);
  const [pending, setPending] = useState(false);
  const [markNotice, setMarkNotice] = useState<null | 'capped' | 'error'>(null);

  // pruneStreamed needs the sequence of the fetch that produced the result.
  const unreadQuery = useQuery({
    queryKey: ALERT_UNREAD_COUNT_KEY,
    queryFn: async () => {
      const seq = ++seqRef.current;
      const res = await notifyClient.listAlerts({ unreadOnly: true, limit: UNREAD_PAGE_SIZE });
      return { alerts: res.alerts, seq };
    },
  });
  const stored = unreadQuery.data?.alerts ?? [];
  const fetchFailed = unreadQuery.isError;

  useEffect(() => {
    const data = unreadQuery.data;
    if (!data) return;
    const resultIds = new Set(data.alerts.map((a) => a.alertId));
    setStreamed((prev) => pruneStreamed(prev, resultIds, data.seq));
  }, [unreadQuery.data]);

  const refreshUnread = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ALERT_UNREAD_COUNT_KEY }),
    [queryClient],
  );

  const markReadMutation = useInvalidatingMutation(
    (alertIds: string[]) => notifyClient.markAlertRead({ alertIds }),
    [ALERTS_QUERY_KEY],
    { meta: { errorHandled: true } },
  );

  // A reconnect may re-deliver an alert; dedupe on alertId so React keys stay unique.
  const { disconnected } = useReconnectingStream<Alert>(
    'alerts',
    (signal) =>
      notifyClient.streamAlerts(
        { categories: [], severities: [], includeAcknowledged: false },
        { signal },
      ),
    (alert) => {
      const seq = seqRef.current;
      setStreamed((prev) =>
        prev.some((e) => e.alert.alertId === alert.alertId)
          ? prev
          : [{ alert, seq }, ...prev].slice(0, UNREAD_PAGE_SIZE),
      );
    },
  );

  const merged = mergeUnread(
    stored,
    streamed.map((e) => e.alert),
    readIds,
  );
  const unread = merged.length;
  const hasHighSeverity = merged.some((a) => a.severity >= 3);

  const markRead = async (alert: Alert) => {
    setPending(true);
    setMarkNotice(null);
    try {
      await markReadMutation.mutateAsync([alert.alertId]);
      setReadIds((prev) => new Set(prev).add(alert.alertId));
    } catch {
      setMarkNotice('error');
      void refreshUnread();
    }
    setPending(false);
  };

  const clearAll = async () => {
    setPending(true);
    setMarkNotice(null);
    const result = await drainUnread({
      list: (req) => notifyClient.listAlerts(req),
      mark: (req) => notifyClient.markAlertRead(req),
      cutoff: merged[0],
    });
    setReadIds((prev) => new Set([...prev, ...result.markedIds]));
    setPending(false);
    if (result.outcome !== 'done') setMarkNotice(result.outcome);
    await queryClient.invalidateQueries({ queryKey: ALERTS_QUERY_KEY });
  };

  return (
    <Sheet
      onOpenChange={(open) => {
        if (open) void refreshUnread();
      }}
    >
      {disconnected && (
        <span
          data-testid="alert-stream-disconnected"
          className="sr-only sm:not-sr-only text-xs text-destructive"
        >
          Live alerts disconnected
        </span>
      )}
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="relative"
          aria-label={disconnected ? 'Alerts — live alerts disconnected' : 'Alerts'}
        >
          {disconnected ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
          {unread > 0 && (
            <Badge
              variant={hasHighSeverity ? 'destructive' : 'default'}
              className="absolute -top-1 -right-1 h-4 min-w-4 justify-center px-1 text-[10px]"
            >
              {unread > 9 ? '9+' : unread}
            </Badge>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[360px] sm:w-[400px]">
        <SheetHeader>
          <div className="flex items-center justify-between pr-6">
            <SheetTitle>Alerts</SheetTitle>
            {merged.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void clearAll()}
                disabled={pending}
                className="text-muted-foreground text-xs h-7"
              >
                Clear all
              </Button>
            )}
          </div>
        </SheetHeader>
        <Separator className="my-4" />
        <div className="overflow-y-auto max-h-[calc(100vh-8rem)] space-y-2">
          {(fetchFailed || markNotice === 'error') && (
            <CardNotice variant="error">
              {markNotice === 'error' ? 'Could not mark alerts read' : 'Could not load alerts'}
            </CardNotice>
          )}
          {markNotice === 'capped' && (
            <CardNotice variant="muted">Some alerts are still unread — Clear all again</CardNotice>
          )}
          {merged.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Bell className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-sm">No alerts</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {merged.map((a) => (
                <li
                  key={a.alertId}
                  className="rounded-lg border border-border bg-card p-3 space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <Badge variant={severityVariant[a.severity] ?? 'info'}>
                      {severityLabel[a.severity]}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{a.category}</span>
                  </div>
                  <p className="text-sm font-medium">{a.title}</p>
                  {a.body && <p className="text-xs text-muted-foreground">{a.body}</p>}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => void markRead(a)}
                    disabled={pending}
                    aria-label={`Mark read: ${a.title}`}
                  >
                    Mark read
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
