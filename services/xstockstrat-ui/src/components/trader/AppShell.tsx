'use client';
import React from 'react';
import { PlatformHeader } from '../shared/PlatformHeader';

interface AppShellProps {
  children: React.ReactNode;
  actions?: React.ReactNode;
}

export function AppShell({ children, actions }: AppShellProps) {
  return (
    <div className="min-h-screen bg-background">
      <PlatformHeader segment="trader" actions={actions} />
      <main className="flex-1">{children}</main>
    </div>
  );
}
