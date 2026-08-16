'use client';

import { useEffect, useState } from 'react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/components/ui/utils';

// Single source of truth for the sticky geometry (feature 139), so the nav's sticky `top` and each
// section's `scroll-margin-top` can never drift. The real header (PlatformHeader) is `sticky top-0`
// and is Row1 `h-[49px]` always + Row2 `h-9` (36px) `hidden sm:flex` → 49px below `sm`, 85px at
// `sm`+; this nav bar is `h-11` (44px). So the nav parks directly below the header, and a
// scrolled-to section clears both the header and the nav.
export const STICKY_NAV_TOP = 'top-[49px] sm:top-[85px]';
export const SECTION_SCROLL_MT = 'scroll-mt-[93px] sm:scroll-mt-[129px]'; // (49+44) / (85+44)

const OFFSET_BASE = 93; // header(49) + nav(44), below sm
const OFFSET_SM = 129; // header(85) + nav(44), at sm+

export interface SymbolGroup {
  id: string;
  label: string;
}

/**
 * Sticky segmented anchor-nav for the Symbol page's sections (feature 139). All sections stay
 * mounted; this only jumps to / highlights them:
 * - a shadcn `ToggleGroup type="single"` (its items are `<button>`s, not `role="tab"`, so they do
 *   not collide with tab-role e2e locators) inside `<nav aria-label="Symbol navigation">` — a label
 *   without the substring "Section", so it can't be confused with the header's own Section nav;
 * - an inbound `#hash` is honored on mount (read inside an effect, never during render, to avoid an
 *   SSR/hydration mismatch);
 * - an `IntersectionObserver` scroll-spy keeps the active chip truthful during free scroll (FR-2);
 * - selecting a chip writes a BARE `#id` hash via `history.replaceState`, leaving any `?strategy=`
 *   query seed untouched (FR-5) and triggering no Next navigation/refetch.
 */
export function SymbolSectionNav({ groups }: { groups: SymbolGroup[] }) {
  const [active, setActive] = useState<string>(groups[0]?.id ?? '');
  const groupKey = groups.map((g) => g.id).join(',');

  // Deep-link: honor an inbound #hash once on mount.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id && groupKey.split(',').includes(id)) {
      setActive(id);
      document.getElementById(id)?.scrollIntoView();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scroll-spy: highlight the topmost section clearing the sticky chrome. Re-subscribed when the
  // group set changes OR the `sm` breakpoint crosses, so the top inset stays correct on resize.
  useEffect(() => {
    const ids = groupKey.split(',').filter(Boolean);
    const mql = window.matchMedia('(min-width: 640px)');
    let io: IntersectionObserver | null = null;

    const connect = () => {
      io?.disconnect();
      const top = mql.matches ? OFFSET_SM : OFFSET_BASE;
      io = new IntersectionObserver(
        (entries) => {
          const vis = entries
            .filter((e) => e.isIntersecting)
            .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
          if (vis[0]) setActive(vis[0].target.id);
        },
        // Bottom inset (-55%) is empirically tuned so a short/empty section (e.g. an unfilled
        // Coverage) still wins the band as it reaches the top; adjust if a group is skipped.
        { rootMargin: `-${top}px 0px -55% 0px`, threshold: 0 },
      );
      ids.forEach((id) => {
        const el = document.getElementById(id);
        if (el) io!.observe(el);
      });
    };

    connect();
    mql.addEventListener('change', connect);
    return () => {
      io?.disconnect();
      mql.removeEventListener('change', connect);
    };
  }, [groupKey]);

  const onValueChange = (id: string) => {
    if (!id) return; // ToggleGroup deselect → controlled value unchanged, harmless no-op
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
    // Bare relative hash — never `${pathname}#id` — so ?strategy= in the query is preserved (FR-5).
    window.history.replaceState(null, '', `#${id}`);
  };

  return (
    <nav
      aria-label="Symbol navigation"
      className={cn(
        'sticky z-40 -mx-4 border-b bg-background/95 backdrop-blur-sm sm:-mx-6',
        STICKY_NAV_TOP,
      )}
    >
      <div className="min-w-0 overflow-x-auto px-4 sm:px-6">
        <ToggleGroup
          type="single"
          value={active}
          onValueChange={onValueChange}
          className="h-11 py-1"
        >
          {groups.map((g) => (
            <ToggleGroupItem key={g.id} value={g.id}>
              {g.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
    </nav>
  );
}
