'use client';
import type { MessageInitShape } from '@bufbuild/protobuf';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  FormulaOutputSchema,
  type FormulaOutput,
} from '@xstockstrat/proto/indicators/v1/indicators_pb';

/** Init shape accepted by the typed indicators client for a FormulaOutput. */
export type FormulaOutputInit = MessageInitShape<typeof FormulaOutputSchema>;

/** UI-side editable draft for a declared output series. */
export type OutputDraft = {
  name: string;
  description: string;
};

export function emptyOutput(): OutputDraft {
  return { name: '', description: '' };
}

/** Convert a UI draft into the proto init shape sent to the indicators client. */
export function toOutputInit(d: OutputDraft): FormulaOutputInit {
  return { name: d.name, description: d.description };
}

/** Convert a persisted FormulaOutput back into an editable draft. */
export function outputDraftFromProto(o: FormulaOutput): OutputDraft {
  return { name: o.name, description: o.description };
}

interface OutputEditorProps {
  value: OutputDraft[];
  onChange: (next: OutputDraft[]) => void;
}

/**
 * Add / edit / reorder / remove editor for a formula's declared output series.
 * The primary "value" series is implicit and never listed here; each declared
 * output becomes addressable in strategy rules as `<ref_name>.<name>`, and the
 * sandbox enforces that the formula actually emits every declared series.
 */
export function OutputEditor({ value, onChange }: OutputEditorProps) {
  function update(i: number, patch: Partial<OutputDraft>) {
    onChange(value.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  }
  function add() {
    onChange([...value, emptyOutput()]);
  }
  function remove(i: number) {
    onChange(value.filter((_, j) => j !== i));
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= value.length) return;
    const next = value.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        The primary <code className="text-foreground">value</code> series is always available.
        Declare additional series your formula returns (e.g.{' '}
        <code className="text-foreground">upper</code>) to reference them in strategy rules as{' '}
        <code className="text-foreground">ref.series</code>.
      </p>
      {value.map((o, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            aria-label={`output name ${i}`}
            placeholder="name (e.g. upper)"
            value={o.name}
            onChange={(e) => update(i, { name: e.target.value })}
          />
          <Input
            aria-label={`output description ${i}`}
            placeholder="description"
            value={o.description}
            onChange={(e) => update(i, { description: e.target.value })}
          />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={`move output up ${i}`}
            onClick={() => move(i, -1)}
            disabled={i === 0}
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={`move output down ${i}`}
            onClick={() => move(i, 1)}
            disabled={i === value.length - 1}
          >
            <ArrowDown className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={`remove output ${i}`}
            onClick={() => remove(i)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" onClick={add}>
        <Plus className="mr-1.5 h-4 w-4" />
        Add output
      </Button>
    </div>
  );
}
