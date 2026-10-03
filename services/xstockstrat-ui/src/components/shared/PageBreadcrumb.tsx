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
  /** A non-last item without `href` renders as plain text; the last item is the current crumb. */
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
                {isLast ? (
                  <BreadcrumbPage>{item.label}</BreadcrumbPage>
                ) : item.href ? (
                  <BreadcrumbLink href={item.href}>{item.label}</BreadcrumbLink>
                ) : (
                  <span className="text-muted-foreground">{item.label}</span>
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
