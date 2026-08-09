import { describe, expect, it } from 'vitest';
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from './breadcrumb';

// Minimal presence test (design.md: 5 primitives with no app-specific variant get a
// minimal test) — Breadcrumb has no app-specific variant.
describe('Breadcrumb', () => {
  it('exports Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage, BreadcrumbSeparator', () => {
    expect(Breadcrumb).toBeDefined();
    expect(BreadcrumbList).toBeDefined();
    expect(BreadcrumbItem).toBeDefined();
    expect(BreadcrumbLink).toBeDefined();
    expect(BreadcrumbPage).toBeDefined();
    expect(BreadcrumbSeparator).toBeDefined();
  });
});
