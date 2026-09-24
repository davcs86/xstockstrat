'use client';
import { X } from 'lucide-react';
import { FundamentalMetric } from '@xstockstrat/proto/indicators/v1/indicators_pb';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RepeatableRowList } from '@/components/shared/RepeatableRowList';
import { useListEditor } from '@/hooks/useListEditor';
import { useFundamentalMetrics } from '@/hooks/useFormulas';

/** Wrapper row so the scalar enum list reuses the object-shaped useListEditor/RepeatableRowList. */
type MetricRow = { metric: FundamentalMetric };

interface FundamentalInputEditorProps {
  value: FundamentalMetric[];
  onChange: (next: FundamentalMetric[]) => void;
}

/**
 * Add / remove editor for a formula's declared fundamental inputs. A non-empty list marks the
 * formula fundamentals-only; each metric is read in the sandbox as `data["<data_key>"]`. Options
 * are the deployment-static FundamentalMetric catalog; the stored value is the numeric enum, which
 * Connect-JSON serializes to its NAME-string on the wire. A blank (UNSPECIFIED) row is dropped on
 * save by the workspace.
 */
export function FundamentalInputEditor({ value, onChange }: FundamentalInputEditorProps) {
  const { data } = useFundamentalMetrics();
  const catalog = data?.metrics ?? [];

  const rows: MetricRow[] = value.map((metric) => ({ metric }));
  const { update, add, remove } = useListEditor<MetricRow>(
    rows,
    (next) => onChange(next.map((r) => r.metric)),
    () => ({ metric: FundamentalMetric.UNSPECIFIED }),
  );

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Declare the fundamental metrics this formula reads. A non-empty list marks the formula
        fundamentals-only; each metric is available in the sandbox as{' '}
        <code className="text-foreground">data[&quot;pe_ratio&quot;]</code> (its snake_case key).
      </p>
      {value.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No fundamental inputs. Add metrics the formula reads via{' '}
          <code className="text-foreground">data[&quot;pe_ratio&quot;]</code>.
        </p>
      )}
      <RepeatableRowList
        items={rows}
        onAdd={add}
        addLabel="Add fundamental input"
        onUpdate={update}
        onRemove={remove}
        renderRow={(row, i, ctx) => (
          <div className="flex items-center gap-2">
            <Select
              value={row.metric ? String(row.metric) : ''}
              onValueChange={(v) => ctx.update({ metric: Number(v) as FundamentalMetric })}
            >
              <SelectTrigger aria-label={`fundamental input ${i}`} className="flex-1">
                <SelectValue placeholder="Select a metric…" />
              </SelectTrigger>
              <SelectContent>
                {catalog.map((m) => (
                  <SelectItem key={m.dataKey} value={String(m.metric)}>
                    {m.meaning}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label={`remove fundamental input ${i}`}
              onClick={ctx.remove}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}
      />
    </div>
  );
}
