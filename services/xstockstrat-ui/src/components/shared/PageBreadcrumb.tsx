import { Fragment } from 'react';
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '../ui/breadcrumb';

interface PageBreadcrumbProps {
  /** No default — the collision-avoidance mechanism itself (feature 124, FR-10). Must be
   *  distinct from any other labeled region or nav `Link` accessible name on the same page;
   *  see `fails.md` 2026-08-09 for the `getByLabel`/`getByRole('link', ...)` collision classes
   *  this guards against. */
  ariaLabel: string;
  /** An item without `href` (or the last item) renders as the current, non-link crumb. */
  items: { label: string; href?: string }[];
}

/**
 * Page-level breadcrumb (feature 124, FR-10b) — generalizes the pattern `NamespaceEditor.tsx`
 * and `config-ui/audit/page.tsx` established before this component existed. Moved out of the
 * shared shell (`PlatformHeader.tsx`'s Row 2, removed by FR-10a) into each page's own layout.
 */
export function PageBreadcrumb({ ariaLabel, items }: PageBreadcrumbProps) {
  return (
    <Breadcrumb aria-label={ariaLabel}>
      <BreadcrumbList>
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          return (
            <Fragment key={item.label}>
              <BreadcrumbItem>
                {!isLast && item.href ? (
                  <BreadcrumbLink href={item.href}>{item.label}</BreadcrumbLink>
                ) : (
                  <BreadcrumbPage>{item.label}</BreadcrumbPage>
                )}
              </BreadcrumbItem>
              {!isLast && <BreadcrumbSeparator />}
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
