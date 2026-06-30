'use client';
import type { MessageInitShape } from '@bufbuild/protobuf';
import type { Value } from '@bufbuild/protobuf/wkt';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useListEditor } from '@/hooks/useListEditor';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  FormulaParameterSchema,
  ParameterType,
  type FormulaParameter,
} from '@xstockstrat/proto/indicators/v1/indicators_pb';

/** Init shape accepted by the typed indicators client for a FormulaParameter. */
export type FormulaParameterInit = MessageInitShape<typeof FormulaParameterSchema>;

/**
 * UI-side editable draft for a parameter definition. Values are kept as raw
 * strings while editing and coerced to the proto types on submit.
 */
export type ParameterDraft = {
  name: string;
  type: ParameterType;
  default: string;
  description: string;
  required: boolean;
  min: string;
  max: string;
};

const TYPE_OPTIONS: { value: ParameterType; label: string }[] = [
  { value: ParameterType.INT, label: 'int' },
  { value: ParameterType.FLOAT, label: 'float' },
  { value: ParameterType.BOOL, label: 'bool' },
  { value: ParameterType.STRING, label: 'string' },
];

export function isNumericType(t: ParameterType): boolean {
  return t === ParameterType.INT || t === ParameterType.FLOAT;
}

export function emptyParameter(): ParameterDraft {
  return {
    name: '',
    type: ParameterType.INT,
    default: '',
    description: '',
    required: false,
    min: '',
    max: '',
  };
}

/** Read a parameter's declared default as a raw display string. */
export function paramDefaultRaw(p: FormulaParameter): string {
  return defaultValueToRaw(p.defaultValue);
}

/** Read a parameter's declared default as a number (numeric params), or undefined. */
export function paramDefaultNumber(p: FormulaParameter): number | undefined {
  if (p.defaultValue?.kind.case === 'numberValue') return p.defaultValue.kind.value;
  return undefined;
}

function defaultValueToRaw(v?: Value): string {
  if (!v) return '';
  switch (v.kind.case) {
    case 'numberValue':
      return String(v.kind.value);
    case 'stringValue':
      return v.kind.value;
    case 'boolValue':
      return v.kind.value ? 'true' : 'false';
    default:
      return '';
  }
}

function defaultValueInit(type: ParameterType, raw: string): FormulaParameterInit['defaultValue'] {
  if (raw.trim() === '') return undefined;
  if (type === ParameterType.BOOL) {
    return { kind: { case: 'boolValue', value: raw.trim() === 'true' } };
  }
  if (type === ParameterType.STRING) {
    return { kind: { case: 'stringValue', value: raw } };
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return { kind: { case: 'numberValue', value: n } };
}

/** Convert a UI draft into the proto init shape sent to the indicators client. */
export function toParameterInit(d: ParameterDraft): FormulaParameterInit {
  const init: FormulaParameterInit = {
    name: d.name,
    type: d.type,
    description: d.description,
    required: d.required,
  };
  const dv = defaultValueInit(d.type, d.default);
  if (dv) init.defaultValue = dv;
  if (isNumericType(d.type)) {
    if (d.min.trim() !== '' && Number.isFinite(Number(d.min))) init.min = Number(d.min);
    if (d.max.trim() !== '' && Number.isFinite(Number(d.max))) init.max = Number(d.max);
  }
  return init;
}

/** Convert a persisted FormulaParameter back into an editable draft. */
export function draftFromProto(p: FormulaParameter): ParameterDraft {
  return {
    name: p.name,
    type: p.type,
    default: defaultValueToRaw(p.defaultValue),
    description: p.description,
    required: p.required,
    min: p.min !== undefined ? String(p.min) : '',
    max: p.max !== undefined ? String(p.max) : '',
  };
}

interface ParameterEditorProps {
  value: ParameterDraft[];
  onChange: (next: ParameterDraft[]) => void;
}

/**
 * Add / edit / reorder / remove editor for a list of typed parameter
 * definitions. Numeric (int/float) params expose min/max; bool/string hide them.
 */
export function ParameterEditor({ value, onChange }: ParameterEditorProps) {
  const { update, add, remove, move } = useListEditor(value, onChange, emptyParameter);

  return (
    <div className="space-y-3">
      {value.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No parameters. Add typed inputs read inside the formula via{' '}
          <code className="text-foreground">params[&quot;name&quot;]</code>.
        </p>
      )}
      {value.map((p, i) => {
        const numeric = isNumericType(p.type);
        return (
          <div key={i} className="space-y-2 rounded-md border border-border p-3">
            <div className="flex items-center gap-2">
              <Input
                aria-label={`parameter name ${i}`}
                placeholder="name (e.g. period)"
                value={p.name}
                onChange={(e) => update(i, { name: e.target.value })}
              />
              <Select
                value={String(p.type)}
                onValueChange={(v) => update(i, { type: Number(v) as ParameterType })}
              >
                <SelectTrigger className="w-32" aria-label={`parameter type ${i}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={String(o.value)}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`move parameter up ${i}`}
                onClick={() => move(i, -1)}
                disabled={i === 0}
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`move parameter down ${i}`}
                onClick={() => move(i, 1)}
                disabled={i === value.length - 1}
              >
                <ArrowDown className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`remove parameter ${i}`}
                onClick={() => remove(i)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Default</label>
                <Input
                  aria-label={`parameter default ${i}`}
                  value={p.default}
                  onChange={(e) => update(i, { default: e.target.value })}
                />
              </div>
              {numeric && (
                <>
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">Min</label>
                    <Input
                      aria-label={`parameter min ${i}`}
                      type="number"
                      value={p.min}
                      onChange={(e) => update(i, { min: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">Max</label>
                    <Input
                      aria-label={`parameter max ${i}`}
                      type="number"
                      value={p.max}
                      onChange={(e) => update(i, { max: e.target.value })}
                    />
                  </div>
                </>
              )}
              <label className="flex items-end gap-2 text-xs">
                <input
                  type="checkbox"
                  aria-label={`parameter required ${i}`}
                  checked={p.required}
                  onChange={(e) => update(i, { required: e.target.checked })}
                />
                Required
              </label>
            </div>
            <Input
              aria-label={`parameter description ${i}`}
              placeholder="description"
              value={p.description}
              onChange={(e) => update(i, { description: e.target.value })}
            />
          </div>
        );
      })}
      <Button type="button" size="sm" variant="outline" onClick={add}>
        <Plus className="mr-1.5 h-4 w-4" />
        Add parameter
      </Button>
    </div>
  );
}
