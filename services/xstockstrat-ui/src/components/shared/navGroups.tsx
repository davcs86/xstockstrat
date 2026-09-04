import React from 'react';
import { Target, MagnifyingGlass, Gauge, BookOpen, GearSix } from '@phosphor-icons/react';

// Single source of truth for the nav model (desktop PlatformHeader + mobile BottomTabBar). Its own
// module so BottomTabBar needn't import PlatformHeader — that cycle causes a prerender TDZ crash.

/** A secondary, in-segment navigation link. */
export interface SubNavItem {
  label: string;
  href: string;
  /** 'exact' matches the pathname exactly; 'prefix' matches by startsWith. Default 'prefix'. */
  match?: 'exact' | 'prefix';
}

export interface NavItem extends SubNavItem {
  /** Admin-only entry — hidden from non-admins; the BFF re-enforces on every call. */
  adminOnly?: boolean;
}

export interface NavGroup {
  key: string;
  label: string;
  icon: React.ReactNode;
  items: NavItem[];
  /**
   * Muted label rendered before this group in the mobile offcanvas nav. Invariant: set it on the
   * FIRST entry of the section it starts, else it attaches to the wrong group (not enforced in code).
   */
  sectionStart?: string;
}

export const HOME_HREF = '/insights/opportunities';

// Exported so the mobile BottomTabBar draws the same four primary groups as the desktop shell
// (single source of truth — DRY guard rail). Settings is the 5th group; the tab bar takes [0..4).
export const NAV_GROUPS: NavGroup[] = [
  {
    key: 'decide',
    label: 'Decide',
    icon: <Target className="h-4 w-4" weight="bold" />,
    items: [{ label: 'Opportunities', href: '/insights/opportunities' }],
    sectionStart: 'Navigate',
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
      { label: 'P&L Patterns', href: '/insights/pnl-patterns' },
      { label: 'Attribution', href: '/insights/attribution' },
      { label: 'Performance', href: '/insights/performance' },
      { label: 'Signal sources', href: '/config-ui/sources' },
      { label: 'Backfills', href: '/insights/backfills', adminOnly: true },
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
    sectionStart: 'Settings',
    items: [
      { label: 'Profile', href: '/accounts/profile' },
      { label: 'Notifications', href: '/accounts/notifications' },
      { label: 'Trader home', href: '/trader', match: 'exact' },
      { label: 'Insights home', href: '/insights', match: 'exact' },
      { label: 'Accounts', href: '/trader/accounts' },
      { label: 'Config', href: '/config-ui', match: 'exact' },
      { label: 'Users', href: '/config-ui/users', adminOnly: true },
      { label: 'Audit log', href: '/config-ui/audit' },
      { label: 'Fundamentals Scan', href: '/config-ui/fundamentals-scan' },
      { label: 'Authorized apps', href: '/accounts/authorized-apps' },
      { label: 'MCP tools', href: '/accounts/mcp-tools' },
    ],
  },
];
