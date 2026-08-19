'use client';

import { useState, type ReactNode } from 'react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/components/ui/utils';

export interface SymbolPanel {
  id: string;
  label: string;
  node: ReactNode;
}

/**
 * Groups related panels of a Symbol-page section (feature 139) into a responsive cluster:
 * - **desktop (`md`+)**: all panels rendered as equal-width **columns in one row**;
 * - **mobile (`< md`)**: a **tabbed panel** — a segmented tab bar picks one panel at a time.
 *
 * Every panel stays **mounted** in both layouts (inactive mobile panels are `hidden` via CSS, not
 * unmounted), so in-flight queries / a running backtest never tear down (FR-7) and the existing
 * `position-detail.spec.ts` assertions — which run at the default desktop viewport and therefore see
 * every panel as a visible column — stay green. The tab bar is a `ToggleGroup` (its items are
 * `role="radio"`, not `role="tab"`), so it does not reintroduce the `getByRole('tab')` collision the
 * top-level section nav was designed to avoid.
 *
 * 0 panels → renders nothing; 1 panel → renders it bare (no tab bar, no grid).
 */
export function SymbolPanelGroup({
  panels,
  ariaLabel,
}: {
  panels: SymbolPanel[];
  ariaLabel: string;
}) {
  const [active, setActive] = useState<string>(panels[0]?.id ?? '');

  if (panels.length === 0) return null;
  if (panels.length === 1) return <>{panels[0].node}</>;

  // Clamp the active id to a still-present panel (the set can change, e.g. the held-Position panel
  // appears once a position loads) so a stale id never hides every panel on mobile.
  const activeId = panels.some((p) => p.id === active) ? active : panels[0].id;

  return (
    <div>
      {/* Mobile tab bar — hidden on desktop, where the columns carry their own Card headers. */}
      <div className="mb-3 overflow-x-auto md:hidden">
        <ToggleGroup
          type="single"
          value={activeId}
          onValueChange={(v) => v && setActive(v)}
          aria-label={ariaLabel}
          className="h-10"
        >
          {panels.map((p) => (
            <ToggleGroupItem key={p.id} value={p.id}>
              {p.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {/* Panels: one-at-a-time (mounted) on mobile, equal columns in one row on desktop. `min-w-0`
          lets each grid item shrink below its content's intrinsic width (grid items default to
          `min-width:auto`), so a wide panel (e.g. the Position stat grid / an orders table) can't
          force horizontal page overflow at 390px — matching the pre-grouping block layout. */}
      <div className="grid gap-4 md:grid-flow-col md:auto-cols-fr md:items-start">
        {panels.map((p) => (
          <div
            key={p.id}
            className={cn(p.id === activeId ? 'block' : 'hidden', 'min-w-0 md:block')}
          >
            {p.node}
          </div>
        ))}
      </div>
    </div>
  );
}
