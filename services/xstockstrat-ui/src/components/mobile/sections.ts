// Shared mobile "section" model: every screen's mobile view is a list of these typed sections, drawn
// by the one SectionRenderer so phone frames stay 1:1 with desktop without a second component tree.

import type { ReactNode } from 'react';
import type { EnumRender } from '@/lib/opportunityShared';

/**
 * One signal's fields, shared by the flat `signal` section and the grouped `signalGroup` section so
 * both render through the one `SignalRow` (no divergent mobile tree).
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
  muted?: boolean; // deny-listed row: a "Muted" marker in place of the action badge
  strategyId?: string;
  chips?: string[];
  expiry?: string;
}

export type Section =
  | { kind: 'head'; title: string; subtitle?: string }
  | { kind: 'stat'; label: string; value: string | number; tone?: 'up' | 'down' | 'neutral' }
  | ({ kind: 'signal' } & SignalItem)
  // One card per symbol grouping its signals; `signals` render through the same `SignalRow` as the flat `signal` kind.
  | { kind: 'signalGroup'; symbol: string; href?: string; signals: SignalItem[] }
  | { kind: 'chart'; label: string; render: ReactNode }
  | { kind: 'row'; label: string; value: ReactNode }
  | { kind: 'form'; render: ReactNode }
  | { kind: 'note'; text: string; tone?: 'info' | 'warn' }
  | { kind: 'action'; label: string; href?: string; onClick?: () => void };
