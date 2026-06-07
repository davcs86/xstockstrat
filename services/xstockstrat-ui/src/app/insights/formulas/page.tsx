'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Search } from 'lucide-react';
import { AppShell } from '@/components/insights/AppShell';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useFormulas } from '@/hooks/useFormulas';
import type { FormulaDefinition } from '@xstockstrat/proto/indicators/v1/indicators_pb';

type Visibility = 'all' | 'public' | 'private';

function formatDate(seconds: bigint | undefined): string {
  if (!seconds) return '—';
  return new Date(Number(seconds) * 1000).toLocaleDateString();
}

export default function FormulasPage() {
  const router = useRouter();
  const { data, isLoading, error } = useFormulas({ includePublic: true, pageSize: 50 });

  const [query, setQuery] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('all');

  const formulas = useMemo(() => data?.formulas ?? [], [data]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return formulas.filter((f: FormulaDefinition) => {
      if (visibility === 'public' && !f.isPublic) return false;
      if (visibility === 'private' && f.isPublic) return false;
      if (!q) return true;
      return (
        f.name.toLowerCase().includes(q) ||
        f.description.toLowerCase().includes(q) ||
        f.author.toLowerCase().includes(q)
      );
    });
  }, [formulas, query, visibility]);

  return (
    <AppShell>
      <div className="p-4 sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Formulas</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Custom indicator formulas. Open one to edit and test it, or create a new one — the
              editor includes a reference panel with the data contract, available libraries, and
              starter templates.
            </p>
          </div>
          <Button onClick={() => router.push('/insights/formulas/new')}>
            <Plus className="mr-1.5 h-4 w-4" />
            New Formula
          </Button>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, description, or author"
              className="pl-8"
            />
          </div>
          <Select value={visibility} onValueChange={(v) => setVisibility(v as Visibility)}>
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="public">Public only</SelectItem>
              <SelectItem value="private">Private only</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading && <p className="text-sm text-muted-foreground">Loading formulas…</p>}
        {error && <p className="text-sm text-destructive">Failed to load formulas</p>}

        {data && (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Visibility</TableHead>
                    <TableHead>Author</TableHead>
                    <TableHead className="text-right">Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((f: FormulaDefinition) => (
                    <TableRow
                      key={f.formulaId}
                      className="cursor-pointer"
                      onClick={() => router.push(`/insights/formulas/${f.formulaId}`)}
                    >
                      <TableCell>
                        <p className="font-medium text-foreground">{f.name}</p>
                        {f.description && (
                          <p className="mt-0.5 line-clamp-1 text-muted-foreground">{f.description}</p>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={f.isPublic ? 'info' : 'warning'}>
                          {f.isPublic ? 'Public' : 'Private'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{f.author}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {formatDate(f.createdAt?.seconds)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                        {formulas.length === 0
                          ? 'No formulas yet. Click New Formula to create one.'
                          : 'No formulas match your search.'}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
