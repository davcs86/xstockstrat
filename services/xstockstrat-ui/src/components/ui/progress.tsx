'use client';

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Progress as ProgressPrimitive } from 'radix-ui';

import { cn } from '@/components/ui/utils';

// app-specific (feature 120): the firing-state taxonomy WatchlistReadiness.tsx's barClass()
// already encoded (buy=firing, paper=partially passing, sell=not passing, muted=no data) — a
// semantically meaningful state design.md promotes into a shared variant, not decoration. Not
// part of the shadcn preset's own variant set.
const progressIndicatorVariants = cva('size-full flex-1 transition-all', {
  variants: {
    variant: {
      default: 'bg-primary',
      buy: 'bg-buy',
      paper: 'bg-paper',
      sell: 'bg-sell',
      muted: 'bg-muted-foreground/40',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

function Progress({
  className,
  value,
  variant,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> &
  VariantProps<typeof progressIndicatorVariants>) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn(
        'relative flex h-2 w-full items-center overflow-x-hidden rounded-2xl bg-muted',
        className,
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn(progressIndicatorVariants({ variant }))}
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress, progressIndicatorVariants };
