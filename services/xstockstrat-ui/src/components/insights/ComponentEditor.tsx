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
import { useFormulas } from '@/hooks/useFormulas';
import { ComponentKind } from '@xstockstrat/proto/analysis/v1/analysis_pb';

// Editable draft mirroring StrategyComponent's field names so it assigns directly
// to the proto init shape when the wizard submits.
export type StrategyComponentDraft = {
  refName: string;
  kind: ComponentKind;
  indicator: string;
  formulaId: string;
  params: Record<string, number>;
};

export function emptyComponent(): StrategyComponentDraft {
  return {
    refName: '',
    kind: ComponentKind.BUILTIN_INDICATOR,
    indicator: '',
    formulaId: '',
    params: {},
  };
}

interface ComponentEditorProps {
  value: StrategyComponentDraft;
  onChange: (c: StrategyComponentDraft) => void;
  onRemove: () => void;
}

export function ComponentEditor({ value, onChange, onRemove }: ComponentEditorProps) {
  const { data: formulasData } = useFormulas({ includePublic: true, pageSize: 50 });
  const formulas = formulasData?.formulas ?? [];
  const [formulaQuery, setFormulaQuery] = useState('');

  // Params are edited as a local row list so empty/in-progress keys don't churn the object.
  const [paramRows, setParamRows] = useState<{ key: string; value: string }[]>(() =>
    Object.entries(value.params).map(([k, v]) => ({ key: k, value: String(v) })),
  );

  function syncParams(rows: { key: string; value: string }[]) {
    setParamRows(rows);
    const params: Record<string, number> = {};
    for (const r of rows) {
      if (r.key.trim() === '') continue;
      const n = Number(r.value);
      params[r.key] = Number.isFinite(n) ? n : 0;
    }
    onChange({ ...value, params });
  }

  const q = formulaQuery.toLowerCase();
  const filteredFormulas = formulas.filter(
    (f) => f.name.toLowerCase().includes(q) || f.formulaId.toLowerCase().includes(q),
  );
  const selectedFormula = formulas.find((f) => f.formulaId === value.formulaId);

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="flex items-center gap-2">
        <Input
          aria-label="ref name"
          placeholder="ref_name (e.g. sma_fast)"
          value={value.refName}
          onChange={(e) => onChange({ ...value, refName: e.target.value })}
        />
        <Select
          value={String(value.kind === ComponentKind.UNSPECIFIED ? ComponentKind.BUILTIN_INDICATOR : value.kind)}
          onValueChange={(v) => onChange({ ...value, kind: Number(v) as ComponentKind })}
        >
          <SelectTrigger className="w-52" aria-label="component kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={String(ComponentKind.BUILTIN_INDICATOR)}>Builtin indicator</SelectItem>
            <SelectItem value={String(ComponentKind.CUSTOM_FORMULA)}>Custom formula</SelectItem>
          </SelectContent>
        </Select>
        <Button type="button" size="sm" variant="ghost" onClick={onRemove}>
          Remove
        </Button>
      </div>

      {value.kind === ComponentKind.CUSTOM_FORMULA ? (
        <div className="space-y-1">
          <Input
            aria-label="formula search"
            placeholder="Search formulas…"
            value={formulaQuery}
            onChange={(e) => setFormulaQuery(e.target.value)}
          />
          {selectedFormula && (
            <p className="text-xs text-muted-foreground">Selected: {selectedFormula.name}</p>
          )}
          <div className="max-h-40 overflow-auto rounded-md border border-border">
            {filteredFormulas.length === 0 && (
              <p className="p-2 text-xs text-muted-foreground">No matching formulas</p>
            )}
            {filteredFormulas.map((f) => (
              <button
                key={f.formulaId}
                type="button"
                className={cn(
                  'block w-full px-3 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground',
                  f.formulaId === value.formulaId && 'bg-accent text-accent-foreground',
                )}
                onClick={() => onChange({ ...value, formulaId: f.formulaId })}
              >
                {f.name}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <Input
          aria-label="indicator name"
          placeholder="indicator name (e.g. SMA)"
          value={value.indicator}
          onChange={(e) => onChange({ ...value, indicator: e.target.value })}
        />
      )}

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">Params</p>
        {paramRows.map((row, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              aria-label="param key"
              placeholder="key (e.g. period)"
              value={row.key}
              onChange={(e) => {
                const rows = [...paramRows];
                rows[i] = { ...row, key: e.target.value };
                syncParams(rows);
              }}
            />
            <Input
              aria-label="param value"
              type="number"
              placeholder="value"
              value={row.value}
              onChange={(e) => {
                const rows = [...paramRows];
                rows[i] = { ...row, value: e.target.value };
                syncParams(rows);
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => syncParams(paramRows.filter((_, j) => j !== i))}
            >
              Remove
            </Button>
          </div>
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => syncParams([...paramRows, { key: '', value: '' }])}
        >
          Add param
        </Button>
      </div>
    </div>
  );
}
