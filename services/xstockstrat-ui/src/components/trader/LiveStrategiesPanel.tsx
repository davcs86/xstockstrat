'use client';
import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import {
  useLiveStrategyDefinitions,
  useSetStrategyLive,
  useStrategyAlerts,
} from '@/hooks/useLiveStrategies';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { DataTable } from '../ui/data-table';
import { Collapsible, CollapsibleContent } from '../ui/collapsible';

interface LiveStrategiesPanelProps {
  /** When false, the live-toggle action column is hidden (admin-only, FR-10). */
  isAdmin: boolean;
}

export function LiveStrategiesPanel({ isAdmin }: LiveStrategiesPanelProps) {
  const { data, isLoading } = useLiveStrategyDefinitions();
  const setLive = useSetStrategyLive();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const strategies = data?.definitions ?? [];

  type StrategyRow = (typeof strategies)[number];

  const columns = useMemo<ColumnDef<StrategyRow>[]>(() => {
    const base: ColumnDef<StrategyRow>[] = [
      {
        id: 'strategy',
        header: 'Strategy',
        accessorFn: (s) => s.displayName || s.strategyId,
      },
      {
        id: 'status',
        header: 'Status',
        accessorFn: (s) => (s.active ? 'active' : 'inactive'),
        cell: ({ row }) => (
          <Badge variant={row.original.active ? 'default' : 'secondary'}>
            {row.original.active ? 'active' : 'inactive'}
          </Badge>
        ),
      },
      {
        id: 'live',
        header: 'Live',
        accessorFn: (s) => (s.liveEnabled ? 'on' : 'off'),
        cell: ({ row }) => (
          <Badge variant={row.original.liveEnabled ? 'default' : 'outline'}>
            {row.original.liveEnabled ? 'on' : 'off'}
          </Badge>
        ),
      },
    ];
    if (!isAdmin) return base;
    const actionColumn: ColumnDef<StrategyRow> = {
      id: 'action',
      header: 'Action',
      enableSorting: false,
      cell: ({ row }) => {
        const s = row.original;
        return (
          <Button
            size="sm"
            variant={s.liveEnabled ? 'outline' : 'default'}
            disabled={setLive.isPending}
            onClick={() =>
              setLive.mutate({ strategyId: s.strategyId, liveEnabled: !s.liveEnabled })
            }
          >
            {s.liveEnabled ? 'Disable' : 'Enable'}
          </Button>
        );
      },
    };
    return [...base, actionColumn];
  }, [isAdmin, setLive]);

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
          <DataTable
            columns={columns}
            data={strategies}
            getRowId={(s) => s.strategyId}
            onRowClick={(s) => setSelectedId(s.strategyId)}
            rowClassName={() => 'cursor-pointer'}
          />
        )}
        {setLive.isError && (
          <p className="text-sm text-destructive mt-2">
            Could not update live status — admin scope required.
          </p>
        )}
        <Collapsible open={!!selectedId} onOpenChange={(open) => !open && setSelectedId(null)}>
          <CollapsibleContent>
            {selectedId && <StrategyAlertFeed strategyId={selectedId} />}
          </CollapsibleContent>
        </Collapsible>
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
