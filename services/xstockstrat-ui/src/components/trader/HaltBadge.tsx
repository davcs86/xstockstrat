'use client';

import { Ban } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * Distinct halt marker for a halted broker account (feature 179). Amber `warning` reserves red for
 * credential-invalid and the RECONCILIATION HALT_SOURCE; icon + label + tooltip keep it distinct.
 * In `iconOnly` mode the compact form has no visible text, so the accessible name comes from
 * `aria-label` (C-17). `reason` is the system-generated halt_reason — React auto-escapes it.
 */
export function HaltBadge({ reason, iconOnly }: { reason?: string; iconOnly?: boolean }) {
  const label = reason ? `Halted: ${reason}` : 'Halted';
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="warning" aria-label={label}>
            <Ban />
            {!iconOnly && 'Halted'}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
