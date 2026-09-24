import { summarizeRule } from '@/lib/ruleSummary';

/**
 * Read-only, human-readable rendering of an entry/exit condition tree. Shared by the strategy
 * wizard's Review step and the strategy-detail page (hoisted here so neither copies it — DRY).
 */
export function RuleSummary({ label, value }: { label: string; value: string }) {
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
