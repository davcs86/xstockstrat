'use client';
import { useState } from 'react';
import { BookOpen, Play, Sparkles } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FormulaEditor } from '@/components/insights/FormulaEditor';
import { FormulaReferencePanel } from '@/components/insights/FormulaReferencePanel';
import { FormulaRunResult } from '@/components/insights/FormulaRunResult';
import { useExecuteFormula } from '@/hooks/useFormulas';
import {
  BLANK_TEMPLATE,
  SAMPLE_INPUT_JSON,
  SAMPLE_OHLCV,
  type FormulaTemplate,
} from './formulaReference';

export interface FormulaWorkspaceProps {
  mode: 'create' | 'edit';
  initialName?: string;
  initialDescription?: string;
  initialSource?: string;
  initialIsPublic?: boolean;
  author?: string;
  saving: boolean;
  saveError: string | null;
  onSave: (values: { name: string; description: string; source: string; isPublic: boolean }) => void;
  onCancel: () => void;
  onDelete?: () => void;
  deleting?: boolean;
}

/**
 * Notebook-style authoring surface, shared by the create and edit pages.
 *
 * The page reads top to bottom like a notebook: a metadata cell, a code cell,
 * and a run cell that executes the *current* (possibly unsaved) editor buffer
 * via inline `formula_source`, so authors iterate without saving first. A
 * reference panel sits alongside documenting the data → result contract, the
 * available libraries, sandbox limits, and one-click starter templates.
 */
export function FormulaWorkspace({
  mode,
  initialName = '',
  initialDescription = '',
  initialSource,
  initialIsPublic = false,
  author,
  saving,
  saveError,
  onSave,
  onCancel,
  onDelete,
  deleting = false,
}: FormulaWorkspaceProps) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [source, setSource] = useState(initialSource ?? BLANK_TEMPLATE.source);
  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const [jsonInput, setJsonInput] = useState(SAMPLE_INPUT_JSON);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [showReference, setShowReference] = useState(true);

  const executeMut = useExecuteFormula();

  function handleRun() {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonInput) as Record<string, unknown>;
      setJsonError(null);
    } catch {
      setJsonError('Input must be valid JSON');
      return;
    }
    executeMut.mutate({ formulaSource: source, inputData: parsed });
  }

  function loadTemplate(t: FormulaTemplate) {
    setSource(t.source);
    setJsonInput(JSON.stringify(t.sampleInput, null, 2));
    setJsonError(null);
    executeMut.reset();
  }

  function loadSampleData() {
    setJsonInput(JSON.stringify(SAMPLE_OHLCV, null, 2));
    setJsonError(null);
  }

  return (
    <div className="space-y-4">
      {/* Action bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold tracking-tight">
            {mode === 'create' ? 'New formula' : name || 'Formula'}
          </h1>
          {author && <span className="text-xs text-muted-foreground">by {author}</span>}
          <Badge variant={isPublic ? 'info' : 'warning'}>{isPublic ? 'Public' : 'Private'}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setShowReference((s) => !s)}>
            <BookOpen className="mr-1.5 h-4 w-4" />
            {showReference ? 'Hide reference' : 'Reference'}
          </Button>
          {onDelete && (
            <Button variant="destructive" size="sm" onClick={onDelete} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => onSave({ name: name.trim(), description, source, isPublic })}
            disabled={saving || !name.trim()}
          >
            {saving ? 'Saving…' : mode === 'create' ? 'Create formula' : 'Save'}
          </Button>
        </div>
      </div>

      <div className={showReference ? 'grid gap-4 lg:grid-cols-[1fr_340px]' : ''}>
        {/* Notebook column */}
        <div className="min-w-0 space-y-4">
          {/* Metadata cell */}
          <Card>
            <CardContent className="space-y-4 pt-5">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Name</label>
                <Input
                  name="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My RSI variant"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Description</label>
                <textarea
                  className="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What it computes and the inputs it expects"
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={isPublic}
                  onChange={(e) => setIsPublic(e.target.checked)}
                />
                Public (visible to all users)
              </label>
            </CardContent>
          </Card>

          {/* Code cell */}
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Formula (Python)</CardTitle>
              <span className="text-[11px] text-muted-foreground">
                reads <code className="text-foreground">data</code>, assigns{' '}
                <code className="text-foreground">result</code>
              </span>
            </CardHeader>
            <CardContent>
              <div className="overflow-hidden rounded-md border border-border">
                <FormulaEditor value={source} onChange={setSource} height="320px" />
              </div>
            </CardContent>
          </Card>

          {/* Run cell */}
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Run</CardTitle>
              <Button variant="ghost" size="sm" onClick={loadSampleData}>
                <Sparkles className="mr-1.5 h-4 w-4" />
                Load sample data
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Input data (JSON) — available as <code className="text-foreground">data</code>
                </label>
                <textarea
                  className="flex min-h-[120px] w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={jsonInput}
                  onChange={(e) => setJsonInput(e.target.value)}
                  spellCheck={false}
                />
              </div>
              {jsonError && <p className="text-xs text-destructive">{jsonError}</p>}
              <Button onClick={handleRun} disabled={executeMut.isPending}>
                <Play className="mr-1.5 h-4 w-4" />
                {executeMut.isPending ? 'Running…' : 'Run'}
              </Button>

              {executeMut.error && (
                <p className="text-xs text-destructive">
                  {executeMut.error instanceof Error ? executeMut.error.message : 'Execution failed'}
                </p>
              )}
              {executeMut.data && <FormulaRunResult result={executeMut.data} />}
            </CardContent>
          </Card>

          {saveError && <p className="text-sm text-destructive">{saveError}</p>}
        </div>

        {/* Reference column */}
        {showReference && (
          <aside className="lg:sticky lg:top-4 lg:h-[calc(100vh-7rem)]">
            <FormulaReferencePanel
              onLoadTemplate={loadTemplate}
              onClose={() => setShowReference(false)}
            />
          </aside>
        )}
      </div>
    </div>
  );
}
