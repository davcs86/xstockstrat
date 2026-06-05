'use client';

import React from 'react';
import { AlertTriangle, CheckCircle2, HelpCircle } from 'lucide-react';
import { CredentialStatus } from '@xstockstrat/proto/trading/v1/trading_pb';
import { Badge } from '../ui/badge';

/**
 * CredentialStatusBadge surfaces whether a broker account's stored API secrets
 * are still working. OK renders subtly; INVALID/UNKNOWN are highlighted so the
 * user can act (re-enter the secret). UNSPECIFIED (never checked) renders nothing.
 */
export function CredentialStatusBadge({
  status,
  showOk = false,
}: {
  status: CredentialStatus;
  /** When false (default), a healthy account renders nothing to reduce noise. */
  showOk?: boolean;
}) {
  switch (status) {
    case CredentialStatus.INVALID:
      return (
        <Badge variant="destructive" className="gap-1" title="The broker rejected these API secrets. Update them to resume trading.">
          <AlertTriangle className="h-3 w-3" />
          Keys invalid
        </Badge>
      );
    case CredentialStatus.UNKNOWN:
      return (
        <Badge variant="warning" className="gap-1" title="The last credential check could not complete (broker unreachable). Will retry automatically.">
          <HelpCircle className="h-3 w-3" />
          Keys unverified
        </Badge>
      );
    case CredentialStatus.OK:
      return showOk ? (
        <Badge variant="info" className="gap-1" title="API secrets validated successfully.">
          <CheckCircle2 className="h-3 w-3" />
          Keys OK
        </Badge>
      ) : null;
    default:
      return null;
  }
}
