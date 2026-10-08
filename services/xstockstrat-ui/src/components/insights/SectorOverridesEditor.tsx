'use client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Sector } from '@xstockstrat/proto/common/v1/common_pb';
import { OVERRIDABLE_SECTORS, SECTOR_LABEL, type SectorOverrideDraft } from '@/lib/sectors';
import type { StrategyComponentDraft } from '@/components/insights/ComponentEditor';

interface SectorOverridesEditorProps {
  components: StrategyComponentDraft[];
  value: SectorOverrideDraft[];
  onChange: (next: SectorOverrideDraft[]) => void;
}

// Per-sector component-param overrides (feature 217): a param gets a mandatory default (used for
// unclassified symbols) plus optional per-sector values, resolved by the symbol's sector per bar.
export function SectorOverridesEditor({ components, value, onChange }: SectorOverridesEditorProps) {
  const withParams = components.filter((c) => c.refName && Object.keys(c.params).length > 0);
  const update = (i: number, next: SectorOverrideDraft) =>
    onChange(value.map((o, j) => (j === i ? next : o)));

  return (
    <div className="space-y-3 rounded-md border p-3" data-testid="sector-overrides">
      <div>
        <p className="text-sm font-medium">Per-sector parameter overrides</p>
        <p className="text-xs text-muted-foreground">
          Optional. Override a component parameter by the symbol&apos;s sector; unclassified symbols
          use the default.
        </p>
      </div>
      {value.map((o, i) => {
        const comp = withParams.find((c) => c.refName === o.componentRef);
        const paramKeys = comp ? Object.keys(comp.params) : [];
        const used = new Set(o.bySector.map((sv) => sv.sector));
        const label = `override ${i + 1}`;
        return (
          <div
            key={i}
            className="space-y-2 rounded-md bg-muted/40 p-2"
            data-testid="sector-override"
          >
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Select
                value={o.componentRef}
                onValueChange={(ref) => {
                  const c = withParams.find((x) => x.refName === ref);
                  const first = c ? Object.keys(c.params)[0] : '';
                  update(i, {
                    ...o,
                    componentRef: ref,
                    paramName: first,
                    defaultValue: c && first ? c.params[first] : 0,
                  });
                }}
              >
                <SelectTrigger aria-label={`${label} component`}>
                  <SelectValue placeholder="Component" />
                </SelectTrigger>
                <SelectContent>
                  {withParams.map((c) => (
                    <SelectItem key={c.refName} value={c.refName}>
                      {c.refName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={o.paramName}
                onValueChange={(p) =>
                  update(i, { ...o, paramName: p, defaultValue: comp?.params[p] ?? o.defaultValue })
                }
              >
                <SelectTrigger aria-label={`${label} parameter`} disabled={!comp}>
                  <SelectValue placeholder="Parameter" />
                </SelectTrigger>
                <SelectContent>
                  {paramKeys.map((k) => (
                    <SelectItem key={k} value={k}>
                      {k}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                aria-label={`${label} default value`}
                type="number"
                value={Number.isFinite(o.defaultValue) ? o.defaultValue : ''}
                onChange={(e) => update(i, { ...o, defaultValue: Number(e.target.value) })}
              />
            </div>
            {o.bySector.map((sv, k) => (
              <div key={k} className="grid grid-cols-[1fr_8rem_auto] items-center gap-2">
                <Select
                  value={String(sv.sector)}
                  onValueChange={(s) =>
                    update(i, {
                      ...o,
                      bySector: o.bySector.map((x, m) =>
                        m === k ? { ...x, sector: Number(s) as Sector } : x,
                      ),
                    })
                  }
                >
                  <SelectTrigger aria-label={`${label} sector ${k + 1}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OVERRIDABLE_SECTORS.filter((s) => s === sv.sector || !used.has(s)).map((s) => (
                      <SelectItem key={s} value={String(s)}>
                        {SECTOR_LABEL[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  aria-label={`${label} ${SECTOR_LABEL[sv.sector]} value`}
                  type="number"
                  value={Number.isFinite(sv.value) ? sv.value : ''}
                  onChange={(e) =>
                    update(i, {
                      ...o,
                      bySector: o.bySector.map((x, m) =>
                        m === k ? { ...x, value: Number(e.target.value) } : x,
                      ),
                    })
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`remove ${SECTOR_LABEL[sv.sector]} from ${label}`}
                  onClick={() =>
                    update(i, { ...o, bySector: o.bySector.filter((_, m) => m !== k) })
                  }
                >
                  Remove
                </Button>
              </div>
            ))}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={used.size >= OVERRIDABLE_SECTORS.length}
                onClick={() => {
                  const next = OVERRIDABLE_SECTORS.find((s) => !used.has(s));
                  if (next === undefined) return;
                  update(i, {
                    ...o,
                    bySector: [...o.bySector, { sector: next, value: o.defaultValue }],
                  });
                }}
              >
                Add sector
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`remove ${label}`}
                onClick={() => onChange(value.filter((_, j) => j !== i))}
              >
                Remove override
              </Button>
            </div>
          </div>
        );
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={withParams.length === 0}
        onClick={() =>
          onChange([...value, { componentRef: '', paramName: '', defaultValue: 0, bySector: [] }])
        }
      >
        Add sector override
      </Button>
    </div>
  );
}
