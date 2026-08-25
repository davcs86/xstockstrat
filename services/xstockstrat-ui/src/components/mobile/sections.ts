// Shared mobile "section" model (feature 083, FR-16). Every screen's mobile view is a list of
// these typed sections, drawn by the one SectionRenderer so the phone frames stay 1:1 with the
// desktop screens without a second component tree. Kinds mirror the design's section taxonomy:
// head / stat / signal / chart / row / form / note / action.

import type { ReactNode } from 'react';
import type { EnumRender } from '@/lib/opportunityShared';

/**
 * One signal's fields (feature 083; strategy/source/expiry tags added by feature 155, FR-4 — mobile
 * parity with the desktop `OpportunityRow`). Shared by the flat `signal` section and the grouped
 * `signalGroup` section so both render through the one `SignalRow` (no divergent mobile tree).
 */
export interface SignalItem {
  symbol: string;
  badge?: EnumRender;
  conviction?: number;
  // Strategy readiness (passing/total conditions) — rendered as a labeled meter alongside
  // conviction so the phone view isn't missing the desktop's readiness signal.
  readiness?: { passing: number; total: number };
  caption?: string;
  href?: string;
  muted?: boolean; // feature 132 — deny-listed row: a "Muted" marker in place of the action badge
  // feature 155 (FR-4) — the desktop-parity tags the flat mobile signal used to omit.
  strategyId?: string;
  chips?: string[];
  expiry?: string;
}

export type Section =
  | { kind: 'head'; title: string; subtitle?: string }
  | { kind: 'stat'; label: string; value: string | number; tone?: 'up' | 'down' | 'neutral' }
  | ({ kind: 'signal' } & SignalItem)
  // feature 155 (FR-4, AC-9) — one card per symbol grouping its signals, mirroring the desktop
  // `SymbolGroupCard`; `signals` render through the same `SignalRow` as the flat `signal` kind.
  | { kind: 'signalGroup'; symbol: string; href?: string; signals: SignalItem[] }
  | { kind: 'chart'; label: string; render: ReactNode }
  | { kind: 'row'; label: string; value: ReactNode }
  | { kind: 'form'; render: ReactNode }
  | { kind: 'note'; text: string; tone?: 'info' | 'warn' }
  | { kind: 'action'; label: string; href?: string; onClick?: () => void };
