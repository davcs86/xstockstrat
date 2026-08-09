import { describe, expect, it } from 'vitest';
import {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuContent,
  NavigationMenuTrigger,
  NavigationMenuLink,
  NavigationMenuIndicator,
  NavigationMenuViewport,
  navigationMenuTriggerStyle,
} from './navigation-menu';

// Minimal presence test — no app-specific cva variant to guard here (unlike badge.tsx's
// buy/sell/paper), per product-spec.md FR-14's convention.
describe('navigation-menu', () => {
  it('exports the full component surface', () => {
    expect(NavigationMenu).toBeDefined();
    expect(NavigationMenuList).toBeDefined();
    expect(NavigationMenuItem).toBeDefined();
    expect(NavigationMenuContent).toBeDefined();
    expect(NavigationMenuTrigger).toBeDefined();
    expect(NavigationMenuLink).toBeDefined();
    expect(NavigationMenuIndicator).toBeDefined();
    expect(NavigationMenuViewport).toBeDefined();
  });

  it('navigationMenuTriggerStyle returns a non-empty className string', () => {
    expect(navigationMenuTriggerStyle().length).toBeGreaterThan(0);
  });
});
