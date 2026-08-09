'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { List, Lightning, Sparkle } from '@phosphor-icons/react';
import { cn } from '../ui/utils';
import { Button } from '../ui/button';
import { ChromeProvider, useChrome } from '@/context/ChromeContext';
import { CopilotRail } from '../copilot/CopilotRail';
import { BottomTabBar } from '../mobile/BottomTabBar';
import { NAV_GROUPS, HOME_HREF, type SubNavItem, type NavItem, type NavGroup } from './navGroups';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '../ui/sheet';
import { Separator } from '../ui/separator';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '../ui/accordion';
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '../ui/breadcrumb';
import {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuLink,
} from '../ui/navigation-menu';

// Physical routes are UNCHANGED (/trader | /insights | /config-ui | /accounts); the
// Decide / Discover / Engine / Book grouping is a presentation layer over them (feature 083,
// design.md § Frontend). Retained for back-compat with callers that still import them.
export type PlatformSegment = 'trader' | 'insights' | 'config' | 'accounts';

/**
 * Provider-free admin check for the shared shell. useIsAdmin (react-query) is unavailable in
 * the /accounts and /config-ui segments (no QueryClientProvider), so the header reads the
 * non-sensitive `{ isAdmin }` flag from /api/auth/me directly. Defaults false until resolved.
 */
function useHeaderIsAdmin(): boolean {
  const [isAdmin, setIsAdmin] = React.useState(false);
  React.useEffect(() => {
    let alive = true;
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d) setIsAdmin(Boolean(d.isAdmin));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return isAdmin;
}

// The four opportunities-first groups + a pinned Settings surface that keeps every admin/account
// screen reachable (C-10(a) — the nav-reachability test walks this rendered shell).

/**
 * Canonical submodule lists per legacy segment — retained for any caller still importing it
 * (e.g. the mobile-companion renderer). The desktop shell now renders NAV_GROUPS.
 */
export const PLATFORM_SUBNAV: Record<PlatformSegment, SubNavItem[]> = {
  trader: [
    { label: 'Dashboard', href: '/trader', match: 'exact' },
    { label: 'Positions', href: '/trader/positions' },
    { label: 'Accounts', href: '/trader/accounts' },
  ],
  insights: [
    { label: 'Opportunities', href: '/insights/opportunities' },
    { label: 'Strategies', href: '/insights/strategies' },
    { label: 'Formulas', href: '/insights/formulas' },
    { label: 'Screener', href: '/insights/screener' },
    { label: 'Watchlists', href: '/insights/watchlists' },
  ],
  config: [
    { label: 'Namespaces', href: '/config-ui', match: 'exact' },
    { label: 'Audit Log', href: '/config-ui/audit' },
    { label: 'Sources', href: '/config-ui/sources' },
  ],
  accounts: [
    { label: 'Authorized Apps', href: '/accounts/authorized-apps', match: 'exact' },
    { label: 'MCP Tools', href: '/accounts/mcp-tools', match: 'exact' },
  ],
};

function isItemActive(pathname: string | null, item: SubNavItem): boolean {
  if (!pathname) return false;
  return item.match === 'exact' ? pathname === item.href : pathname.startsWith(item.href);
}

/** The group + item the current pathname resolves to (for active-mark + breadcrumb). */
function resolveActive(pathname: string | null): { group: NavGroup; item?: SubNavItem } {
  for (const group of NAV_GROUPS) {
    const item = group.items.find((i) => isItemActive(pathname, i));
    if (item) return { group, item };
  }
  // Dynamic Decide routes (e.g. /insights/market/[symbol]) resolve to the Decide group.
  if (pathname?.startsWith('/insights/market')) return { group: NAV_GROUPS[0] };
  return { group: NAV_GROUPS[0] };
}

interface PlatformHeaderProps {
  /** Legacy: active segment (ignored — the active group is derived from the pathname). */
  segment?: PlatformSegment;
  /** Legacy: per-segment sub-nav (ignored — the shell renders NAV_GROUPS). */
  subNav?: SubNavItem[];
  /** Right-aligned actions (e.g. the account selector). */
  actions?: React.ReactNode;
}

/**
 * PlatformHeader — the shared opportunities-first shell chrome. A sticky top bar with the
 * Decide / Discover / Engine / Book (+ Settings) group nav, a `Group / Page` breadcrumb, and a
 * right-aligned actions slot, plus a mobile sheet that exposes every group and item so any
 * destination is reachable without switching context first.
 */
/**
 * Copilot rail toggle — accent-filled when the rail is open (FR-19). Consumes ChromeContext,
 * so it must render inside the ChromeProvider mounted by PlatformHeader below.
 */
function CopilotToggle() {
  const { showCopilot, toggleCopilot } = useChrome();
  return (
    <Button
      variant={showCopilot ? 'default' : 'ghost'}
      size="icon"
      aria-label="Toggle copilot"
      aria-pressed={showCopilot}
      data-testid="copilot-toggle"
      onClick={toggleCopilot}
    >
      <Sparkle className="h-5 w-5" weight={showCopilot ? 'fill' : 'regular'} />
    </Button>
  );
}

/**
 * PlatformHeader mounts the ChromeProvider so every segment shares the Copilot rail state, and
 * renders the rail alongside the header chrome (default off — FR-4).
 */
export function PlatformHeader(props: PlatformHeaderProps) {
  return (
    <ChromeProvider>
      <PlatformHeaderInner {...props} />
      <CopilotRail />
      {/* Fixed mobile bottom nav (FR-16). Content wrappers add pb for clearance (see AppShells). */}
      <BottomTabBar />
    </ChromeProvider>
  );
}

function PlatformHeaderInner({ actions }: PlatformHeaderProps) {
  const pathname = usePathname();
  const isAdmin = useHeaderIsAdmin();
  const { group: activeGroup, item: activeItem } = resolveActive(pathname);
  const [expanded, setExpanded] = React.useState<string>(activeGroup.key);
  // Admin-only entries (Backfills, FR-7) are hidden from non-admins.
  const visibleItems = (items: NavItem[]) => items.filter((i) => !i.adminOnly || isAdmin);
  const activeItems = visibleItems(activeGroup.items);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-sm">
      {/* Row 1 — logo, group tabs, actions */}
      <div className="flex h-[49px] items-center gap-2 px-3 sm:gap-4 sm:px-6">
        <Link
          href={HOME_HREF}
          className="flex items-center gap-2 text-primary font-semibold shrink-0"
        >
          <Lightning className="h-5 w-5" weight="fill" />
          <span className="hidden sm:inline text-sm">xstockstrat</span>
        </Link>

        <Separator orientation="vertical" className="h-6 hidden sm:block" />

        {/* asChild + a nested Link (not a `render` prop) — @radix-ui/react-navigation-menu@1.2.22
            (the version this radix-ui unified package re-exports) is the classic forwardRef/
            asChild-based API, not the newer render-prop-based one design.md assumed; verified via
            the installed package source (zero "render" occurrences, NavigationMenuLink built with
            forwardRef) — see 121-shadcn-migration-medium-confidence context.md Step 18. */}
        <NavigationMenu
          aria-label="Primary"
          viewport={false}
          className="hidden sm:flex items-center gap-1 flex-1"
        >
          <NavigationMenuList className="gap-1">
            {NAV_GROUPS.map((group) => {
              const isActive = group.key === activeGroup.key;
              return (
                <NavigationMenuItem key={group.key}>
                  <NavigationMenuLink
                    asChild
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors border-l-2',
                      isActive
                        ? 'bg-accent text-foreground font-medium border-primary'
                        : 'text-muted-foreground hover:text-foreground hover:bg-accent/50 border-transparent',
                    )}
                  >
                    <Link href={group.items[0].href}>
                      {group.icon}
                      {group.label}
                    </Link>
                  </NavigationMenuLink>
                </NavigationMenuItem>
              );
            })}
          </NavigationMenuList>
        </NavigationMenu>

        <div className="flex items-center gap-2 ml-auto">
          {actions}
          <CopilotToggle />
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="sm:hidden">
                <List className="h-5 w-5" />
                <span className="sr-only">Open menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="overflow-y-auto">
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2 text-primary">
                  <Lightning className="h-5 w-5" weight="fill" />
                  xstockstrat
                </SheetTitle>
              </SheetHeader>
              <nav aria-label="Mobile" className="mt-6">
                <Accordion
                  type="single"
                  collapsible
                  value={expanded}
                  onValueChange={(v) => setExpanded(v ?? '')}
                >
                  {NAV_GROUPS.map((group) => (
                    <AccordionItem key={group.key} value={group.key}>
                      <AccordionTrigger
                        className={cn(
                          group.key === activeGroup.key
                            ? 'bg-accent text-foreground font-medium'
                            : 'text-muted-foreground',
                        )}
                      >
                        {group.icon}
                        <span className="flex-1">{group.label}</span>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="flex flex-col gap-1">
                          {visibleItems(group.items).map((sub) => (
                            <SheetClose asChild key={sub.href}>
                              <Link
                                href={sub.href}
                                className={cn(
                                  'px-3 py-2 rounded-md text-sm transition-colors',
                                  isItemActive(pathname, sub)
                                    ? 'bg-accent text-foreground font-medium'
                                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
                                )}
                              >
                                {sub.label}
                              </Link>
                            </SheetClose>
                          ))}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {/* Row 2 — breadcrumb + the active group's item links */}
      <div className="hidden sm:flex items-center gap-2 px-4 sm:px-6 h-9 border-t border-border/60">
        <Breadcrumb aria-label="Breadcrumb" className="text-xs shrink-0">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>{activeGroup.label}</BreadcrumbPage>
            </BreadcrumbItem>
            {activeItem && (
              <>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage className="text-foreground font-medium">
                    {activeItem.label}
                  </BreadcrumbPage>
                </BreadcrumbItem>
              </>
            )}
          </BreadcrumbList>
        </Breadcrumb>
        <Separator orientation="vertical" className="h-4 mx-1" />
        <NavigationMenu
          aria-label="Section"
          viewport={false}
          className="flex items-center gap-1 overflow-x-auto"
        >
          <NavigationMenuList className="gap-1">
            {activeItems.map((item) => (
              <NavigationMenuItem key={item.href}>
                <NavigationMenuLink
                  asChild
                  aria-current={isItemActive(pathname, item) ? 'page' : undefined}
                  className={cn(
                    'px-2.5 py-1 rounded-md text-xs whitespace-nowrap transition-colors',
                    isItemActive(pathname, item)
                      ? 'text-foreground font-medium bg-accent/60'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
                  )}
                >
                  <Link href={item.href}>{item.label}</Link>
                </NavigationMenuLink>
              </NavigationMenuItem>
            ))}
          </NavigationMenuList>
        </NavigationMenu>
      </div>
    </header>
  );
}
