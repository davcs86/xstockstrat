import { cn } from '../ui/utils';

// Single source of truth for the shared mono/uppercase eyebrow kicker label style (DRY guard rail).
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
