/**
 * @AC-27 (feature 282): the 038/039 seeds are each one two-row global INSERT … DO NOTHING,
 * and each down deletes only the global rows of its key.
 */
import { describe } from 'node:test';
import { globalIntSeedCases } from './globalIntSeedCases';

describe('servability seed migrations (@AC-27)', () => {
  globalIntSeedCases({
    suffix: '_marketdata_asset_refresh_interval',
    namespace: 'marketdata',
    key: 'marketdata.assets.refresh_interval_hours',
    consumingService: 'xstockstrat-marketdata',
    value: 6,
    min: 1,
    max: 24,
  });
  globalIntSeedCases({
    suffix: '_portfolio_servability_timeout',
    namespace: 'portfolio',
    key: 'portfolio.marketdata.servability_timeout_ms',
    consumingService: 'xstockstrat-portfolio',
    value: 2000,
    min: 500,
    max: 4000,
  });
});
