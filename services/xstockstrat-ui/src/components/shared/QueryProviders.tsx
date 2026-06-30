'use client';
import { useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { QueryNormalizerProvider } from '@normy/react-query';
import { normalizerConfig, createQueryClient } from '@/lib/queryClient';

/**
 * React Query + normalizer provider shared by the insights and config-ui segments (their
 * per-segment providers.tsx re-export this). Single source of truth (DRY guard rail).
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => createQueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <QueryNormalizerProvider queryClient={queryClient} normalizerConfig={normalizerConfig}>
        {children}
      </QueryNormalizerProvider>
    </QueryClientProvider>
  );
}
