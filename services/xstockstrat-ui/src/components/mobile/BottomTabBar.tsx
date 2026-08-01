'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_GROUPS } from '../shared/navGroups';
import { cn } from '../ui/utils';

// The four primary groups (Decide/Discover/Engine/Book); Settings (index 4) stays desktop-only.
const TABS = NAV_GROUPS.slice(0, 4);

function isGroupActive(pathname: string | null, hrefs: string[]): boolean {
  if (!pathname) return false;
  // Signal detail lives under /insights/market — it belongs to Decide (mirrors the desktop shell).
  if (pathname.startsWith('/insights/market'))
    return hrefs.some((h) => h.includes('/opportunities'));
  return hrefs.some(
    (h) => pathname === h || pathname.startsWith(h + '/') || pathname.startsWith(h),
  );
}

/**
 * Fixed mobile bottom tab bar (feature 083, FR-16). Mirrors the desktop shell's four primary
 * groups, mobile-only (`sm:hidden`). Every tab is ≥44px tall (tap-target floor) and links to the
 * group's first screen. Mounted globally by PlatformHeader so it rides every route.
 */
export function BottomTabBar() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Mobile primary"
      data-testid="mobile-tab-bar"
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-background/95 backdrop-blur-sm sm:hidden"
    >
      {TABS.map((group) => {
        const href = group.items[0].href;
        const active = isGroupActive(
          pathname,
          group.items.map((i) => i.href),
        );
        return (
          <Link
            key={group.key}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px]',
              active ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            {group.icon}
            {group.label}
          </Link>
        );
      })}
    </nav>
  );
}
