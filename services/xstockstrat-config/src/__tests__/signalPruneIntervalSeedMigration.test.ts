/**
 * @AC-19 (feature 281): the *_portfolio_signal_prune_interval seed is one two-row global INSERT … DO NOTHING,
 * and its down deletes only the global rows of the key.
 */
import { describe } from 'node:test';
import { globalIntSeedCases } from './globalIntSeedCases';

const SUFFIX = '_portfolio_signal_prune_interval';
const KEY = 'portfolio.watchlist.signal_prune_interval_seconds';

describe('signal prune interval seed migration (@AC-19)', () =>
  globalIntSeedCases({
    suffix: SUFFIX,
    namespace: 'portfolio',
    key: KEY,
    consumingService: 'xstockstrat-portfolio',
    value: 300,
    min: 60,
    max: 86400,
  }));
