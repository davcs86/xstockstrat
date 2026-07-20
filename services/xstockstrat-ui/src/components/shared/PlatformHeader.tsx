'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart2,
  TrendingUp,
  Settings,
  Menu,
  Activity,
  KeyRound,
  ChevronDown,
} from 'lucide-react';
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

export type PlatformSegment = 'trader' | 'insights' | 'config' | 'accounts';

/** A secondary, in-segment navigation link rendered after the platform nav. */
export interface SubNavItem {
  label: string;
  href: string;
  /** 'exact' matches the pathname exactly; 'prefix' matches by startsWith. Default 'prefix'. */
  match?: 'exact' | 'prefix';
}

interface PlatformNavItem {
  segment: PlatformSegment;
  label: string;
  href: string;
  icon: React.ReactNode;
}

const PLATFORM_NAV: PlatformNavItem[] = [
  { segment: 'trader', label: 'Trader', href: '/trader', icon: <TrendingUp className="h-4 w-4" /> },
  {
    segment: 'insights',
    label: 'Insights',
    href: '/insights',
    icon: <BarChart2 className="h-4 w-4" />,
  },
  {
    segment: 'config',
    label: 'Config',
    href: '/config-ui',
    icon: <Settings className="h-4 w-4" />,
  },
  {
    segment: 'accounts',
    label: 'Accounts',
    href: '/accounts/authorized-apps',
    icon: <KeyRound className="h-4 w-4" />,
  },
];

const SEGMENT_HOME: Record<PlatformSegment, string> = {
  trader: '/trader',
  insights: '/insights',
  config: '/config-ui',
  accounts: '/accounts/authorized-apps',
};

/**
 * Canonical submodule lists for every segment — the single source of truth shared by
 * the desktop sub-nav (each shell passes `PLATFORM_SUBNAV[segment]`) and the mobile
 * accordion drawer, which renders every module's submodules so any destination is
 * reachable without first switching modules.
 */
export const PLATFORM_SUBNAV: Record<PlatformSegment, SubNavItem[]> = {
  trader: [
    { label: 'Dashboard', href: '/trader', match: 'exact' },
    { label: 'Positions', href: '/trader/positions' },
    { label: 'Accounts', href: '/trader/accounts' },
  ],
  insights: [
    { label: 'Dashboard', href: '/insights', match: 'exact' },
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

interface PlatformHeaderProps {
  /** Which top-level segment is active — drives nav highlighting and the logo link. */
  segment: PlatformSegment;
  /** Optional in-segment secondary navigation (e.g. Dashboard / Strategies / Formulas). */
  subNav?: SubNavItem[];
  /** Right-aligned actions (e.g. the account selector). */
  actions?: React.ReactNode;
}

/**
 * PlatformHeader is the single header shared across every UI segment
 * (trader, insights, config). It renders the logo, platform-level navigation,
 * an optional in-segment sub-nav, and a slot for right-aligned actions, with a
 * mobile sheet that exposes every module and its submodules as an accordion.
 */
export function PlatformHeader({ segment, subNav, actions }: PlatformHeaderProps) {
  const pathname = usePathname();
  // Accordion: the active module starts expanded; others collapse until tapped.
  const [expanded, setExpanded] = React.useState<PlatformSegment>(segment);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-sm">
      <div className="flex h-14 items-center gap-4 px-4 sm:px-6">
        {/* Logo */}
        <Link
          href={SEGMENT_HOME[segment]}
          className="flex items-center gap-2 text-primary font-semibold shrink-0"
        >
          <Activity className="h-5 w-5" />
          <span className="hidden sm:inline text-sm">xstockstrat</span>
        </Link>

        <Separator orientation="vertical" className="h-6 hidden sm:block" />

        {/* Desktop nav */}
        <nav className="hidden sm:flex items-center gap-1 flex-1">
          {PLATFORM_NAV.map((item) => (
            <a
              key={item.segment}
              href={item.href}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors',
                item.segment === segment
                  ? 'bg-accent text-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
              )}
            >
              {item.icon}
              {item.label}
            </a>
          ))}

          {subNav && subNav.length > 0 && (
            <>
              <Separator orientation="vertical" className="h-5 mx-1" />
              {subNav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'px-3 py-1.5 rounded-md text-sm transition-colors',
                    isItemActive(pathname, item)
                      ? 'text-foreground font-medium'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </>
          )}
        </nav>

        {/* Right actions */}
        <div className="flex items-center gap-2 ml-auto">
          {actions}
          {/* Mobile nav trigger */}
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="sm:hidden">
                <Menu className="h-5 w-5" />
                <span className="sr-only">Open menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="overflow-y-auto">
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2 text-primary">
                  <Activity className="h-5 w-5" />
                  xstockstrat
                </SheetTitle>
              </SheetHeader>
              {/* Two-level accordion: every module, each expandable to its submodules. */}
              <nav className="mt-6 flex flex-col gap-1">
                {PLATFORM_NAV.map((item) => {
                  const isActiveSegment = item.segment === segment;
                  const isOpen = expanded === item.segment;
                  const items = PLATFORM_SUBNAV[item.segment];
                  return (
                    <div key={item.segment} className="flex flex-col">
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        onClick={() =>
                          setExpanded((prev) =>
                            prev === item.segment ? ('' as PlatformSegment) : item.segment,
                          )
                        }
                        className={cn(
                          'flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors text-left',
                          isActiveSegment
                            ? 'bg-accent text-foreground font-medium'
                            : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
                        )}
                      >
                        {item.icon}
                        <span className="flex-1">{item.label}</span>
                        <ChevronDown
                          className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-180')}
                        />
                      </button>
                      {isOpen && (
                        <div className="ml-4 mt-1 flex flex-col gap-1 border-l border-border pl-3">
                          {items.map((sub) => (
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
    </header>
  );
}
