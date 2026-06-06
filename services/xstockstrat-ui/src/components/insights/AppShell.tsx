'use client';
import React from 'react';
import { PlatformHeader, type SubNavItem } from '../shared/PlatformHeader';

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
  return (
    <div className="min-h-screen bg-background">
      <PlatformHeader segment="insights" subNav={INSIGHTS_SUBNAV} actions={actions} />
      <main className="flex-1">{children}</main>
    </div>
  );
}
