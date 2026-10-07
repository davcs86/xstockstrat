/**
 * Canonical template-catalog fixtures (feature 224 — private-by-default templates).
 *
 * Connect-JSON (camelCase) shapes of `indicators.FormulaTemplate`, `analysis.StrategyTemplate` and
 * `ingest.SourceTemplate`; `meta.kind` is the numeric `common.TemplateKind`, valid both as a mock
 * message-init and as a page.route body. Each template has a DISTINCT name, id and version so a
 * spec can tell which RPC fed which tab.
 *
 * Registered in e2e/fixtures/INVENTORY.md — update it when this file changes.
 */
import { TEST_USER_ID } from './users';

const KIND_STRATEGY = 1; // TEMPLATE_KIND_STRATEGY
const KIND_FORMULA = 2; // TEMPLATE_KIND_FORMULA
const KIND_SIGNAL_SOURCE = 3; // TEMPLATE_KIND_SIGNAL_SOURCE

export const FORMULA_TEMPLATE_ZSCORE = {
  meta: {
    templateId: 'tpl-formula-zscore',
    kind: KIND_FORMULA,
    name: 'Z-Score Reversion',
    description: 'Distance of the close from its rolling mean, in standard deviations.',
    version: 3,
  },
  payload: {
    name: 'Z-Score Reversion',
    description: 'Distance of the close from its rolling mean, in standard deviations.',
    source: 'result = {"value": 0.0}',
    warmupPeriod: 20,
  },
};

export const STRATEGY_TEMPLATE_MEANREV = {
  meta: {
    templateId: 'tpl-strategy-meanrev',
    kind: KIND_STRATEGY,
    name: 'Mean Reversion Starter',
    description: 'Buys oversold names and exits on reversion to the mean.',
    version: 1,
  },
  payload: {
    strategyId: 'meanrev-starter',
    displayName: 'Mean Reversion Starter',
    active: true,
  },
};

export const SOURCE_TEMPLATE_NEWSLETTER = {
  meta: {
    templateId: 'tpl-source-newsletter',
    kind: KIND_SIGNAL_SOURCE,
    name: 'Newsletter Email',
    description: 'Parses trade ideas from a newsletter inbox.',
    version: 2,
  },
  payload: {
    slug: 'newsletter',
    displayName: 'Newsletter',
    sourceType: 'simple_email',
    active: true,
    configJson: { sender_patterns: ['ideas@newsletter.example'], subject_patterns: ['Idea:'] },
    extractorModule: 'app.extractors.example_simple_email',
  },
};

export const TEMPLATES = [
  FORMULA_TEMPLATE_ZSCORE,
  STRATEGY_TEMPLATE_MEANREV,
  SOURCE_TEMPLATE_NEWSLETTER,
];

/**
 * The private formula `InstantiateTemplate(FORMULA_TEMPLATE_ZSCORE)` creates, owned by the test user.
 * Its origin lags the template by one version, so the formulas list renders "Update available".
 */
export const FORMULA_TEMPLATE_INSTANCE = {
  formulaId: 'f-zscore-copy',
  name: FORMULA_TEMPLATE_ZSCORE.payload.name,
  author: TEST_USER_ID,
  origin: {
    templateId: FORMULA_TEMPLATE_ZSCORE.meta.templateId,
    templateVersion: FORMULA_TEMPLATE_ZSCORE.meta.version - 1,
    latestVersion: FORMULA_TEMPLATE_ZSCORE.meta.version,
    updateAvailable: true,
  },
};
