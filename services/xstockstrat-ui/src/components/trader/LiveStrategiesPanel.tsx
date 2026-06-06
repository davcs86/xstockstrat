'use client';
import { useState } from 'react';
import {
  useLiveStrategyDefinitions,
  useSetStrategyLive,
  useStrategyAlerts,
} from '@/hooks/useLiveStrategies';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';

interface LiveStrategiesPanelProps {
  /** When false, the live-toggle action column is hidden (admin-only, FR-10). */
  isAdmin: boolean;
}

export function LiveStrategiesPanel({ isAdmin }: LiveStrategiesPanelProps) {
  const { data, isLoading } = useLiveStrategyDefinitions();
  const setLive = useSetStrategyLive();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const strategies = data?.definitions ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Live Strategies</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading strategies…</p>
        ) : strategies.length === 0 ? (
          <p className="text-sm text-muted-foreground">No strategies defined.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Strategy</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Live</TableHead>
                {isAdmin && <TableHead>Action</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {strategies.map((s) => (
                <TableRow
                  key={s.strategyId}
                  className="cursor-pointer"
                  onClick={() => setSelectedId(s.strategyId)}
                >
                  <TableCell>{s.displayName || s.strategyId}</TableCell>
                  <TableCell>
                    <Badge variant={s.active ? 'default' : 'secondary'}>
                      {s.active ? 'active' : 'inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={s.liveEnabled ? 'default' : 'outline'}>
                      {s.liveEnabled ? 'on' : 'off'}
                    </Badge>
                  </TableCell>
                  {isAdmin && (
                    <TableCell>
                      <Button
                        size="sm"
                        variant={s.liveEnabled ? 'outline' : 'default'}
                        disabled={setLive.isPending}
                        onClick={(e) => {
                          e.stopPropagation();
                          setLive.mutate({
                            strategyId: s.strategyId,
                            liveEnabled: !s.liveEnabled,
                          });
                        }}
                      >
                        {s.liveEnabled ? 'Disable' : 'Enable'}
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {setLive.isError && (
          <p className="text-sm text-destructive mt-2">
            Could not update live status — admin scope required.
          </p>
        )}
        {selectedId && <StrategyAlertFeed strategyId={selectedId} />}
      </CardContent>
    </Card>
  );
}

function StrategyAlertFeed({ strategyId }: { strategyId: string }) {
  const { data } = useStrategyAlerts(strategyId);
  const alerts = data ?? [];
  return (
    <div className="mt-4">
      <h4 className="text-sm font-medium mb-2">Recent strategy alerts — {strategyId}</h4>
      {alerts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No recent strategy alerts.</p>
      ) : (
        <ul className="space-y-1">
          {alerts.map((a) => (
            <li key={a.alertId} className="flex justify-between gap-2 text-sm">
              <span>{a.title}</span>
              <span className="text-muted-foreground">
                {a.createdAt ? new Date(Number(a.createdAt.seconds) * 1000).toLocaleString() : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
