import { describe, it, expect } from 'vitest';
import { ConnectError, Code } from '@connectrpc/connect';
import {
  ratingVariant,
  scoreColor,
  formatSymbolYears,
  formatComposite,
  compositeColor,
  isNotFoundError,
  TRADING_DAYS_PER_YEAR,
} from './scoreDisplay';

describe('formatSymbolYears', () => {
  it('renders trading days as symbol-years to one decimal', () => {
    expect(formatSymbolYears(252)).toBe('1.0 symbol-years');
    expect(formatSymbolYears(2100)).toBe('8.3 symbol-years');
    expect(formatSymbolYears(0)).toBe('0.0 symbol-years');
  });
});

describe('ratingVariant', () => {
  it.each([
    ['A', 'buy'],
    ['B', 'info'],
    ['C', 'warning'],
    ['D', 'destructive'],
    ['F', 'destructive'],
    ['', 'destructive'],
  ])('maps rating %s → %s', (rating, variant) => {
    expect(ratingVariant(rating)).toBe(variant);
  });
});

describe('scoreColor', () => {
  it('applies the 0.8 / 0.6 colour boundaries', () => {
    expect(scoreColor(0.8)).toBe('text-buy');
    expect(scoreColor(0.79)).toBe('text-paper');
    expect(scoreColor(0.6)).toBe('text-paper');
    expect(scoreColor(0.59)).toBe('text-destructive');
  });
});

describe('formatComposite', () => {
  it('renders the composite score as a fixed 3-decimal string', () => {
    expect(formatComposite(0.732)).toBe('0.732');
    expect(formatComposite(0.5)).toBe('0.500'); // always 3 decimals
    expect(formatComposite(1)).toBe('1.000');
    expect(formatComposite(0)).toBe('0.000');
  });
  it('grounds the queue colour assertion — 0.732 sits in the text-paper band', () => {
    expect(scoreColor(0.732)).toBe('text-paper');
  });
});

describe('TRADING_DAYS_PER_YEAR', () => {
  it('mirrors the analysis engine literal 252', () => {
    expect(TRADING_DAYS_PER_YEAR).toBe(252);
  });
});

describe('isNotFoundError', () => {
  it('is true only for a ConnectError with Code.NotFound', () => {
    expect(isNotFoundError(new ConnectError('nope', Code.NotFound))).toBe(true);
    expect(isNotFoundError(new ConnectError('boom', Code.Unavailable))).toBe(false);
    expect(isNotFoundError(new Error('generic'))).toBe(false);
    expect(isNotFoundError(undefined)).toBe(false);
    expect(isNotFoundError(null)).toBe(false);
  });
});

describe('compositeColor (feature 221)', () => {
  it('renders the neutral point muted, never destructive (@AC-1)', () => {
    expect(compositeColor(0.5)).toBe('text-muted-foreground');
  });
  it('colours only the tails, by direction from neutral (@AC-2)', () => {
    expect(compositeColor(0.72)).toBe('text-buy');
    expect(compositeColor(0.3)).toBe('text-sell');
    expect(compositeColor(0.75)).toBe('text-buy'); // one maxed axis now reads positive
  });
  it('keeps ±0.08 around 0.5 muted (inclusive edges)', () => {
    expect(compositeColor(0.58)).toBe('text-muted-foreground');
    expect(compositeColor(0.42)).toBe('text-muted-foreground');
    expect(compositeColor(0.581)).toBe('text-buy');
    expect(compositeColor(0.419)).toBe('text-sell');
  });
  it('leaves strategy-grade scoreColor unchanged (@AC-3)', () => {
    expect(scoreColor(0.65)).toBe('text-paper');
  });
});
