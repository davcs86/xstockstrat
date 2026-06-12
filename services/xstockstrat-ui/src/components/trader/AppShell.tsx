'use client';
import React from 'react';
import { PlatformHeader, PLATFORM_SUBNAV } from '../shared/PlatformHeader';
import { AccountSelector } from './AccountSelector';
import { AlertStream } from './AlertStream';
import { TradingModeBadge } from '../shared/TradingModeBadge';
import { useAccountContext } from '@/context/AccountContext';

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const { environmentMode } = useAccountContext();
  return (
    <div className="min-h-screen bg-background">
      <PlatformHeader
        segment="trader"
        subNav={PLATFORM_SUBNAV.trader}
        actions={
          <div className="flex items-center gap-2">
            <TradingModeBadge mode={environmentMode} />
            <AccountSelector />
            <AlertStream />
          </div>
        }
      />
      <main className="flex-1">{children}</main>
    </div>
  );
}
