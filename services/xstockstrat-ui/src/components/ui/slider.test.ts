import { describe, expect, it } from 'vitest';
import { Slider } from './slider';

// Minimal presence test — Slider has no app-specific variant.
describe('Slider', () => {
  it('exports Slider', () => {
    expect(Slider).toBeDefined();
  });
});
