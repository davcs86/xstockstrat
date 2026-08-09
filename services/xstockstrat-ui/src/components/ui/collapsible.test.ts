import { describe, expect, it } from 'vitest';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from './collapsible';

// Minimal presence test — Collapsible has no app-specific variant.
describe('Collapsible', () => {
  it('exports Collapsible, CollapsibleTrigger, CollapsibleContent', () => {
    expect(Collapsible).toBeDefined();
    expect(CollapsibleTrigger).toBeDefined();
    expect(CollapsibleContent).toBeDefined();
  });
});
