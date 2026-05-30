'use client';
import { useEffect, useState } from 'react';
import { BASE_PATH } from '@/lib/basepath';
import { Bell } from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from './ui/sheet';
import { Separator } from './ui/separator';

interface Alert {
  alert_id: string;
  severity: number;
  category: string;
  title: string;
  body: string;
  source_service: string;
}

const severityLabel: Record<number, string> = { 1: 'INFO', 2: 'WARN', 3: 'ERROR', 4: 'CRITICAL' };
const severityVariant: Record<number, 'info' | 'warning' | 'destructive' | 'destructive'> = {
  1: 'info',
  2: 'warning',
  3: 'destructive',
  4: 'destructive',
};

export function AlertStream() {
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    const es = new EventSource(`${BASE_PATH}/api/alerts/stream`);
    es.onmessage = (e) => {
      try {
        const alert: Alert = JSON.parse(e.data);
        setAlerts((prev) => [alert, ...prev].slice(0, 50));
      } catch {}
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, []);

  const unread = alerts.length;
  const hasHighSeverity = alerts.some((a) => a.severity >= 3);

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="icon" className="relative">
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span
              className={`absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold ${
                hasHighSeverity ? 'bg-destructive text-white' : 'bg-primary text-primary-foreground'
              }`}
            >
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[360px] sm:w-[400px]">
        <SheetHeader>
          <div className="flex items-center justify-between pr-6">
            <SheetTitle>Alerts</SheetTitle>
            {alerts.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setAlerts([])} className="text-muted-foreground text-xs h-7">
                Clear all
              </Button>
            )}
          </div>
        </SheetHeader>
        <Separator className="my-4" />
        <div className="overflow-y-auto max-h-[calc(100vh-8rem)]">
          {alerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Bell className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-sm">No alerts</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {alerts.map((a) => (
                <li
                  key={a.alert_id}
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
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
