// Pure parsers + summarizer for a strategy's entry/exit condition tree. Extracted from RuleEditor
// (feature R1-D3 / defect fix) so the read-only strategy-detail page can render a rule summary
// without bundling the full editor's client-only UI (Combobox/Select/etc.). RuleEditor re-exports
// these for back-compat.
import { RULE_FUNCTIONS, fnPhrase, type RuleFn } from '@/lib/strategyCatalog';

// Condition-tree schema accepted by the analysis evaluator (evaluator.py):
//   { "op": "AND" | "OR", "conditions": [ { "fn": ">", "lhs": "sma_fast", "rhs": "sma_slow" } ] }
// `lhs` is always a component ref_name; `rhs` is a ref_name (string) or a numeric literal.
export type Condition = { lhs: string; fn: RuleFn; rhs: string };
export type RuleTree = { op: 'AND' | 'OR'; conditions: Condition[] };

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

/** Human-readable one-liner per condition, for the Review step and the detail page. */
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
