'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { AppShell } from '@/components/insights/AppShell';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useFormulas } from '@/hooks/useFormulas';
import type { FormulaDefinition } from '@xstockstrat/proto/indicators/v1/indicators_pb';

function formatDate(seconds: bigint | undefined): string {
  if (!seconds) return '';
  return new Date(Number(seconds) * 1000).toLocaleDateString();
}

export default function FormulasPage() {
  const router = useRouter();
  const { data, isLoading, error } = useFormulas({ includePublic: true, pageSize: 50 });

  return (
    <AppShell>
      <div className="p-4 sm:p-6">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Formulas</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Custom indicator formulas, scoped to their author
            </p>
          </div>
          <Button onClick={() => router.push('/insights/formulas/new')}>
            <Plus className="h-4 w-4 mr-1.5" />
            New Formula
          </Button>
        </div>

        {isLoading && <p className="text-sm text-muted-foreground">Loading formulas…</p>}
        {error && <p className="text-sm text-destructive">Failed to load formulas</p>}

        {data && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {(data.formulas ?? []).map((f: FormulaDefinition) => (
              <Link key={f.formulaId} href={`/insights/formulas/${f.formulaId}`}>
                <Card className="h-full hover:border-primary/50 transition-colors cursor-pointer">
                  <CardContent className="pt-5">
                    <div className="flex items-start justify-between mb-3">
                      <p className="text-sm font-semibold text-foreground truncate mr-2">{f.name}</p>
                      <Badge variant={f.isPublic ? 'info' : 'warning'} className="shrink-0">
                        {f.isPublic ? 'Public' : 'Private'}
                      </Badge>
                    </div>
                    {f.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{f.description}</p>
                    )}
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span className="truncate mr-2">{f.author}</span>
                      <span className="shrink-0 tabular-nums">{formatDate(f.createdAt?.seconds)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-3">View details →</p>
                  </CardContent>
                </Card>
              </Link>
            ))}
            {(data.formulas ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground col-span-3">
                No formulas yet. Click New Formula to create one.
              </p>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
