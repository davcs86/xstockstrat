import type { ReactNode } from 'react';

/**
 * Shared empty-state block for the "no data yet / nothing matches" case — distinct from the
 * one-line CardNotice and the error path. Keep the copy specific so it reads as intentional, not broken.
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div
      data-testid="empty-state"
      className="flex flex-col items-center justify-center gap-1.5 px-4 py-10 text-center"
    >
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="max-w-sm text-xs text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
