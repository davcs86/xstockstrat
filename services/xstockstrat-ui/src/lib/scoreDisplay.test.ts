import { describe, it, expect } from 'vitest';
import { ConnectError, Code } from '@connectrpc/connect';
import {
  ratingVariant,
  scoreColor,
  formatSymbolYears,
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
