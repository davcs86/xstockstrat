'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ConnectError, Code } from '@connectrpc/connect';
import type { Alert } from '@xstockstrat/proto/notify/v1/notify_pb';
import { notifyClient } from '@/lib/browserClients/notifyClient';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  contextEntries,
  formatWhen,
  invalidateAlertReadModels,
  severityLabel,
  severityVariant,
} from '@/lib/alertShared';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';

type Status = 'loading' | 'ready' | 'not-found' | 'error';

export function AlertDetail() {
  const alertId = useParams<{ alert_id: string }>()?.alert_id;
  const [alert, setAlert] = useState<Alert | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [errorText, setErrorText] = useState('');
  const [markedRead, setMarkedRead] = useState(false);
  const queryClient = useQueryClient();
  const { mutate: markRead } = useMutation({
    mutationFn: (alertIds: string[]) => notifyClient.markAlertRead({ alertIds }),
    meta: { errorHandled: true },
    onSuccess: () => {
      void invalidateAlertReadModels(queryClient);
    },
  });

  useEffect(() => {
    if (!alertId) return;
    let active = true;
    setStatus('loading');
    setMarkedRead(false);
    notifyClient
      .getAlert({ alertId })
      .then((res) => {
        if (!active) return;
        setAlert(res);
        setStatus('ready');
        // Mark the server-returned id, never the URL param (D-7); a failure leaves the page as is.
        markRead([res.alertId], {
          onSuccess: () => {
            if (active) setMarkedRead(true);
          },
        });
      })
      .catch((e: unknown) => {
        if (!active) return;
        if (ConnectError.from(e).code === Code.NotFound) {
          setStatus('not-found');
        } else {
          setErrorText((e as Error).message);
          setStatus('error');
        }
      });
    return () => {
      active = false;
    };
  }, [alertId, markRead]);

  if (status === 'ready' && alert) {
    const entries = contextEntries(alert.context);
    return (
      <Card data-testid="alert-detail">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Badge variant={severityVariant[alert.severity] ?? 'info'}>
              {severityLabel[alert.severity] ?? 'INFO'}
            </Badge>
            <span className="text-xs text-muted-foreground">{alert.category}</span>
          </div>
          <CardTitle>{alert.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="whitespace-pre-wrap text-sm">{alert.body}</p>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Source service</dt>
            <dd>{alert.sourceService}</dd>
            <dt className="text-muted-foreground">Created</dt>
            <dd>{formatWhen(alert.createdAt)}</dd>
            <dt className="text-muted-foreground">Status</dt>
            <dd data-testid="alert-read-state">{alert.read || markedRead ? 'Read' : 'Unread'}</dd>
            <dt className="text-muted-foreground">Correlation ID</dt>
            <dd className="break-all">{alert.correlationId || '—'}</dd>
          </dl>
          <section className="space-y-2">
            <h4 className="text-sm font-medium">Context</h4>
            {entries.length === 0 ? (
              <p className="text-xs text-muted-foreground">No context fields</p>
            ) : (
              <dl className="space-y-2 text-sm">
                {entries.map(({ key, value }) => (
                  <div key={key} data-testid="alert-context-row" className="space-y-0.5">
                    <dt className="text-muted-foreground">{key}</dt>
                    <dd className="break-all">{value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="alert-detail">
      <CardContent>
        {status === 'not-found' ? (
          <EmptyState
            title="Alert not found"
            description="This alert does not exist or is not visible to you."
          />
        ) : status === 'error' ? (
          <EmptyState title="Could not load alert" description={errorText} />
        ) : (
          <div className="space-y-2 pt-6">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
