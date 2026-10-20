'use client';

import { Clock, CircleSlash } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { fmtNyDate } from '@/lib/protoTime';
import { MarkSource, type Position } from '@xstockstrat/proto/portfolio/v1/portfolio_pb';

/**
 * Stale-price marker for a position whose price is not live (feature 230, FR-5): a last-close mark
 * names its session date, an unpriced position says so. Live quote and broker marks render nothing.
 */
export function MarkBadge({ position }: { position: Pick<Position, 'markSource' | 'markAsOf'> }) {
  let label: string;
  let tip: string;
  let icon: React.ReactNode;
  switch (position.markSource) {
    case MarkSource.LAST_CLOSE:
      label = `Last close ${fmtNyDate(position.markAsOf) ?? ''}`.trim();
      tip = 'No live quote — valued at the last daily close';
      icon = <Clock />;
      break;
    case MarkSource.NONE:
      label = 'No price';
      tip = 'No quote or recent daily close — excluded from equity and P&L';
      icon = <CircleSlash />;
      break;
    default:
      return null;
  }
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="warning" aria-label={label}>
            {icon}
            {label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>{tip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
