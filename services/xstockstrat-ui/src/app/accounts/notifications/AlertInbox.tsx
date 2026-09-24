'use client';
import { useCallback, useEffect, useState } from 'react';
import type { Alert } from '@xstockstrat/proto/notify/v1/notify_pb';
import { notifyClient } from '@/lib/browserClients/notifyClient';
import { severityLabel, severityVariant } from '@/lib/alertShared';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';

function formatWhen(alert: Alert): string {
  const s = alert.createdAt?.seconds;
  if (s == null) return '';
  return new Date(Number(s) * 1000).toLocaleString();
}

export function AlertInbox() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refetch = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await notifyClient.listAlerts({});
      setAlerts(res.alerts);
      setUnreadCount(res.unreadCount);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const markRead = useCallback(
    async (alertIds: string[]) => {
      if (alertIds.length === 0) return;
      try {
        await notifyClient.markAlertRead({ alertIds });
        await refetch();
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [refetch],
  );

  const unreadIds = alerts.filter((a) => !a.read).map((a) => a.alertId);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Notifications</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant={unreadCount > 0 ? 'warning' : 'secondary'} aria-label="Unread count">
              {unreadCount} unread
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={() => markRead(unreadIds)}
              disabled={unreadIds.length === 0}
              aria-label="Mark all notifications read"
            >
              Mark all read
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : error ? (
          <EmptyState title="Could not load notifications" description={error} />
        ) : alerts.length === 0 ? (
          <EmptyState title="No notifications" description="Alerts you receive will appear here." />
        ) : (
          <ul className="space-y-2" data-testid="alert-inbox-list">
            {alerts.map((a) => (
              <li
                key={a.alertId}
                data-testid="alert-row"
                data-read={a.read ? 'true' : 'false'}
                className="rounded-lg border border-border bg-card p-3 space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {!a.read && (
                      <span
                        aria-label="Unread"
                        title="Unread"
                        className="inline-block h-2 w-2 rounded-full bg-primary"
                      />
                    )}
                    <Badge variant={severityVariant[a.severity] ?? 'info'}>
                      {severityLabel[a.severity] ?? 'INFO'}
                    </Badge>
                    <span className="text-xs text-muted-foreground" data-testid="alert-module">
                      {a.category}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">{formatWhen(a)}</span>
                </div>
                <p className={a.read ? 'text-sm' : 'text-sm font-semibold'}>{a.title}</p>
                {a.body && (
                  <p className="text-xs text-muted-foreground" data-testid="alert-body">
                    {a.body}
                  </p>
                )}
                {!a.read && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => markRead([a.alertId])}
                    aria-label={`Mark notification ${a.title} read`}
                  >
                    Mark read
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
