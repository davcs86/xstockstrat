import { cn } from '../ui/utils';

// Shared "eyebrow" kicker label (feature 124, FR-6): the mono/uppercase/tracked small-caps
// heading style repeated across 14 sites in 7 files. Single source of truth (DRY guard rail).
const TAGS = { div: 'div', p: 'p', dt: 'dt', span: 'span' } as const;

export function Eyebrow({
  as = 'div',
  className,
  children,
}: {
  as?: keyof typeof TAGS;
  className?: string;
  children: React.ReactNode;
}) {
  const Tag = TAGS[as];
  return (
    <Tag
      className={cn(
        'font-mono text-[9px] font-semibold uppercase tracking-[0.13em] text-muted-foreground',
        className,
      )}
    >
      {children}
    </Tag>
  );
}
