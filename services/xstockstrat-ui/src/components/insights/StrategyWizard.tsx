'use client';
import { useState } from 'react';
import { ConnectError } from '@connectrpc/connect';
import type { StrategyDefinition } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import { StrategyOperation } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Questionnaire,
  QuestionnaireItem,
  QuestionnaireProgress,
} from '@/components/ui/questionnaire';
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

// feature 116: same presence-honest shape as parseCooldownDays, for the exit-side minimum
// holding period (blank → omit → platform default 0; "0" → explicit no minimum hold).
function parseExitCooldownDays(
  raw: string,
): { valid: true; value: number | undefined } | { valid: false; error: string } {
  if (raw.trim() === '') return { valid: true, value: undefined };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    return { valid: false, error: 'exit cooldown days must be a non-negative integer' };
  }
  return { valid: true, value: n };
}

// FR-10 (Round 3): where a validation error routes on the "Go to Step" jump — Step 1 targets
// carry which of the 4 native sub-screens owns the field, since Step 1 is no longer one flat
// screen.
type ErrorTarget = { step: number; identitySubStep?: 1 | 2 | 3 | 4 };

// Heuristic mapping of a server validation message to the step (and, for Step 1, the
// identity sub-screen) that owns the field.
function stepForError(msg: string): ErrorTarget {
  const m = msg.toLowerCase();
  if (m.includes('rule')) return { step: 3 };
  if (m.includes('indicator') || m.includes('component') || m.includes('ref')) return { step: 2 };
  if (m.includes('strategy_id')) return { step: 1, identitySubStep: 1 };
  if (m.includes('display')) return { step: 1, identitySubStep: 2 };
  if (m.includes('exit') && m.includes('cooldown')) return { step: 1, identitySubStep: 4 };
  if (m.includes('cooldown')) return { step: 1, identitySubStep: 3 };
  return { step: 4 };
}

/** Back/Next pair for one of Step 1's 4 native sub-screens (FR-10, Round 3). */
function IdentityNav({
  backDisabled,
  onBack,
  nextDisabled,
  onNext,
}: {
  backDisabled: boolean;
  onBack?: () => void;
  nextDisabled: boolean;
  onNext: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <Button type="button" variant="ghost" disabled={backDisabled} onClick={onBack}>
        Back
      </Button>
      <Button type="button" disabled={nextDisabled} onClick={onNext}>
        Next
      </Button>
    </div>
  );
}

interface StrategyWizardProps {
  mode: 'create' | 'edit';
  initial?: StrategyDefinition;
  onSubmitDone?: (id: string) => void;
}

export function StrategyWizard({ mode, initial, onSubmitDone }: StrategyWizardProps) {
  const [step, setStep] = useState(1);
  // Which of Step 1's 4 native sub-screens is showing. Persists across outer-step transitions
  // (never reset except by its own initial value) so Back from outer Step 2 lands on sub-screen 4,
  // the one that just handed off to Step 2 (FR-10, Round 3).
  const [identitySubStep, setIdentitySubStep] = useState<1 | 2 | 3 | 4>(1);
  const { mutate, isPending, error: errorObj } = useManageStrategy();
  const { data: formulasData } = useFormulas({ includePublic: true, pageSize: 50 });

  const [strategyId, setStrategyId] = useState(initial?.strategyId ?? '');
  const [displayName, setDisplayName] = useState(initial?.displayName ?? '');
  // Seed from explicit presence, NOT `?? 0`: an unset strategy must stay blank so an unrelated edit
  // never silently writes cooldown_days: 0 over the strategy's implicit platform default (feature 069).
  const [cooldownDaysRaw, setCooldownDaysRaw] = useState(
    initial?.cooldownDays !== undefined ? String(initial.cooldownDays) : '',
  );
  const [exitCooldownDaysRaw, setExitCooldownDaysRaw] = useState(
    initial?.exitCooldownDays !== undefined ? String(initial.exitCooldownDays) : '',
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
  const errorTarget = serverError ? stepForError(serverError) : null;

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
  const exitCooldownParsed = parseExitCooldownDays(exitCooldownDaysRaw);
  const canAdvance =
    step === 1
      ? idValid && displayName.trim() !== '' && cooldownParsed.valid && exitCooldownParsed.valid
      : step === 2
        ? components.length >= 1
        : step === 3
          ? entryRule.trim() !== '' && exitRule.trim() !== ''
          : true;

  function handleSubmit() {
    const cd = parseCooldownDays(cooldownDaysRaw);
    const cd2 = parseExitCooldownDays(exitCooldownDaysRaw);
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
      ...(cd2.valid && cd2.value !== undefined ? { exitCooldownDays: cd2.value } : {}),
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
      {/* FR-11: step indicator via Questionnaire.Progress. This Root registers no Items — the
          primitive's own current/total tracking is per-Root item registration, and the outer
          step/STEPS model spans Step 1's separate Root plus Steps 2-4's plain state, so adopting
          Questionnaire.Root's own controlled item/onItemChange model here (the only way to get
          its current/total to genuinely match our 4-step model) would repeat Step 13's
          Next/Previous-visibility mismatch and is explicitly out of scope (Instruction 1). With
          zero registered items, Progress's own aria-value* attributes are simply omitted
          (total=0), so its `children` override — driven directly by the outer `step`/`STEPS`
          state below — is the only rendered content; no misleading aria-valuetext is produced. */}
      <Questionnaire onSubmit={(e) => e.preventDefault()}>
        <QuestionnaireProgress
          className="flex w-full min-w-0 flex-wrap gap-2 text-xs"
          aria-label={`Step ${step} of ${STEPS.length}`}
        >
          {STEPS.map((label, i) => {
            const n = i + 1;
            return (
              <Badge
                key={label}
                variant={n === step ? 'default' : 'secondary'}
                className={n > step ? 'opacity-40' : undefined}
              >
                {n}. {label}
              </Badge>
            );
          })}
        </QuestionnaireProgress>
      </Questionnaire>

      <Card>
        <CardHeader>
          <CardTitle>
            Step {step} — {STEPS[step - 1]}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* FR-10 (Round 3): Step 1 restructured onto Questionnaire's native Choice/Input answer
              model — 4 nested sub-screens, one per field, each its own separately-scoped
              Questionnaire/QuestionnaireItem (distinct from Steps 2-4's chrome-only shell). Fields
              stay controlled-React-state-driven (not FormData-read-at-submit) so live validation
              and edit-mode pre-population/disabling are unchanged. `onSubmit` on each Questionnaire
              guards against the underlying <form>'s native Enter-key submission, since we render
              our own Next/Back rather than Questionnaire's own nav parts (see IdentityNav — the
              primitive's Next/Previous/Submit visibility is computed from the Root's total item
              count, which would hide Next entirely for a single-item Root). */}
          {step === 1 && identitySubStep === 1 && (
            <Questionnaire onSubmit={(e) => e.preventDefault()}>
              <QuestionnaireItem name="strategyId">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Strategy ID</label>
                  <Input
                    value={strategyId}
                    disabled={mode === 'edit'}
                    placeholder="e.g. sma_crossover"
                    onChange={(e) => setStrategyId(e.target.value)}
                  />
                  {/* Regex validation only applies in create mode — in edit mode the field above
                      is disabled/immutable, so gating on a client-side format rule for
                      server-sourced data (which may predate this rule) would strand an existing
                      strategy on this sub-screen with no way to proceed. */}
                  {mode === 'create' && !idValid && strategyId !== '' && (
                    <p className="mt-1 text-xs text-destructive">
                      Use lowercase letters, digits, and underscores only.
                    </p>
                  )}
                </div>
              </QuestionnaireItem>
              <IdentityNav
                backDisabled
                nextDisabled={mode === 'create' && !idValid}
                onNext={() => setIdentitySubStep(2)}
              />
            </Questionnaire>
          )}

          {step === 1 && identitySubStep === 2 && (
            <Questionnaire onSubmit={(e) => e.preventDefault()}>
              <QuestionnaireItem name="displayName">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Display name</label>
                  <Input
                    value={displayName}
                    placeholder="SMA Crossover"
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                </div>
              </QuestionnaireItem>
              <IdentityNav
                backDisabled={false}
                onBack={() => setIdentitySubStep(1)}
                nextDisabled={displayName.trim() === ''}
                onNext={() => setIdentitySubStep(3)}
              />
            </Questionnaire>
          )}

          {step === 1 && identitySubStep === 3 && (
            <Questionnaire onSubmit={(e) => e.preventDefault()}>
              <QuestionnaireItem name="cooldownDays">
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
              </QuestionnaireItem>
              <IdentityNav
                backDisabled={false}
                onBack={() => setIdentitySubStep(2)}
                nextDisabled={!cooldownParsed.valid}
                onNext={() => setIdentitySubStep(4)}
              />
            </Questionnaire>
          )}

          {step === 1 && identitySubStep === 4 && (
            <Questionnaire onSubmit={(e) => e.preventDefault()}>
              <QuestionnaireItem name="exitCooldownDays">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    Exit cooldown (days)
                  </label>
                  <Input
                    type="number"
                    min={0}
                    value={exitCooldownDaysRaw}
                    placeholder="0 (default)"
                    onChange={(e) => setExitCooldownDaysRaw(e.target.value)}
                  />
                  {!exitCooldownParsed.valid && (
                    <p className="mt-1 text-xs text-destructive">{exitCooldownParsed.error}</p>
                  )}
                </div>
              </QuestionnaireItem>
              <IdentityNav
                backDisabled={false}
                onBack={() => setIdentitySubStep(3)}
                nextDisabled={!exitCooldownParsed.valid}
                onNext={() => setStep(2)}
              />
            </Questionnaire>
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

              {serverError && errorTarget && (
                <Alert variant="destructive">
                  <AlertDescription>{serverError}</AlertDescription>
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs"
                    onClick={() => {
                      setStep(errorTarget.step);
                      if (errorTarget.step === 1)
                        setIdentitySubStep(errorTarget.identitySubStep ?? 1);
                    }}
                  >
                    Go to Step {errorTarget.step}
                  </Button>
                </Alert>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Navigation — hidden for Step 1, whose 4 native sub-screens (above) each carry their own
          Back/Next via IdentityNav; reachable from Step 2 onward, per FR-10 (Round 3). */}
      {step > 1 && (
        <div className="flex items-center justify-between">
          <Button type="button" variant="ghost" onClick={() => setStep((s) => s - 1)}>
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
      )}
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
