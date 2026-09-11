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
  /** No default — must be distinct from every other labeled region or nav link accessible name on
   *  the page, so a11y/e2e locators don't collide. */
  ariaLabel: string;
  /** An item without `href` (or the last item) renders as the current, non-link crumb. */
  items: { label: string; href?: string }[];
}

/** Page-level breadcrumb, rendered in each page's own layout (not the shared shell). */
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
