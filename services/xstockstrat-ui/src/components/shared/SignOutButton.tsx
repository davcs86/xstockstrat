'use client';

import { useState } from 'react';
import { SignOut } from '@phosphor-icons/react';
import { Button } from '../ui/button';

// Every outcome but a JSON {redirect} goes to the login page, so a failed logout never strands the user.
// Below sm the header row has no room (D-63 fallback), so `menu` renders it in the mobile sheet instead.
export function SignOutButton({ variant = 'icon' }: { variant?: 'icon' | 'menu' }) {
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    let target = '/auth/login';
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST', redirect: 'manual' });
      if (res.ok) {
        const body = await res.json().catch(() => null);
        if (body && typeof body.redirect === 'string') target = body.redirect;
      }
    } catch {
      // Fall through to the login page.
    }
    try {
      window.location.assign(target);
    } finally {
      setPending(false);
    }
  }

  if (variant === 'menu') {
    return (
      <Button
        variant="ghost"
        className="min-h-11 w-full justify-start"
        disabled={pending}
        onClick={signOut}
      >
        <SignOut className="h-5 w-5" />
        Sign out
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="hidden size-11 sm:inline-flex sm:size-8"
      aria-label="Sign out"
      data-testid="sign-out"
      disabled={pending}
      onClick={signOut}
    >
      <SignOut className="h-5 w-5" />
    </Button>
  );
}
