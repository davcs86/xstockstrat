'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/components/ui/utils';

// Simple, documented condition-tree schema. Both the visual builder and the raw
// JSON textarea produce the SAME string (AC-9):
//   { "op": "and" | "or", "conditions": [ { "lhs": "...", "cmp": ">", "rhs": "..." } ] }
type Comparator = '>' | '>=' | '<' | '<=' | '==' | '!=';
type Condition = { lhs: string; cmp: Comparator; rhs: string };
type RuleTree = { op: 'and' | 'or'; conditions: Condition[] };

const COMPARATORS: Comparator[] = ['>', '>=', '<', '<=', '==', '!='];

function parseTree(value: string): RuleTree | null {
  if (!value.trim()) return { op: 'and', conditions: [] };
  try {
    const parsed = JSON.parse(value) as { op?: unknown; conditions?: unknown };
    if (
      parsed &&
      (parsed.op === 'and' || parsed.op === 'or') &&
      Array.isArray(parsed.conditions)
    ) {
      const conditions: Condition[] = parsed.conditions.map((c) => {
        const cond = c as { lhs?: unknown; cmp?: unknown; rhs?: unknown };
        return {
          lhs: String(cond.lhs ?? ''),
          cmp: (COMPARATORS.includes(cond.cmp as Comparator)
            ? (cond.cmp as Comparator)
            : '>') as Comparator,
          rhs: String(cond.rhs ?? ''),
        };
      });
      return { op: parsed.op, conditions };
    }
    return null; // valid JSON but not the simple condition-tree shape
  } catch {
    return null; // not parseable
  }
}

function serialize(tree: RuleTree): string {
  return JSON.stringify({ op: tree.op, conditions: tree.conditions });
}

interface RuleEditorProps {
  value: string;
  onChange: (json: string) => void;
  label: string;
}

export function RuleEditor({ value, onChange, label }: RuleEditorProps) {
  const [mode, setMode] = useState<'visual' | 'json'>('visual');
  const [parseError, setParseError] = useState<string | null>(null);
  // The visual builder edits this local model; every edit re-serializes to onChange.
  const [tree, setTree] = useState<RuleTree>(
    () => parseTree(value) ?? { op: 'and', conditions: [] },
  );

  function updateTree(next: RuleTree) {
    setTree(next);
    onChange(serialize(next));
  }

  function switchTo(next: 'visual' | 'json') {
    if (next === mode) return;
    if (next === 'visual') {
      const parsed = parseTree(value);
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
      onChange(serialize(tree));
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
              onValueChange={(v) => updateTree({ ...tree, op: v as 'and' | 'or' })}
            >
              <SelectTrigger className="h-8 w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="and">ALL (and)</SelectItem>
                <SelectItem value="or">ANY (or)</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-muted-foreground">of:</span>
          </div>

          {tree.conditions.map((cond, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                aria-label="left operand"
                placeholder="e.g. sma_fast"
                value={cond.lhs}
                onChange={(e) => {
                  const conditions = [...tree.conditions];
                  conditions[i] = { ...cond, lhs: e.target.value };
                  updateTree({ ...tree, conditions });
                }}
              />
              <Select
                value={cond.cmp}
                onValueChange={(v) => {
                  const conditions = [...tree.conditions];
                  conditions[i] = { ...cond, cmp: v as Comparator };
                  updateTree({ ...tree, conditions });
                }}
              >
                <SelectTrigger className="h-10 w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMPARATORS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                aria-label="right operand"
                placeholder="e.g. sma_slow"
                value={cond.rhs}
                onChange={(e) => {
                  const conditions = [...tree.conditions];
                  conditions[i] = { ...cond, rhs: e.target.value };
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
                conditions: [...tree.conditions, { lhs: '', cmp: '>', rhs: '' }],
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
          placeholder='{ "op": "and", "conditions": [ { "lhs": "sma_fast", "cmp": ">", "rhs": "sma_slow" } ] }'
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}
