import { describe, expect, it } from 'vitest';
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from './accordion';

// Minimal presence test (design.md: 5 primitives with no app-specific variant get a
// minimal test) — Accordion has no app-specific variant.
describe('Accordion', () => {
  it('exports Accordion, AccordionItem, AccordionTrigger, AccordionContent', () => {
    expect(Accordion).toBeDefined();
    expect(AccordionItem).toBeDefined();
    expect(AccordionTrigger).toBeDefined();
    expect(AccordionContent).toBeDefined();
  });
});
