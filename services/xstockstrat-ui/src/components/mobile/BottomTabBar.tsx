'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_GROUPS } from '../shared/navGroups';
import { cn } from '../ui/utils';
import {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuLink,
} from '../ui/navigation-menu';

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
    <NavigationMenu
      aria-label="Mobile primary"
      data-testid="mobile-tab-bar"
      viewport={false}
      // max-w-none overrides ui/navigation-menu.tsx's default `max-w-max` root style — this bar
      // is `fixed inset-x-0`, which needs to span edge-to-edge, not shrink to its own content.
      className="fixed inset-x-0 bottom-0 z-40 flex max-w-none border-t border-border bg-background/95 backdrop-blur-sm sm:hidden"
    >
      <NavigationMenuList className="flex w-full gap-0">
        {TABS.map((group) => {
          const href = group.items[0].href;
          const active = isGroupActive(
            pathname,
            group.items.map((i) => i.href),
          );
          return (
            <NavigationMenuItem key={group.key} className="flex-1">
              <NavigationMenuLink
                asChild
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px]',
                  active ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                <Link href={href}>
                  {group.icon}
                  {group.label}
                </Link>
              </NavigationMenuLink>
            </NavigationMenuItem>
          );
        })}
      </NavigationMenuList>
    </NavigationMenu>
  );
}
