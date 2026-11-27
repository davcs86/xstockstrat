'use client';

import { useState } from 'react';
import { SignOut } from '@phosphor-icons/react';
import { Button } from '../ui/button';

// Every outcome but a JSON {redirect} goes to the login page, so a failed logout never strands the user.
export function SignOutButton() {
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

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-11 sm:size-8"
      aria-label="Sign out"
      data-testid="sign-out"
      disabled={pending}
      onClick={signOut}
    >
      <SignOut className="h-5 w-5" />
    </Button>
  );
}
