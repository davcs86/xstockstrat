'use client';

import React from 'react';
import { Badge } from '../ui/badge';
import type { EnvironmentMode } from '@/context/AccountContext';

/**
 * TradingModeBadge displays the deployment's fixed trading mode (paper or live).
 * It is read-only by design — the environment owns the mode and users cannot
 * switch it.
 */
export function TradingModeBadge({ mode }: { mode: EnvironmentMode | null }) {
  if (!mode) return null;
  return (
    <Badge
      variant={mode === 'live' ? 'live' : 'paper'}
      className="h-7 px-3 uppercase tracking-wide"
      title={`This environment routes all orders to the ${mode} broker. The mode is fixed and cannot be switched.`}
    >
      {mode}
    </Badge>
  );
}
