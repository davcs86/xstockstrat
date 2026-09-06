'use client';

import { useEffect, useState } from 'react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/components/ui/utils';

// Single source of truth for the sticky geometry, so the nav's sticky `top` and each section's
// `scroll-margin-top` can never drift from the header height (49px below sm, 85px at sm+; nav 44px).
export const STICKY_NAV_TOP = 'top-[49px] sm:top-[85px]';
export const SECTION_SCROLL_MT = 'scroll-mt-[93px] sm:scroll-mt-[129px]'; // (49+44) / (85+44)

const OFFSET_BASE = 93; // header(49) + nav(44), below sm
const OFFSET_SM = 129; // header(85) + nav(44), at sm+

export interface SymbolGroup {
  id: string;
  label: string;
}

/**
 * Sticky segmented anchor-nav for the Symbol page's sections; all sections stay mounted.
 * - items are `<button>`s, not `role="tab"`, and `<nav>` is labelled without the substring "Section",
 *   so neither collides with the header's own tab/Section nav locators;
 * - an inbound `#hash` is honored on mount inside an effect (never during render) to avoid a
 *   hydration mismatch;
 * - selecting a chip writes a BARE `#id` hash, leaving any `?strategy=` query seed untouched.
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

  // Scroll-spy: on a rAF-throttled scroll, highlight the last section whose top has passed the offset
  // line, with an explicit bottom-of-page rule so a final short section still highlights at the end.
  useEffect(() => {
    const ids = groupKey.split(',').filter(Boolean);
    if (ids.length === 0) return;
    const mql = window.matchMedia('(min-width: 640px)');
    let raf = 0;

    const compute = () => {
      raf = 0;
      const offset = mql.matches ? OFFSET_SM : OFFSET_BASE;
      // At (within 2px of) the bottom, the last section is the one in view even if it is too short
      // to scroll under the offset line — highlight it explicitly.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
        setActive(ids[ids.length - 1]);
        return;
      }
      // Otherwise: the last section whose top has scrolled to/above the offset line. Sections are in
      // DOM/visual order, so once one is still below the line, every later one is too → stop.
      let current = ids[0];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (el.getBoundingClientRect().top - offset <= 1) current = id;
        else break;
      }
      setActive(current);
    };

    const onScroll = () => {
      if (!raf) raf = window.requestAnimationFrame(compute);
    };

    compute(); // initial paint
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    mql.addEventListener('change', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      mql.removeEventListener('change', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [groupKey]);

  const onValueChange = (id: string) => {
    if (!id) return; // ToggleGroup deselect → controlled value unchanged, harmless no-op
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
    // Bare relative hash — never `${pathname}#id` — so ?strategy= in the query is preserved.
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
