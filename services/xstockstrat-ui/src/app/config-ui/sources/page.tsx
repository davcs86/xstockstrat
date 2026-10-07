'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import type { SignalSource } from '@xstockstrat/proto/ingest/v1/ingest_pb';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { DataTable } from '@/components/ui/data-table';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { CardNotice } from '@/components/shared/CardNotice';
import { QueryStateMessages } from '@/components/shared/QueryStateMessages';
import { EmptyState } from '@/components/shared/EmptyState';
import { useIsAdmin } from '@/hooks/useLiveStrategies';
import { useSignalSources } from '@/app/config-ui/hooks/useSignalSources';
import { configUiIdentityClient } from '@/lib/browserClients/configUiIdentityClient';
import { SOURCE_HEALTH, EnumBadge } from '@/lib/opportunityShared';

// Read-only by design (FR-13): no create/edit/deactivate/weight control and no credential field.
const COLUMNS: ColumnDef<SignalSource>[] = [
  { accessorKey: 'slug', header: 'Slug', meta: { className: 'font-mono' } },
  { accessorKey: 'displayName', header: 'Display Name' },
  { accessorKey: 'sourceType', header: 'Source Type' },
  {
    id: 'status',
    header: 'Status',
    accessorFn: (s) => s.active,
    cell: ({ row }) => (row.original.active ? 'Active' : 'Inactive'),
  },
  {
    id: 'health',
    header: 'Health',
    accessorFn: (s) => s.health,
    cell: ({ row }) => <EnumBadge render={SOURCE_HEALTH[row.original.health]} />,
  },
  {
    id: 'weight',
    header: 'Weight',
    accessorFn: (s) => s.reliabilityWeight ?? 1.0,
    meta: { className: 'font-mono tabular-nums' },
  },
];

export default function SignalSourcesAdminPage() {
  const { data: isAdmin, isLoading: adminLoading } = useIsAdmin();
  const [owner, setOwner] = useState('');
  const users = useQuery({
    queryKey: ['config-ui-users'],
    enabled: isAdmin,
    queryFn: () => configUiIdentityClient.listUsers({}),
  });
  const userList = useMemo(() => users.data?.users ?? [], [users.data]);
  const { sources, isLoading, error } = useSignalSources(owner);

  if (adminLoading) return <QueryStateMessages isLoading errorText="" />;
  if (!isAdmin) return <CardNotice>Admin only</CardNotice>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Signal Sources (admin)</h1>
        <p className="text-sm text-muted-foreground">
          Read-only view of one user&apos;s signal sources. Every read of another user&apos;s
          sources is audited. Users manage their own sources under Engine → Signal sources.
        </p>
      </div>

      <div className="max-w-sm space-y-1.5">
        <Label htmlFor="source-owner">Owner</Label>
        <Select value={owner} onValueChange={setOwner}>
          <SelectTrigger id="source-owner" aria-label="Owner">
            <SelectValue placeholder="Select a user" />
          </SelectTrigger>
          <SelectContent>
            {userList.map((u) => (
              <SelectItem key={u.userId} value={u.userId}>
                {u.email || u.userId}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <QueryStateMessages
          isLoading={users.isLoading}
          error={users.error}
          loadingText="Loading users…"
          errorText="Users unavailable"
        />
      </div>

      {owner !== '' && (
        <Card>
          <CardContent className="pt-5">
            <QueryStateMessages
              isLoading={isLoading}
              error={error}
              loadingText="Loading sources…"
              errorText="Signal sources unavailable"
            />
            {!isLoading && !error && sources.length === 0 && (
              <EmptyState title="This user has no signal sources" />
            )}
            {!isLoading && !error && sources.length > 0 && (
              <DataTable columns={COLUMNS} data={sources} getRowId={(s) => s.slug} />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
