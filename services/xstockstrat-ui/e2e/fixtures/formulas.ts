/**
 * Canonical custom-formula fixtures (formula list / picker flows).
 *
 * Shape source: `xstockstrat.indicators.v1.FormulaDefinition`
 * (packages/proto/indicators/v1/indicators.proto), list-row subset.
 *
 * Registered in e2e/fixtures/INVENTORY.md — update it when this file changes.
 */
import { TEST_USER_ID } from './users';

export const FORMULA_RSI = {
  formulaId: 'f-rsi',
  name: 'RSI Divergence',
  author: TEST_USER_ID,
  isPublic: true,
};

export const FORMULA_MACD = {
  formulaId: 'f-macd',
  name: 'MACD Cross',
  author: TEST_USER_ID,
  isPublic: false,
};

export const FORMULAS = [FORMULA_RSI, FORMULA_MACD];
