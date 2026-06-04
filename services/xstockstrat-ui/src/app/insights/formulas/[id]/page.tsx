'use client';
import { useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { ConnectError } from '@connectrpc/connect';
import { AppShell } from '@/components/insights/AppShell';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FormulaEditor } from '@/components/insights/FormulaEditor';
import {
  useFormula,
  useUpdateFormula,
  useDeleteFormula,
  useExecuteFormula,
} from '@/hooks/useFormulas';

export default function FormulaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: formula, isLoading } = useFormula(id);
  const updateMut = useUpdateFormula();
  const deleteMut = useDeleteFormula();
  const executeMut = useExecuteFormula();

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [source, setSource] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [jsonInput, setJsonInput] = useState('{}');
  const [jsonError, setJsonError] = useState<string | null>(null);

  function startEdit() {
    if (!formula) return;
    setName(formula.name);
    setDescription(formula.description);
    setSource(formula.source);
    setIsPublic(formula.isPublic);
    setEditing(true);
  }

  function saveEdit() {
    updateMut.mutate(
      { formulaId: id, name, description, source, isPublic },
      { onSuccess: () => setEditing(false) },
    );
  }

  function handleDelete() {
    if (!window.confirm('Delete this formula? This cannot be undone.')) return;
    deleteMut.mutate(
      { formulaId: id, userId: '' },
      { onSuccess: () => router.push('/insights/formulas') },
    );
  }

  function handleRun() {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonInput);
      setJsonError(null);
    } catch {
      setJsonError('Input must be valid JSON');
      return;
    }
    executeMut.mutate({ formulaId: id, inputData: parsed });
  }

  const updateError =
    updateMut.error instanceof ConnectError
      ? updateMut.error.rawMessage
      : (updateMut.error?.message ?? null);
  const execResult = executeMut.data;

  if (isLoading) {
    return (
      <AppShell>
        <div className="p-4 sm:p-6">
          <p className="text-sm text-muted-foreground">Loading formula…</p>
        </div>
      </AppShell>
    );
  }

  if (!formula) {
    return (
      <AppShell>
        <div className="p-4 sm:p-6">
          <p className="text-sm text-destructive">Formula not found.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="p-4 sm:p-6 max-w-2xl space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">{formula.name}</h1>
            <p className="text-xs text-muted-foreground mt-1">{formula.author}</p>
          </div>
          <Badge variant={formula.isPublic ? 'info' : 'warning'}>
            {formula.isPublic ? 'Public' : 'Private'}
          </Badge>
        </div>

        {/* View / edit */}
        <Card>
          <CardHeader>
            <CardTitle>Definition</CardTitle>
          </CardHeader>
          <CardContent>
            {editing ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Name</label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} name="name" />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Description</label>
                  <textarea
                    className="flex min-h-[64px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Source (Python)</label>
                  <FormulaEditor value={source} onChange={setSource} />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={isPublic}
                    onChange={(e) => setIsPublic(e.target.checked)}
                  />
                  Public
                </label>
                {updateError && <p className="text-xs text-destructive">{updateError}</p>}
                <div className="flex gap-2">
                  <Button onClick={saveEdit} disabled={updateMut.isPending}>
                    {updateMut.isPending ? 'Saving…' : 'Save'}
                  </Button>
                  <Button variant="ghost" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {formula.description && (
                  <p className="text-sm text-muted-foreground">{formula.description}</p>
                )}
                <FormulaEditor value={formula.source} readOnly />
                <div className="flex gap-2">
                  <Button variant="outline" onClick={startEdit}>
                    Edit
                  </Button>
                  <Button variant="destructive" onClick={handleDelete} disabled={deleteMut.isPending}>
                    {deleteMut.isPending ? 'Deleting…' : 'Delete'}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Test execute */}
        <Card>
          <CardHeader>
            <CardTitle>Test Execute</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Input data (JSON)</label>
                <textarea
                  className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono"
                  value={jsonInput}
                  onChange={(e) => setJsonInput(e.target.value)}
                />
              </div>
              {jsonError && <p className="text-xs text-destructive">{jsonError}</p>}
              <Button onClick={handleRun} disabled={executeMut.isPending}>
                {executeMut.isPending ? 'Running…' : 'Run'}
              </Button>

              {execResult && (
                <div className="rounded-lg bg-secondary p-3 space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Success</span>
                    <span className={execResult.success ? 'text-buy' : 'text-destructive'}>
                      {String(execResult.success)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Execution (ms)</span>
                    <span className="tabular-nums">{execResult.executionMs}</span>
                  </div>
                  {execResult.stdout && (
                    <pre className="mt-2 whitespace-pre-wrap text-foreground/80">{execResult.stdout}</pre>
                  )}
                  {execResult.stderr && (
                    <pre className="mt-2 whitespace-pre-wrap text-destructive">{execResult.stderr}</pre>
                  )}
                  {execResult.error && <p className="text-destructive">{execResult.error}</p>}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
