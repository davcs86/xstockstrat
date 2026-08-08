import { cn } from '@/components/ui/utils';

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      data-testid="skeleton"
      aria-hidden="true"
      className={cn('animate-pulse rounded-2xl bg-muted', className)}
      {...props}
    />
  );
}

export { Skeleton };
