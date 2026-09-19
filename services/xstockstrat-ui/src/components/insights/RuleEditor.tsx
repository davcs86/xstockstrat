'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from '@/components/ui/combobox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/components/ui/utils';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { RepeatableRowList } from '@/components/shared/RepeatableRowList';
import { useListEditor } from '@/hooks/useListEditor';
import { RULE_FUNCTIONS, type RuleFn, type OperandRef } from '@/lib/strategyCatalog';
import { parseRuleTree, type Condition, type RuleTree } from '@/lib/ruleSummary';

// The pure condition-tree parsers/summarizer live in @/lib/ruleSummary so the read-only
// strategy-detail page can render a rule summary without bundling this editor. Re-exported here for
// back-compat with existing importers (StrategyWizard, tests).
export { parseRuleTree, summarizeRule, ruleHasConditions } from '@/lib/ruleSummary';

// rhs is a numeric literal when it parses as a finite number and is NOT one of the
// declared ref_names — the evaluator treats string rhs as a series lookup and numeric
// rhs as a threshold, so the JSON type must reflect the operator's intent.
function serializeRhs(rhs: string, refNames: string[]): string | number {
  const trimmed = rhs.trim();
  if (trimmed !== '' && !refNames.includes(trimmed) && Number.isFinite(Number(trimmed))) {
    return Number(trimmed);
  }
  return rhs;
}

function serialize(tree: RuleTree, refNames: string[]): string {
  return JSON.stringify({
    op: tree.op,
    conditions: tree.conditions.map((c) => ({
      fn: c.fn,
      lhs: c.lhs,
      rhs: serializeRhs(c.rhs, refNames),
    })),
  });
}

interface RuleEditorProps {
  value: string;
  onChange: (json: string) => void;
  label: string;
  /**
   * Operands available as type-ahead options — one per component plus, for
   * multi-output indicators, one per selectable output series (e.g. `bb.upper`).
   */
  operands: OperandRef[];
}

export function RuleEditor({ value, onChange, label, operands }: RuleEditorProps) {
  const [mode, setMode] = useState<'visual' | 'json'>('visual');
  const [parseError, setParseError] = useState<string | null>(null);
  // The visual builder edits this local model; every edit re-serializes to onChange.
  const [tree, setTree] = useState<RuleTree>(
    () => parseRuleTree(value) ?? { op: 'AND', conditions: [] },
  );

  // Every operand value is a valid ref (used to decide string-vs-number for rhs).
  const refNames = operands.map((o) => o.value);
  const refOptions = operands
    .filter((o) => o.value.trim() !== '')
    .map((o) => ({ value: o.value, label: o.label, hint: o.hint }));

  function updateTree(next: RuleTree) {
    setTree(next);
    onChange(serialize(next, refNames));
  }

  // conditions is already a flat array, bound directly — no generalization of the hook needed.
  const {
    update: updateCondition,
    add: addCondition,
    remove: removeCondition,
  } = useListEditor<Condition>(
    tree.conditions,
    (next) => updateTree({ ...tree, conditions: next }),
    () => ({ lhs: '', fn: '>', rhs: '' }),
  );

  function switchTo(next: 'visual' | 'json') {
    if (next === mode) return;
    if (next === 'visual') {
      const parsed = parseRuleTree(value);
      if (parsed === null) {
        setParseError(
          'Current JSON is not a simple condition tree. Edit it in JSON mode, or clear it to use the visual builder.',
        );
        return; // stay in JSON mode on unparseable input
      }
      setParseError(null);
      setTree(parsed);
    } else {
      // Entering JSON mode — make sure the string reflects the current tree.
      onChange(serialize(tree, refNames));
      setParseError(null);
    }
    setMode(next);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">{label}</label>
      </div>

      {parseError && <p className="text-xs text-destructive">{parseError}</p>}

      <Tabs value={mode} onValueChange={(v) => switchTo(v as 'visual' | 'json')}>
        <TabsList>
          <TabsTrigger value="visual">Visual</TabsTrigger>
          <TabsTrigger value="json">JSON</TabsTrigger>
        </TabsList>

        <TabsContent value="visual">
          <div className="space-y-2 rounded-md border border-border p-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Match</span>
              <Select
                value={tree.op}
                onValueChange={(v) => updateTree({ ...tree, op: v as 'AND' | 'OR' })}
              >
                <SelectTrigger className="h-8 w-28" aria-label="match mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="AND">ALL (and)</SelectItem>
                  <SelectItem value="OR">ANY (or)</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-muted-foreground">of:</span>
            </div>

            {refNames.filter((n) => n.trim() !== '').length === 0 && (
              <p className="text-xs text-muted-foreground">
                Add at least one component in Step 2 to reference it here.
              </p>
            )}

            <RepeatableRowList
              items={tree.conditions}
              onAdd={addCondition}
              addLabel="Add condition"
              onUpdate={updateCondition}
              onRemove={removeCondition}
              renderRow={(cond, i, ctx) => (
                <div className="flex items-center gap-2">
                  <Combobox
                    items={refOptions.map((o) => o.value)}
                    value={cond.lhs || null}
                    itemToStringLabel={(v) => refOptions.find((o) => o.value === v)?.label ?? v}
                    onValueChange={(v) => ctx.update({ lhs: v ?? '' })}
                  >
                    <ComboboxInput
                      aria-label="left operand"
                      placeholder="component"
                      showTrigger={false}
                    />
                    <ComboboxContent>
                      <ComboboxEmpty>No components — add one in Step 2</ComboboxEmpty>
                      <ComboboxList>
                        {(v) => {
                          const o = refOptions.find((r) => r.value === v);
                          return (
                            <ComboboxItem key={v} value={v}>
                              {o?.label ?? v}
                              {o?.hint && (
                                <span className="ml-2 text-xs text-muted-foreground">{o.hint}</span>
                              )}
                            </ComboboxItem>
                          );
                        }}
                      </ComboboxList>
                    </ComboboxContent>
                  </Combobox>
                  <Select value={cond.fn} onValueChange={(v) => ctx.update({ fn: v as RuleFn })}>
                    <SelectTrigger className="h-10 w-44" aria-label="comparator">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RULE_FUNCTIONS.map((f) => (
                        <SelectItem key={f.fn} value={f.fn}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Combobox<string>
                    items={refOptions.map((o) => o.value)}
                    itemToStringLabel={(v) => refOptions.find((o) => o.value === v)?.label ?? v}
                    inputValue={cond.rhs}
                    onInputValueChange={(rhs) => ctx.update({ rhs })}
                    onValueChange={(v) => ctx.update({ rhs: v ?? '' })}
                  >
                    <ComboboxInput
                      aria-label="right operand"
                      placeholder="component or number"
                      showTrigger={false}
                    />
                    <ComboboxContent>
                      <ComboboxEmpty>Type a number, or pick a component</ComboboxEmpty>
                      <ComboboxList>
                        {(v) => {
                          const o = refOptions.find((r) => r.value === v);
                          return (
                            <ComboboxItem key={v} value={v}>
                              {o?.label ?? v}
                              {o?.hint && (
                                <span className="ml-2 text-xs text-muted-foreground">{o.hint}</span>
                              )}
                            </ComboboxItem>
                          );
                        }}
                      </ComboboxList>
                    </ComboboxContent>
                  </Combobox>
                  <Button type="button" size="sm" variant="ghost" onClick={ctx.remove}>
                    Remove
                  </Button>
                </div>
              )}
            />
          </div>
        </TabsContent>

        <TabsContent value="json">
          <Textarea
            aria-label={`${label} JSON`}
            className={cn('min-h-[140px] bg-secondary font-mono text-sm')}
            placeholder='{ "op": "AND", "conditions": [ { "fn": ">", "lhs": "sma_fast", "rhs": "sma_slow" } ] }'
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
