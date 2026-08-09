import { describe, expect, it } from 'vitest';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './tabs';

// Minimal presence test (design.md: 5 primitives with no app-specific variant get a
// minimal test) — Tabs has no app-specific variant, none of its 5 consumers need
// order-side/paper/status coloring.
describe('Tabs', () => {
  it('exports Tabs, TabsList, TabsTrigger, TabsContent', () => {
    expect(Tabs).toBeDefined();
    expect(TabsList).toBeDefined();
    expect(TabsTrigger).toBeDefined();
    expect(TabsContent).toBeDefined();
  });
});
