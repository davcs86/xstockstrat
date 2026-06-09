'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/components/ui/utils';
import { RULE_FUNCTIONS, fnPhrase, type RuleFn, type OperandRef } from '@/lib/strategyCatalog';

// Condition-tree schema accepted by the analysis evaluator (evaluator.py):
//   { "op": "AND" | "OR", "conditions": [ { "fn": ">", "lhs": "sma_fast", "rhs": "sma_slow" } ] }
// `lhs` is always a component ref_name; `rhs` is a ref_name (string) or a numeric
// literal (JSON number). Both the visual builder and the raw JSON textarea produce
// this identical string (AC-9).
type Condition = { lhs: string; fn: RuleFn; rhs: string };
type RuleTree = { op: 'AND' | 'OR'; conditions: Condition[] };

const FNS = RULE_FUNCTIONS.map((f) => f.fn);

function normalizeOp(op: unknown): 'AND' | 'OR' {
  return String(op).toUpperCase() === 'OR' ? 'OR' : 'AND';
}

function normalizeFn(node: { fn?: unknown; cmp?: unknown }): RuleFn {
  // Accept the canonical `fn` key; tolerate the legacy `cmp` key from older drafts.
  const raw = String(node.fn ?? node.cmp ?? '>');
  return (FNS.includes(raw as RuleFn) ? raw : '>') as RuleFn;
}

export function parseRuleTree(value: string): RuleTree | null {
  if (!value.trim()) return { op: 'AND', conditions: [] };
  try {
    const parsed = JSON.parse(value) as { op?: unknown; conditions?: unknown };
    if (
      parsed &&
      (normalizeOp(parsed.op) === 'AND' || normalizeOp(parsed.op) === 'OR') &&
      Array.isArray(parsed.conditions)
    ) {
      const conditions: Condition[] = parsed.conditions.map((c) => {
        const cond = c as { lhs?: unknown; fn?: unknown; cmp?: unknown; rhs?: unknown };
        return {
          lhs: String(cond.lhs ?? ''),
          fn: normalizeFn(cond),
          rhs: cond.rhs === undefined || cond.rhs === null ? '' : String(cond.rhs),
        };
      });
      return { op: normalizeOp(parsed.op), conditions };
    }
    return null; // valid JSON but not the simple condition-tree shape
  } catch {
    return null; // not parseable
  }
}

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

/** Human-readable one-liner per condition, for the Review step. */
export function summarizeRule(value: string): { op: 'AND' | 'OR'; parts: string[] } | null {
  const tree = parseRuleTree(value);
  if (!tree) return null;
  const parts = tree.conditions.map((c) => `${c.lhs || '?'} ${fnPhrase(c.fn)} ${c.rhs || '?'}`);
  return { op: tree.op, parts };
}

/** True when the serialized rule has at least one condition (used to gate Next). */
export function ruleHasConditions(value: string): boolean {
  const tree = parseRuleTree(value);
  return !!tree && tree.conditions.length > 0;
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
        <div className="flex gap-1">
          <Button
            type="button"
            size="sm"
            variant={mode === 'visual' ? 'default' : 'outline'}
            onClick={() => switchTo('visual')}
          >
            Visual
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === 'json' ? 'default' : 'outline'}
            onClick={() => switchTo('json')}
          >
            JSON
          </Button>
        </div>
      </div>

      {parseError && <p className="text-xs text-destructive">{parseError}</p>}

      {mode === 'visual' ? (
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

          {tree.conditions.map((cond, i) => (
            <div key={i} className="flex items-center gap-2">
              <Combobox
                aria-label="left operand"
                placeholder="component"
                emptyText="No components — add one in Step 2"
                value={cond.lhs}
                options={refOptions}
                onChange={(lhs) => {
                  const conditions = [...tree.conditions];
                  conditions[i] = { ...cond, lhs };
                  updateTree({ ...tree, conditions });
                }}
              />
              <Select
                value={cond.fn}
                onValueChange={(v) => {
                  const conditions = [...tree.conditions];
                  conditions[i] = { ...cond, fn: v as RuleFn };
                  updateTree({ ...tree, conditions });
                }}
              >
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
              <Combobox
                aria-label="right operand"
                placeholder="component or number"
                emptyText="Type a number, or pick a component"
                allowFreeText
                value={cond.rhs}
                options={refOptions}
                onChange={(rhs) => {
                  const conditions = [...tree.conditions];
                  conditions[i] = { ...cond, rhs };
                  updateTree({ ...tree, conditions });
                }}
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() =>
                  updateTree({
                    ...tree,
                    conditions: tree.conditions.filter((_, j) => j !== i),
                  })
                }
              >
                Remove
              </Button>
            </div>
          ))}

          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              updateTree({
                ...tree,
                conditions: [...tree.conditions, { lhs: '', fn: '>', rhs: '' }],
              })
            }
          >
            Add condition
          </Button>
        </div>
      ) : (
        <textarea
          aria-label={`${label} JSON`}
          className={cn(
            'flex min-h-[140px] w-full rounded-md border border-input bg-secondary px-3 py-2 font-mono text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          )}
          placeholder='{ "op": "AND", "conditions": [ { "fn": ">", "lhs": "sma_fast", "rhs": "sma_slow" } ] }'
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}
