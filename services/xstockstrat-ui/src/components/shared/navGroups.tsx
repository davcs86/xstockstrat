import React from 'react';
import { Target, MagnifyingGlass, Gauge, BookOpen, GearSix } from '@phosphor-icons/react';

// The Decide / Discover / Engine / Book (+ Settings) nav model — the single source of truth for
// both the desktop PlatformHeader and the mobile BottomTabBar (feature 083). Extracted into its
// own module so BottomTabBar can consume NAV_GROUPS without importing PlatformHeader (which would
// form an import cycle → a "Cannot access before initialization" TDZ error at prerender).

/** A secondary, in-segment navigation link. */
export interface SubNavItem {
  label: string;
  href: string;
  /** 'exact' matches the pathname exactly; 'prefix' matches by startsWith. Default 'prefix'. */
  match?: 'exact' | 'prefix';
}

export interface NavItem extends SubNavItem {
  /** Admin-only entry (FR-7) — hidden from non-admins; the BFF re-enforces on every call. */
  adminOnly?: boolean;
}

export interface NavGroup {
  key: string;
  label: string;
  icon: React.ReactNode;
  items: NavItem[];
  /**
   * Text for a muted, non-interactive SidebarGroupLabel rendered immediately before this
   * group in the mobile offcanvas nav (FR-3, feature 126). Purely visual — no id, no
   * aria-labelledby. Invariant: must be set on the FIRST NAV_GROUPS entry of the section it
   * starts, or the label silently attaches to the wrong group — not enforced at compile/
   * runtime, only by this comment.
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
