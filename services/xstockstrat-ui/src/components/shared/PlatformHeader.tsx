'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Target,
  MagnifyingGlass,
  Gauge,
  BookOpen,
  GearSix,
  List,
  CaretDown,
  Lightning,
} from '@phosphor-icons/react';
import { cn } from '../ui/utils';
import { Button } from '../ui/button';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '../ui/sheet';
import { Separator } from '../ui/separator';

// Physical routes are UNCHANGED (/trader | /insights | /config-ui | /accounts); the
// Decide / Discover / Engine / Book grouping is a presentation layer over them (feature 083,
// design.md § Frontend). Retained for back-compat with callers that still import them.
export type PlatformSegment = 'trader' | 'insights' | 'config' | 'accounts';

/** A secondary, in-segment navigation link. */
export interface SubNavItem {
  label: string;
  href: string;
  /** 'exact' matches the pathname exactly; 'prefix' matches by startsWith. Default 'prefix'. */
  match?: 'exact' | 'prefix';
}

interface NavGroup {
  key: string;
  label: string;
  icon: React.ReactNode;
  items: SubNavItem[];
}

// The four opportunities-first groups + a pinned Settings surface that keeps every admin/account
// screen reachable (C-10(a) — the nav-reachability test walks this rendered shell).
const NAV_GROUPS: NavGroup[] = [
  {
    key: 'decide',
    label: 'Decide',
    icon: <Target className="h-4 w-4" weight="bold" />,
    items: [{ label: 'Opportunities', href: '/insights/opportunities' }],
  },
  {
    key: 'discover',
    label: 'Discover',
    icon: <MagnifyingGlass className="h-4 w-4" weight="bold" />,
    items: [
      { label: 'Watchlists', href: '/insights/watchlists' },
      { label: 'Screener', href: '/insights/screener' },
    ],
  },
  {
    key: 'engine',
    label: 'Engine',
    icon: <Gauge className="h-4 w-4" weight="bold" />,
    items: [
      { label: 'Strategies', href: '/insights/strategies' },
      { label: 'Formulas', href: '/insights/formulas' },
      { label: 'Signal sources', href: '/config-ui/sources' },
      { label: 'Backfills', href: '/insights/backfills' },
    ],
  },
  {
    key: 'book',
    label: 'Book',
    icon: <BookOpen className="h-4 w-4" weight="bold" />,
    items: [
      { label: 'Exposure', href: '/trader/positions' },
      { label: 'Portfolio', href: '/trader/portfolio' },
      { label: 'Orders', href: '/trader/orders' },
    ],
  },
  {
    key: 'settings',
    label: 'Settings',
    icon: <GearSix className="h-4 w-4" weight="bold" />,
    items: [
      { label: 'Trader home', href: '/trader', match: 'exact' },
      { label: 'Insights home', href: '/insights', match: 'exact' },
      { label: 'Accounts', href: '/trader/accounts' },
      { label: 'Config', href: '/config-ui', match: 'exact' },
      { label: 'Audit log', href: '/config-ui/audit' },
      { label: 'Authorized apps', href: '/accounts/authorized-apps' },
      { label: 'MCP tools', href: '/accounts/mcp-tools' },
    ],
  },
];

const HOME_HREF = '/insights/opportunities';

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
export function PlatformHeader({ actions }: PlatformHeaderProps) {
  const pathname = usePathname();
  const { group: activeGroup, item: activeItem } = resolveActive(pathname);
  const [expanded, setExpanded] = React.useState<string>(activeGroup.key);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-sm">
      {/* Row 1 — logo, group tabs, actions */}
      <div className="flex h-[49px] items-center gap-4 px-4 sm:px-6">
        <Link
          href={HOME_HREF}
          className="flex items-center gap-2 text-primary font-semibold shrink-0"
        >
          <Lightning className="h-5 w-5" weight="fill" />
          <span className="hidden sm:inline text-sm">xstockstrat</span>
        </Link>

        <Separator orientation="vertical" className="h-6 hidden sm:block" />

        <nav aria-label="Primary" className="hidden sm:flex items-center gap-1 flex-1">
          {NAV_GROUPS.map((group) => {
            const isActive = group.key === activeGroup.key;
            return (
              <Link
                key={group.key}
                href={group.items[0].href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors border-l-2',
                  isActive
                    ? 'bg-accent text-foreground font-medium border-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/50 border-transparent',
                )}
              >
                {group.icon}
                {group.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2 ml-auto">
          {actions}
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
              <nav aria-label="Mobile" className="mt-6 flex flex-col gap-1">
                {NAV_GROUPS.map((group) => {
                  const isOpen = expanded === group.key;
                  return (
                    <div key={group.key} className="flex flex-col">
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        onClick={() => setExpanded((prev) => (prev === group.key ? '' : group.key))}
                        className={cn(
                          'flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors text-left',
                          group.key === activeGroup.key
                            ? 'bg-accent text-foreground font-medium'
                            : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
                        )}
                      >
                        {group.icon}
                        <span className="flex-1">{group.label}</span>
                        <CaretDown
                          className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-180')}
                        />
                      </button>
                      {isOpen && (
                        <div className="ml-4 mt-1 flex flex-col gap-1 border-l border-border pl-3">
                          {group.items.map((sub) => (
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
                      )}
                    </div>
                  );
                })}
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {/* Row 2 — breadcrumb + the active group's item links */}
      <div className="hidden sm:flex items-center gap-2 px-4 sm:px-6 h-9 border-t border-border/60">
        <span className="text-xs text-muted-foreground shrink-0" aria-label="Breadcrumb">
          <span className="text-muted-foreground">{activeGroup.label}</span>
          {activeItem && (
            <>
              <span className="mx-1.5 opacity-50">/</span>
              <span className="text-foreground font-medium">{activeItem.label}</span>
            </>
          )}
        </span>
        <Separator orientation="vertical" className="h-4 mx-1" />
        <nav aria-label="Section" className="flex items-center gap-1 overflow-x-auto">
          {activeGroup.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isItemActive(pathname, item) ? 'page' : undefined}
              className={cn(
                'px-2.5 py-1 rounded-md text-xs whitespace-nowrap transition-colors',
                isItemActive(pathname, item)
                  ? 'text-foreground font-medium bg-accent/60'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
