'use client';
import { useState } from 'react';
import { BookOpen, Play, Sparkles } from 'lucide-react';
import {
  ParameterType,
  type FormulaParameter,
  type FormulaOutput,
} from '@xstockstrat/proto/indicators/v1/indicators_pb';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FormulaEditor } from '@/components/insights/FormulaEditor';
import { FormulaReferencePanel } from '@/components/insights/FormulaReferencePanel';
import { FormulaRunResult } from '@/components/insights/FormulaRunResult';
import {
  ParameterEditor,
  draftFromProto,
  isNumericType,
  toParameterInit,
  type FormulaParameterInit,
  type ParameterDraft,
} from '@/components/insights/ParameterEditor';
import {
  OutputEditor,
  outputDraftFromProto,
  toOutputInit,
  type FormulaOutputInit,
  type OutputDraft,
} from '@/components/insights/OutputEditor';
import { useExecuteFormula } from '@/hooks/useFormulas';
import {
  BLANK_TEMPLATE,
  SAMPLE_INPUT_JSON,
  SAMPLE_OHLCV,
  type FormulaTemplate,
} from './formulaReference';

/**
 * Reserved author marking a platform-managed, built-in formula (mirrors the indicators
 * service's SYSTEM_AUTHOR). These are seeded at startup and depended on by other services
 * (e.g. the fundamentals scoring formula referenced by feature 062), so the editor renders
 * them read-only and the backend rejects every UpdateFormula/DeleteFormula on them.
 */
export const SYSTEM_FORMULA_AUTHOR = 'system';

export interface FormulaWorkspaceProps {
  mode: 'create' | 'edit';
  initialName?: string;
  initialDescription?: string;
  initialSource?: string;
  initialIsPublic?: boolean;
  initialParameters?: FormulaParameter[];
  initialOutputs?: FormulaOutput[];
  author?: string;
  saving: boolean;
  saveError: string | null;
  onSave: (values: {
    name: string;
    description: string;
    source: string;
    isPublic: boolean;
    parameters: FormulaParameterInit[];
    outputs: FormulaOutputInit[];
  }) => void;
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
  initialParameters,
  initialOutputs,
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
  const [parameters, setParameters] = useState<ParameterDraft[]>(() =>
    (initialParameters ?? []).map(draftFromProto),
  );
  const [outputs, setOutputs] = useState<OutputDraft[]>(() =>
    (initialOutputs ?? []).map(outputDraftFromProto),
  );
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [jsonInput, setJsonInput] = useState(SAMPLE_INPUT_JSON);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [showReference, setShowReference] = useState(true);

  // Built-in system formulas are immutable: hide Save/Delete and disable every editor input.
  // The Run cell stays enabled so the formula can still be inspected/executed.
  const readOnly = author === SYSTEM_FORMULA_AUTHOR;

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
    // Build typed parameter VALUES from the generated form; omitted/blank values
    // are left out so the engine applies the declared defaults.
    const named = parameters.filter((p) => p.name.trim());
    const inputParams: Record<string, unknown> = {};
    for (const p of named) {
      const raw = paramValues[p.name] ?? p.default;
      if (raw === '') continue;
      if (p.type === ParameterType.BOOL) inputParams[p.name] = raw === 'true';
      else if (p.type === ParameterType.STRING) inputParams[p.name] = raw;
      else {
        const n = Number(raw);
        if (Number.isFinite(n)) inputParams[p.name] = n;
      }
    }
    // Inline runs have no stored definition, so the engine validates the supplied
    // values against the in-editor parameter DEFINITIONS passed alongside them.
    executeMut.mutate({
      formulaSource: source,
      inputData: parsed,
      inputParams,
      parameters: named.map(toParameterInit),
    });
  }

  function loadTemplate(t: FormulaTemplate) {
    setSource(t.source);
    // Fill the Parameters and Outputs cells from the template's typed declarations.
    setParameters(t.parameters.map((p) => ({ ...p })));
    setOutputs(t.outputs.map((o) => ({ ...o })));
    // Clear any prior run-cell overrides so each param seeds from its declared default.
    setParamValues({});
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
          {readOnly && <Badge variant="info">Read-only · system formula</Badge>}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setShowReference((s) => !s)}>
            <BookOpen className="mr-1.5 h-4 w-4" />
            {showReference ? 'Hide reference' : 'Reference'}
          </Button>
          {onDelete && !readOnly && (
            <Button variant="destructive" size="sm" onClick={onDelete} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {readOnly ? 'Back' : 'Cancel'}
          </Button>
          {!readOnly && (
            <Button
              size="sm"
              onClick={() =>
                onSave({
                  name: name.trim(),
                  description,
                  source,
                  isPublic,
                  parameters: parameters.filter((p) => p.name.trim()).map(toParameterInit),
                  outputs: outputs.filter((o) => o.name.trim()).map(toOutputInit),
                })
              }
              disabled={saving || !name.trim()}
            >
              {saving ? 'Saving…' : mode === 'create' ? 'Create formula' : 'Save'}
            </Button>
          )}
        </div>
      </div>

      <div className={showReference ? 'grid gap-4 lg:grid-cols-[1fr_340px]' : ''}>
        {/* Notebook column */}
        <div className="min-w-0 space-y-4">
          {/* Metadata, Parameters and Outputs inputs are locked for read-only system formulas
              via a native disabled fieldset; the Monaco editor is locked via its readOnly prop. */}
          <fieldset disabled={readOnly} className="m-0 min-w-0 space-y-4 border-0 p-0">
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

            {/* Parameters cell */}
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle>Parameters</CardTitle>
                <span className="text-[11px] text-muted-foreground">
                  typed inputs, read via <code className="text-foreground">params</code>
                </span>
              </CardHeader>
              <CardContent>
                <ParameterEditor value={parameters} onChange={setParameters} />
              </CardContent>
            </Card>

            {/* Outputs cell */}
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle>Outputs</CardTitle>
                <span className="text-[11px] text-muted-foreground">
                  series in <code className="text-foreground">result</code>, used in rules
                </span>
              </CardHeader>
              <CardContent>
                <OutputEditor value={outputs} onChange={setOutputs} />
              </CardContent>
            </Card>
          </fieldset>

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
                <FormulaEditor
                  value={source}
                  onChange={setSource}
                  readOnly={readOnly}
                  height="320px"
                />
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

              {parameters.filter((p) => p.name.trim()).length > 0 && (
                <div className="space-y-2">
                  <label className="block text-xs text-muted-foreground">
                    Parameters — available as <code className="text-foreground">params</code>
                  </label>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {parameters
                      .filter((p) => p.name.trim())
                      .map((p) => (
                        <div key={p.name}>
                          <label className="mb-1 block text-[11px] text-muted-foreground">
                            {p.name}
                          </label>
                          {p.type === ParameterType.BOOL ? (
                            <Select
                              value={paramValues[p.name] ?? (p.default || 'false')}
                              onValueChange={(v) => setParamValues((s) => ({ ...s, [p.name]: v }))}
                            >
                              <SelectTrigger aria-label={`run param ${p.name}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="true">true</SelectItem>
                                <SelectItem value="false">false</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : (
                            <Input
                              aria-label={`run param ${p.name}`}
                              type={isNumericType(p.type) ? 'number' : 'text'}
                              value={paramValues[p.name] ?? p.default}
                              onChange={(e) =>
                                setParamValues((s) => ({ ...s, [p.name]: e.target.value }))
                              }
                            />
                          )}
                        </div>
                      ))}
                  </div>
                </div>
              )}

              <Button onClick={handleRun} disabled={executeMut.isPending}>
                <Play className="mr-1.5 h-4 w-4" />
                {executeMut.isPending ? 'Running…' : 'Run'}
              </Button>

              {executeMut.error && (
                <p className="text-xs text-destructive">
                  {executeMut.error instanceof Error
                    ? executeMut.error.message
                    : 'Execution failed'}
                </p>
              )}
              {executeMut.data && executeMut.data.parameterErrors.length > 0 && (
                <div className="space-y-0.5 text-xs text-destructive">
                  {executeMut.data.parameterErrors.map((pe) => (
                    <p key={pe.name}>
                      <code className="text-foreground">{pe.name}</code>: {pe.reason}
                    </p>
                  ))}
                </div>
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
