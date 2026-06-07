'use client';
import { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AVAILABLE_LIBRARIES,
  FORBIDDEN,
  FORMULA_TEMPLATES,
  INPUT_CONTRACT,
  OUTPUT_CONTRACT,
  SANDBOX_LIMITS,
  type FormulaTemplate,
} from './formulaReference';

type Tab = 'contract' | 'libraries' | 'limits' | 'templates';

const TABS: { id: Tab; label: string }[] = [
  { id: 'contract', label: 'Contract' },
  { id: 'libraries', label: 'Libraries' },
  { id: 'limits', label: 'Limits' },
  { id: 'templates', label: 'Templates' },
];

interface FormulaReferencePanelProps {
  onLoadTemplate: (template: FormulaTemplate) => void;
  onClose?: () => void;
}

export function FormulaReferencePanel({ onLoadTemplate, onClose }: FormulaReferencePanelProps) {
  const [tab, setTab] = useState<Tab>('contract');

  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <p className="text-sm font-semibold">Reference</p>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Hide reference"
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="flex gap-1 border-b border-border px-2 py-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
              tab === t.id
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent/40'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3 text-xs">
        {tab === 'contract' && (
          <div className="space-y-3">
            <div>
              <p className="mb-1 font-mono text-foreground">data →</p>
              <p className="text-muted-foreground">{INPUT_CONTRACT}</p>
            </div>
            <div>
              <p className="mb-1 font-mono text-foreground">→ result</p>
              <p className="text-muted-foreground">{OUTPUT_CONTRACT}</p>
            </div>
            <div className="rounded-md bg-secondary/50 p-2">
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Blocked
              </p>
              <div className="flex flex-wrap gap-1">
                {FORBIDDEN.map((f) => (
                  <code key={f} className="rounded bg-background/70 px-1 py-0.5 text-[11px] text-destructive">
                    {f}
                  </code>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === 'libraries' && (
          <div className="space-y-3">
            {AVAILABLE_LIBRARIES.map((lib) => (
              <div key={lib.name}>
                <div className="flex items-center gap-2">
                  <Badge variant="info">{lib.name}</Badge>
                  <code className="text-[11px] text-muted-foreground">{lib.importAs}</code>
                </div>
                <p className="mt-1 text-muted-foreground">{lib.blurb}</p>
                <pre className="mt-1 overflow-x-auto rounded-md bg-secondary/50 p-2 text-[11px] text-foreground/80">
                  {lib.examples.join('\n')}
                </pre>
              </div>
            ))}
          </div>
        )}

        {tab === 'limits' && (
          <div className="space-y-2">
            {SANDBOX_LIMITS.map((l) => (
              <div key={l.label} className="rounded-md bg-secondary/50 p-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground">{l.label}</span>
                  <span className="tabular-nums text-foreground">{l.value}</span>
                </div>
                <p className="mt-0.5 text-muted-foreground">{l.note}</p>
              </div>
            ))}
          </div>
        )}

        {tab === 'templates' && (
          <div className="space-y-2">
            <p className="text-muted-foreground">
              Load a starter into the editor and run cell. This replaces the current code.
            </p>
            {FORMULA_TEMPLATES.map((t) => (
              <div key={t.id} className="rounded-md border border-border/60 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-foreground">{t.label}</span>
                  <Button size="sm" variant="outline" onClick={() => onLoadTemplate(t)}>
                    Load
                  </Button>
                </div>
                <p className="mt-1 text-muted-foreground">{t.description}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
