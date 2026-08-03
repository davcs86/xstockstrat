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
import { useManageStrategy } from '@/hooks/useStrategyDefinitions';
import { useFormulas } from '@/hooks/useFormulas';
import { operandRefs, type FormulaOutputsMap } from '@/lib/strategyCatalog';

// feature 097: the "Signal Params" blend step was removed — a strategy's backtest score is
// technical-only (Option 2), so the wizard no longer exposes signal-weight controls. Any existing
// `signal_params` (the live-loop symbol universe, ANALYSIS-3) is preserved untouched on save.
const STEPS = ['Identity', 'Components', 'Rules', 'Review'] as const;

const STRATEGY_ID_RE = /^[a-z0-9_]+$/;

// Parse the cooldown-days input honestly w.r.t. proto explicit presence (feature 069):
// blank → OMIT the field (server applies the platform default 31); "0" → explicit 0 (no cooldown);
// a non-negative integer → that value; anything else → invalid. Never collapses blank into 0.
function parseCooldownDays(
  raw: string,
): { valid: true; value: number | undefined } | { valid: false; error: string } {
  if (raw.trim() === '') return { valid: true, value: undefined };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    return { valid: false, error: 'cooldown days must be a non-negative integer' };
  }
  return { valid: true, value: n };
}

interface StrategyWizardProps {
  mode: 'create' | 'edit';
  initial?: StrategyDefinition;
  onSubmitDone?: (id: string) => void;
}

export function StrategyWizard({ mode, initial, onSubmitDone }: StrategyWizardProps) {
  const [step, setStep] = useState(1);
  const { mutate, isPending, error: errorObj } = useManageStrategy();
  const { data: formulasData } = useFormulas({ includePublic: true, pageSize: 50 });

  const [strategyId, setStrategyId] = useState(initial?.strategyId ?? '');
  const [displayName, setDisplayName] = useState(initial?.displayName ?? '');
  // Seed from explicit presence, NOT `?? 0`: an unset strategy must stay blank so an unrelated edit
  // never silently writes cooldown_days: 0 over the strategy's implicit platform default (feature 069).
  const [cooldownDaysRaw, setCooldownDaysRaw] = useState(
    initial?.cooldownDays !== undefined ? String(initial.cooldownDays) : '',
  );
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

  const serverError =
    errorObj instanceof ConnectError ? errorObj.rawMessage : (errorObj?.message ?? null);

  // Heuristic mapping of a server validation message to the step that owns the field.
  function stepForError(msg: string): number {
    const m = msg.toLowerCase();
    if (m.includes('rule')) return 3;
    if (m.includes('indicator') || m.includes('component') || m.includes('ref')) return 2;
    if (m.includes('strategy_id') || m.includes('display')) return 1;
    if (m.includes('cooldown')) return 1;
    return 4;
  }

  // Declared outputs per custom-formula id, so formula components expose their
  // series as rule operands just like multi-output built-in indicators.
  const formulaOutputs: FormulaOutputsMap = {};
  for (const f of formulasData?.formulas ?? []) {
    if (f.outputs.length > 0) {
      formulaOutputs[f.formulaId] = f.outputs.map((o) => ({
        name: o.name,
        description: o.description,
      }));
    }
  }

  // Rule operands = one entry per component, plus a `<ref>.<series>` entry for each
  // selectable output series of multi-output indicators (e.g. bb.upper / bb.lower)
  // and declared custom-formula outputs.
  const operands = operandRefs(components, formulaOutputs);

  const idValid = STRATEGY_ID_RE.test(strategyId);
  const cooldownParsed = parseCooldownDays(cooldownDaysRaw);
  const canAdvance =
    step === 1
      ? idValid && displayName.trim() !== '' && cooldownParsed.valid
      : step === 2
        ? components.length >= 1
        : step === 3
          ? entryRule.trim() !== '' && exitRule.trim() !== ''
          : true;

  function handleSubmit() {
    const cd = parseCooldownDays(cooldownDaysRaw);
    const definition = {
      strategyId,
      displayName,
      components,
      entryRule,
      exitRule,
      // feature 097: preserve any EXISTING signal_params verbatim — it holds the live-loop
      // signal_params.symbols universe (ANALYSIS-3). A wholesale rewrite here would drop those
      // symbols (the design's clobber). On a create with no prior signal_params, omit the key
      // entirely — don't invent blend fields the technical-only score no longer uses.
      ...(initial?.signalParams !== undefined ? { signalParams: initial.signalParams } : {}),
      // Presence-honest: blank omits the key (server default drives the gate); "0" sends cooldownDays: 0.
      ...(cd.valid && cd.value !== undefined ? { cooldownDays: cd.value } : {}),
    };
    mutate(
      {
        operation: mode === 'create' ? StrategyOperation.REGISTER : StrategyOperation.UPDATE,
        definition,
      },
      { onSuccess: () => onSubmitDone?.(strategyId) },
    );
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
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Re-entry cooldown (days)
                </label>
                <Input
                  type="number"
                  min={0}
                  value={cooldownDaysRaw}
                  placeholder="31 (default)"
                  onChange={(e) => setCooldownDaysRaw(e.target.value)}
                />
                {!cooldownParsed.valid && (
                  <p className="mt-1 text-xs text-destructive">{cooldownParsed.error}</p>
                )}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              {components.map((c, i) => (
                <ComponentEditor
                  key={i}
                  value={c}
                  onChange={(next) => setComponents((cs) => cs.map((x, j) => (j === i ? next : x)))}
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
                operands={operands}
              />
              <RuleEditor
                label="Exit rule"
                value={exitRule}
                onChange={setExitRule}
                operands={operands}
              />
            </div>
          )}

          {step === 4 && (
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
        <Button
          type="button"
          variant="ghost"
          disabled={step === 1}
          onClick={() => setStep((s) => s - 1)}
        >
          Back
        </Button>
        <div className="flex gap-2">
          {step < 4 ? (
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
