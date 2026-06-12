'use client';
import React from 'react';
import { PlatformHeader, type SubNavItem } from '../shared/PlatformHeader';
import { useIsAdmin } from '@/hooks/useLiveStrategies';

const INSIGHTS_SUBNAV: SubNavItem[] = [
  { label: 'Dashboard', href: '/insights', match: 'exact' },
  { label: 'Strategies', href: '/insights/strategies' },
  { label: 'Formulas', href: '/insights/formulas' },
];

interface AppShellProps {
  children: React.ReactNode;
  actions?: React.ReactNode;
}

export function AppShell({ children, actions }: AppShellProps) {
  const { data: isAdmin } = useIsAdmin();
  // Backfill management is an admin/operator surface (FR-7) — the entry is hidden from non-admins;
  // the BFF + backend re-enforce the scope on every mutating call.
  const subNav = isAdmin
    ? [...INSIGHTS_SUBNAV, { label: 'Backfills', href: '/insights/backfills' }]
    : INSIGHTS_SUBNAV;
  return (
    <div className="min-h-screen bg-background">
      <PlatformHeader segment="insights" subNav={subNav} actions={actions} />
      <main className="flex-1">{children}</main>
    </div>
  );
}
