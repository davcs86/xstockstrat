'use client';
import React from 'react';
import { PlatformHeader, PLATFORM_SUBNAV } from '../shared/PlatformHeader';
import { useIsAdmin } from '@/hooks/useLiveStrategies';

interface AppShellProps {
  children: React.ReactNode;
  actions?: React.ReactNode;
}

export function AppShell({ children, actions }: AppShellProps) {
  const { data: isAdmin } = useIsAdmin();
  // Backfill management is an admin/operator surface (FR-7) — the entry is hidden from non-admins;
  // the BFF + backend re-enforce the scope on every mutating call.
  const subNav = isAdmin
    ? [...PLATFORM_SUBNAV.insights, { label: 'Backfills', href: '/insights/backfills' }]
    : PLATFORM_SUBNAV.insights;
  return (
    <div className="min-h-screen bg-background">
      <PlatformHeader segment="insights" subNav={subNav} actions={actions} />
      <main className="flex-1">{children}</main>
    </div>
  );
}
