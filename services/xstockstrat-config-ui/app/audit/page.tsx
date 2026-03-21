/**
 * Config UI — Audit log viewer.
 * Shows recent config changes across all namespaces.
 */
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { Card, CardContent } from '@components/ui/card';
import { Badge } from '@components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@components/ui/table';

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
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/audit')
      .then((r) => r.json())
      .then((data) => {
        setEntries(data.entries ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2">
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          ← namespaces
        </Link>
        <span className="text-muted-foreground">/</span>
        <h1 className="text-base font-semibold">Audit Log</h1>
      </div>

      {loading && <p className="text-muted-foreground text-sm">Loading…</p>}

      {!loading && (
        <Card>
          <CardContent className="pt-0 p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[120px]">When</TableHead>
                  <TableHead>Namespace / Key</TableHead>
                  <TableHead className="hidden sm:table-cell w-[120px]">Old Value</TableHead>
                  <TableHead className="w-[120px]">New Value</TableHead>
                  <TableHead className="hidden md:table-cell w-[100px]">By</TableHead>
                  <TableHead className="hidden lg:table-cell w-[120px]">Env / Mode</TableHead>
                  <TableHead className="hidden xl:table-cell">Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {formatDistanceToNow(new Date(e.changedAt), { addSuffix: true })}
                    </TableCell>
                    <TableCell className="font-mono">
                      <span className="text-primary">{e.namespace}</span>
                      <span className="text-muted-foreground">.</span>
                      <span className="text-foreground">{e.key}</span>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell font-mono text-destructive/80">
                      {e.oldValue || '—'}
                    </TableCell>
                    <TableCell className="font-mono text-primary/80">
                      {e.newValue}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-muted-foreground">
                      {e.changedBy}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <div className="flex gap-1">
                        <Badge variant="secondary" className="text-xs">{e.environment}</Badge>
                        <Badge variant={e.tradingMode === 'paper' ? 'paper' : 'live'} className="text-xs">{e.tradingMode}</Badge>
                      </div>
                    </TableCell>
                    <TableCell className="hidden xl:table-cell text-muted-foreground">
                      {e.reason}
                    </TableCell>
                  </TableRow>
                ))}
                {entries.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      No audit entries yet
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
