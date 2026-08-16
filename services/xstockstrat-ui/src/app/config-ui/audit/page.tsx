'use client';

import { useMemo } from 'react';
import { formatDistanceToNow } from 'date-fns';
import type { ColumnDef } from '@tanstack/react-table';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DataTable } from '@/components/ui/data-table';
import { PageBreadcrumb } from '@/components/shared/PageBreadcrumb';
import { useAuditLog } from '@/app/config-ui/hooks/useAuditLog';

// Mirrors the (unexported) AuditEntry shape returned by useAuditLog.
interface AuditEntry {
  id: string;
  namespace: string;
  key: string;
  oldValue: string;
  newValue: string;
  changedBy: string;
  reason: string;
  changedAt: string;
  environment: string;
  tradingMode: string;
}

export default function AuditPage() {
  const { data: entries = [], isLoading: loading } = useAuditLog();

  const columns = useMemo<ColumnDef<AuditEntry>[]>(
    () => [
      {
        accessorKey: 'changedAt',
        header: 'When',
        meta: { className: 'w-[120px] text-muted-foreground whitespace-nowrap' },
        cell: ({ row }) =>
          formatDistanceToNow(new Date(row.original.changedAt), { addSuffix: true }),
      },
      {
        id: 'namespaceKey',
        header: 'Namespace / Key',
        accessorFn: (e) => `${e.namespace}.${e.key}`,
        meta: { className: 'font-mono' },
        cell: ({ row }) => (
          <>
            <span className="text-primary">{row.original.namespace}</span>
            <span className="text-muted-foreground">.</span>
            <span className="text-foreground">{row.original.key}</span>
          </>
        ),
      },
      {
        accessorKey: 'oldValue',
        header: 'Old Value',
        meta: { className: 'hidden sm:table-cell w-[120px] font-mono text-destructive/80' },
        cell: ({ row }) => row.original.oldValue || '—',
      },
      {
        accessorKey: 'newValue',
        header: 'New Value',
        meta: { className: 'w-[120px] font-mono text-primary/80' },
      },
      {
        accessorKey: 'changedBy',
        header: 'By',
        meta: { className: 'hidden md:table-cell w-[100px] text-muted-foreground' },
      },
      {
        id: 'envMode',
        header: 'Env / Mode',
        accessorFn: (e) => `${e.environment} ${e.tradingMode}`,
        meta: { className: 'hidden lg:table-cell w-[120px]' },
        cell: ({ row }) => (
          <div className="flex gap-1">
            <Badge variant="secondary" className="text-xs">
              {row.original.environment}
            </Badge>
            <Badge
              variant={row.original.tradingMode === 'paper' ? 'paper' : 'live'}
              className="text-xs"
            >
              {row.original.tradingMode}
            </Badge>
          </div>
        ),
      },
      {
        accessorKey: 'reason',
        header: 'Reason',
        meta: { className: 'hidden xl:table-cell text-muted-foreground' },
      },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <PageBreadcrumb
        ariaLabel="Audit log path"
        items={[{ label: '← namespaces', href: '/config-ui' }, { label: 'Audit Log' }]}
      />

      {loading && <p className="text-muted-foreground text-sm">Loading…</p>}

      {!loading && (
        <Card>
          <CardContent className="pt-0 p-0">
            <DataTable
              columns={columns}
              data={entries}
              getRowId={(e) => e.id}
              emptyMessage="No audit entries yet"
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
