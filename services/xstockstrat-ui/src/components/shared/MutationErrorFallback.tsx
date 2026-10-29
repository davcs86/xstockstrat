'use client';
import { useEffect, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  clearMutationError,
  getMutationError,
  getServerMutationError,
  subscribeMutationError,
} from '@/lib/mutationErrorStore';

export function MutationErrorFallback() {
  const error = useSyncExternalStore(
    subscribeMutationError,
    getMutationError,
    getServerMutationError,
  );
  const pathname = usePathname();

  useEffect(() => {
    clearMutationError();
  }, [pathname]);

  if (!error) return null;

  // bottom-24 clears the mobile BottomTabBar (pb-20); the header is sticky top-0 z-40.
  return (
    <div className="fixed inset-x-4 bottom-24 z-50 sm:bottom-4 sm:left-auto sm:w-96">
      <Alert variant="destructive" role="alert">
        <AlertDescription>{error.message}</AlertDescription>
        <Button variant="ghost" size="sm" aria-label="Dismiss error" onClick={clearMutationError}>
          Dismiss
        </Button>
      </Alert>
    </div>
  );
}
