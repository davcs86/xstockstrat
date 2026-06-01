'use client';
import { useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { QueryNormalizerProvider } from '@normy/react-query';
import { normalizerConfig, createQueryClient } from '@/app/lib/queryClient';

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
