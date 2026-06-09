'use client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useFormulas } from '@/hooks/useFormulas';
import { ComponentKind } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import { ParameterType } from '@xstockstrat/proto/indicators/v1/indicators_pb';
import {
  isNumericType,
  paramDefaultNumber,
  paramDefaultRaw,
} from '@/components/insights/ParameterEditor';
import { BUILTIN_INDICATORS, defaultParamsFor, findIndicator } from '@/lib/strategyCatalog';

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

  const indicator = findIndicator(value.indicator);
  const selectedFormula = formulas.find((f) => f.formulaId === value.formulaId);

  function selectIndicator(name: string) {
    // Pre-fill the chosen indicator's parameters with their defaults so operators
    // only ever tune known, available knobs — never invent param keys.
    onChange({ ...value, indicator: name, params: defaultParamsFor(name) });
  }

  function selectFormula(formulaId: string) {
    // Pre-fill the formula's numeric parameters with their declared defaults so
    // each strategy component carries known, typed knobs. bool/string params are
    // not settable per component (FR-5) and are shown read-only below.
    const f = formulas.find((x) => x.formulaId === formulaId);
    const params: Record<string, number> = {};
    for (const p of f?.parameters ?? []) {
      if (isNumericType(p.type)) params[p.name] = paramDefaultNumber(p) ?? 0;
    }
    onChange({ ...value, formulaId, params });
  }

  function setParam(key: string, raw: string) {
    const n = Number(raw);
    onChange({ ...value, params: { ...value.params, [key]: Number.isFinite(n) ? n : 0 } });
  }

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
          value={String(
            value.kind === ComponentKind.UNSPECIFIED ? ComponentKind.BUILTIN_INDICATOR : value.kind,
          )}
          onValueChange={(v) => onChange({ ...value, kind: Number(v) as ComponentKind })}
        >
          <SelectTrigger className="w-52" aria-label="component kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={String(ComponentKind.BUILTIN_INDICATOR)}>
              Builtin indicator
            </SelectItem>
            <SelectItem value={String(ComponentKind.CUSTOM_FORMULA)}>Custom formula</SelectItem>
          </SelectContent>
        </Select>
        <Button type="button" size="sm" variant="ghost" onClick={onRemove}>
          Remove
        </Button>
      </div>

      {value.kind === ComponentKind.CUSTOM_FORMULA ? (
        <div className="space-y-2">
          <Combobox
            aria-label="formula"
            placeholder="Select a formula…"
            emptyText="No matching formulas"
            value={value.formulaId}
            onChange={selectFormula}
            options={formulas.map((f) => ({
              value: f.formulaId,
              label: f.name,
              hint: f.formulaId,
            }))}
          />

          {selectedFormula && selectedFormula.parameters.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Parameters</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {selectedFormula.parameters.map((p) =>
                  isNumericType(p.type) ? (
                    <div key={p.name}>
                      <label className="mb-1 block text-xs text-muted-foreground">{p.name}</label>
                      <Input
                        aria-label={`param ${p.name}`}
                        type="number"
                        value={value.params[p.name] ?? paramDefaultNumber(p) ?? 0}
                        onChange={(e) => setParam(p.name, e.target.value)}
                      />
                    </div>
                  ) : (
                    <div key={p.name}>
                      <label className="mb-1 block text-xs text-muted-foreground">{p.name}</label>
                      <Input
                        aria-label={`param ${p.name} (read-only)`}
                        disabled
                        value={paramDefaultRaw(p)}
                      />
                      <p className="text-[10px] text-muted-foreground">
                        {p.type === ParameterType.BOOL ? 'bool' : 'string'} — not settable per
                        strategy component
                      </p>
                    </div>
                  ),
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <Select value={indicator?.name ?? ''} onValueChange={selectIndicator}>
            <SelectTrigger aria-label="indicator name">
              <SelectValue placeholder="Select an indicator…" />
            </SelectTrigger>
            <SelectContent>
              {BUILTIN_INDICATORS.map((ind) => (
                <SelectItem key={ind.name} value={ind.name}>
                  {ind.name} — {ind.description}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {indicator && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Params</p>
              {indicator.params.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {indicator.name} takes no parameters.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {indicator.params.map((p) => (
                    <div key={p.key}>
                      <label className="mb-1 block text-xs text-muted-foreground">{p.label}</label>
                      <Input
                        aria-label={`param ${p.key}`}
                        type="number"
                        value={value.params[p.key] ?? p.default}
                        onChange={(e) => setParam(p.key, e.target.value)}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
