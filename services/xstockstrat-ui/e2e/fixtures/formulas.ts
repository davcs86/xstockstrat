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

/**
 * A soft-deleted formula (feature 086) — GetFormula returns it with `deleted: true`. The edit page
 * renders it read-only with a "Deleted" badge and hides Save/Delete. Full definition shape (not a
 * list-row subset) because the detail page reads source/parameters/outputs.
 */
export const FORMULA_DELETED = {
  formulaId: 'f-deleted',
  name: 'Retired RSI',
  description: 'A formula that has been soft-deleted',
  source: 'result = {"value": 1.0}',
  author: TEST_USER_ID,
  isPublic: false,
  parameters: [],
  outputs: [],
  warmupPeriod: 0,
  deleted: true,
};
