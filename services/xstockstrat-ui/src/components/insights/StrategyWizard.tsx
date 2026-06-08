'use client';
import { useState } from 'react';
import { ConnectError } from '@connectrpc/connect';
import type { StrategyDefinition } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import { StrategyOperation } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/utils';
import { RuleEditor, summarizeRule } from '@/components/insights/RuleEditor';
import {
  ComponentEditor,
  emptyComponent,
  type StrategyComponentDraft,
} from '@/components/insights/ComponentEditor';
import { useInsightsSignalSources } from '@/hooks/useInsightsSignalSources';
import { useManageStrategy } from '@/hooks/useStrategyDefinitions';

const STEPS = ['Identity', 'Components', 'Rules', 'Signal Params', 'Review'] as const;

type SignalParamsDraft = {
  signalSources: string[];
  signalWeight: number;
  technicalWeight: number;
  minConviction: number;
};

const STRATEGY_ID_RE = /^[a-z0-9_]+$/;

function readNumber(obj: Record<string, unknown> | undefined, key: string, dflt: number): number {
  const v = obj?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : dflt;
}

function readStringArray(obj: Record<string, unknown> | undefined, key: string): string[] {
  const v = obj?.[key];
  return Array.isArray(v) ? v.map(String) : [];
}

interface StrategyWizardProps {
  mode: 'create' | 'edit';
  initial?: StrategyDefinition;
  onSubmitDone?: (id: string) => void;
}

export function StrategyWizard({ mode, initial, onSubmitDone }: StrategyWizardProps) {
  const [step, setStep] = useState(1);
  const { mutate, isPending, error: errorObj } = useManageStrategy();
  const { sources } = useInsightsSignalSources();

  const initialSignal = initial?.signalParams as Record<string, unknown> | undefined;

  const [strategyId, setStrategyId] = useState(initial?.strategyId ?? '');
  const [displayName, setDisplayName] = useState(initial?.displayName ?? '');
  const [components, setComponents] = useState<StrategyComponentDraft[]>(() =>
    (initial?.components ?? []).map((c) => ({
      refName: c.refName,
      kind: c.kind,
      indicator: c.indicator,
      formulaId: c.formulaId,
      params: { ...c.params },
    })),
  );
  const [entryRule, setEntryRule] = useState(initial?.entryRule ?? '');
  const [exitRule, setExitRule] = useState(initial?.exitRule ?? '');
  const [signal, setSignal] = useState<SignalParamsDraft>(() => ({
    signalSources: readStringArray(initialSignal, 'signal_sources'),
    signalWeight: readNumber(initialSignal, 'signal_weight', 0.5),
    technicalWeight: readNumber(initialSignal, 'technical_weight', 0.5),
    minConviction: readNumber(initialSignal, 'min_conviction', 0),
  }));

  const serverError =
    errorObj instanceof ConnectError ? errorObj.rawMessage : (errorObj?.message ?? null);

  // Heuristic mapping of a server validation message to the step that owns the field.
  function stepForError(msg: string): number {
    const m = msg.toLowerCase();
    if (m.includes('rule')) return 3;
    if (m.includes('indicator') || m.includes('component') || m.includes('ref')) return 2;
    if (m.includes('strategy_id') || m.includes('display')) return 1;
    return 5;
  }

  const refNames = components.map((c) => c.refName);

  const idValid = STRATEGY_ID_RE.test(strategyId);
  const canAdvance =
    step === 1
      ? idValid && displayName.trim() !== ''
      : step === 2
        ? components.length >= 1
        : step === 3
          ? entryRule.trim() !== '' && exitRule.trim() !== ''
          : true;

  function handleSubmit() {
    const definition = {
      strategyId,
      displayName,
      components,
      entryRule,
      exitRule,
      signalParams: {
        signal_sources: signal.signalSources,
        signal_weight: signal.signalWeight,
        technical_weight: signal.technicalWeight,
        min_conviction: signal.minConviction,
      },
    };
    mutate(
      {
        operation: mode === 'create' ? StrategyOperation.REGISTER : StrategyOperation.UPDATE,
        definition,
      },
      { onSuccess: () => onSubmitDone?.(strategyId) },
    );
  }

  function toggleSource(slug: string) {
    setSignal((s) => ({
      ...s,
      signalSources: s.signalSources.includes(slug)
        ? s.signalSources.filter((x) => x !== slug)
        : [...s.signalSources, slug],
    }));
  }

  return (
    <div className="max-w-2xl space-y-4">
      {/* Step indicator */}
      <ol className="flex flex-wrap gap-2 text-xs">
        {STEPS.map((label, i) => {
          const n = i + 1;
          return (
            <li
              key={label}
              className={cn(
                'rounded-full px-3 py-1',
                n === step
                  ? 'bg-primary text-primary-foreground'
                  : n < step
                    ? 'bg-secondary text-foreground'
                    : 'bg-secondary/40 text-muted-foreground',
              )}
            >
              {n}. {label}
            </li>
          );
        })}
      </ol>

      <Card>
        <CardHeader>
          <CardTitle>
            Step {step} — {STEPS[step - 1]}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === 1 && (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Strategy ID</label>
                <Input
                  value={strategyId}
                  disabled={mode === 'edit'}
                  placeholder="e.g. sma_crossover"
                  onChange={(e) => setStrategyId(e.target.value)}
                />
                {!idValid && strategyId !== '' && (
                  <p className="mt-1 text-xs text-destructive">
                    Use lowercase letters, digits, and underscores only.
                  </p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Display name</label>
                <Input
                  value={displayName}
                  placeholder="SMA Crossover"
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              {components.map((c, i) => (
                <ComponentEditor
                  key={i}
                  value={c}
                  onChange={(next) =>
                    setComponents((cs) => cs.map((x, j) => (j === i ? next : x)))
                  }
                  onRemove={() => setComponents((cs) => cs.filter((_, j) => j !== i))}
                />
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setComponents((cs) => [...cs, emptyComponent()])}
              >
                Add component
              </Button>
              {components.length === 0 && (
                <p className="text-xs text-muted-foreground">At least one component is required.</p>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <RuleEditor
                label="Entry rule"
                value={entryRule}
                onChange={setEntryRule}
                refNames={refNames}
              />
              <RuleEditor
                label="Exit rule"
                value={exitRule}
                onChange={setExitRule}
                refNames={refNames}
              />
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Signal sources</label>
                <div className="flex flex-wrap gap-2">
                  {sources.length === 0 && (
                    <p className="text-xs text-muted-foreground">No live signal sources.</p>
                  )}
                  {sources.map((src) => (
                    <button
                      key={src.slug}
                      type="button"
                      onClick={() => toggleSource(src.slug)}
                      className={cn(
                        'rounded-full border px-3 py-1 text-xs',
                        signal.signalSources.includes(src.slug)
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border',
                      )}
                    >
                      {src.displayName || src.slug}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Signal weight</label>
                  <Input
                    type="number"
                    value={signal.signalWeight}
                    onChange={(e) => setSignal((s) => ({ ...s, signalWeight: Number(e.target.value) }))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Technical weight</label>
                  <Input
                    type="number"
                    value={signal.technicalWeight}
                    onChange={(e) =>
                      setSignal((s) => ({ ...s, technicalWeight: Number(e.target.value) }))
                    }
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Min conviction</label>
                  <Input
                    type="number"
                    value={signal.minConviction}
                    onChange={(e) =>
                      setSignal((s) => ({ ...s, minConviction: Number(e.target.value) }))
                    }
                  />
                </div>
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-3 text-sm">
              <div>
                <span className="text-muted-foreground">Strategy ID:</span> {strategyId}
              </div>
              <div>
                <span className="text-muted-foreground">Display name:</span> {displayName}
              </div>
              <div>
                <span className="text-muted-foreground">Components:</span> {components.length}
                <ul className="ml-4 list-disc text-xs text-muted-foreground">
                  {components.map((c, i) => (
                    <li key={i}>
                      {c.refName || '(unnamed)'} — {c.formulaId || c.indicator || '(none)'}
                    </li>
                  ))}
                </ul>
              </div>
              <RuleSummary label="Entry rule" value={entryRule} />
              <RuleSummary label="Exit rule" value={exitRule} />
              <div>
                <span className="text-muted-foreground">Signal sources:</span>{' '}
                {signal.signalSources.join(', ') || '(none)'}
              </div>

              {serverError && (
                <div className="rounded-md border border-destructive p-2">
                  <p className="text-xs text-destructive">{serverError}</p>
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs"
                    onClick={() => setStep(stepForError(serverError))}
                  >
                    Go to Step {stepForError(serverError)}
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button type="button" variant="ghost" disabled={step === 1} onClick={() => setStep((s) => s - 1)}>
          Back
        </Button>
        <div className="flex gap-2">
          {step === 4 && (
            <Button type="button" variant="outline" onClick={() => setStep(5)}>
              Skip
            </Button>
          )}
          {step < 5 ? (
            <Button type="button" disabled={!canAdvance} onClick={() => setStep((s) => s + 1)}>
              Next
            </Button>
          ) : (
            <Button type="button" disabled={isPending} onClick={handleSubmit}>
              {isPending ? 'Saving…' : mode === 'create' ? 'Create Strategy' : 'Save Changes'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Read-only, human-readable rendering of an entry/exit rule for the Review step. */
function RuleSummary({ label, value }: { label: string; value: string }) {
  const summary = summarizeRule(value);

  return (
    <div>
      <span className="text-muted-foreground">{label}:</span>{' '}
      {!summary || summary.parts.length === 0 ? (
        <span className="text-muted-foreground">(none)</span>
      ) : (
        <div className="mt-1 rounded-md border border-border p-2">
          <p className="text-xs text-muted-foreground">
            Match {summary.op === 'AND' ? 'ALL' : 'ANY'} of:
          </p>
          <ul className="ml-4 list-disc">
            {summary.parts.map((p, i) => (
              <li key={i} className="text-sm">
                {p}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
