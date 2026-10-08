import { useQuery } from '@tanstack/react-query';
import type { MessageInitShape } from '@bufbuild/protobuf';
import { TemplateKind, type TemplateOperation } from '@xstockstrat/proto/common/v1/common_pb';
import type {
  FormulaTemplate,
  FormulaTemplateSchema,
} from '@xstockstrat/proto/indicators/v1/indicators_pb';
import type {
  StrategyTemplate,
  StrategyTemplateSchema,
} from '@xstockstrat/proto/analysis/v1/analysis_pb';
import type { SourceTemplate, SourceTemplateSchema } from '@xstockstrat/proto/ingest/v1/ingest_pb';
import { useInvalidatingMutation } from '@/hooks/useInvalidatingMutation';
import { indicatorsClient } from '@/lib/browserClients/indicatorsClient';
import { analysisClient } from '@/lib/browserClients/analysisClient';
import { insightsIngestClient } from '@/lib/browserClients/insightsIngestClient';
import { configUiIndicatorsClient } from '@/lib/browserClients/configUiIndicatorsClient';
import { configUiAnalysisClient } from '@/lib/browserClients/configUiAnalysisClient';
import { ingestClient } from '@/lib/browserClients/ingestClient';

/** The segment whose BFF a call dials: /insights lists + instantiates, /config-ui lists + manages. */
export type TemplateSegment = 'insights' | 'config-ui';

export const CATALOG_KINDS = [
  TemplateKind.FORMULA,
  TemplateKind.STRATEGY,
  TemplateKind.SIGNAL_SOURCE,
] as const;
export type CatalogKind = (typeof CATALOG_KINDS)[number];

export const TEMPLATE_KIND_LABEL: Record<CatalogKind, string> = {
  [TemplateKind.FORMULA]: 'Formula',
  [TemplateKind.STRATEGY]: 'Strategy',
  [TemplateKind.SIGNAL_SOURCE]: 'Signal source',
};

export type CatalogTemplate =
  | { kind: TemplateKind.FORMULA; template: FormulaTemplate }
  | { kind: TemplateKind.STRATEGY; template: StrategyTemplate }
  | { kind: TemplateKind.SIGNAL_SOURCE; template: SourceTemplate };

const CLIENTS = {
  insights: {
    indicators: indicatorsClient,
    analysis: analysisClient,
    ingest: insightsIngestClient,
  },
  'config-ui': {
    indicators: configUiIndicatorsClient,
    analysis: configUiAnalysisClient,
    ingest: ingestClient,
  },
} as const;

const TEMPLATES_KEY = 'templates';

async function listCatalog(
  kind: CatalogKind,
  segment: TemplateSegment,
): Promise<CatalogTemplate[]> {
  const c = CLIENTS[segment];
  switch (kind) {
    case TemplateKind.FORMULA:
      return (await c.indicators.listTemplates({})).templates.map((template) => ({
        kind,
        template,
      }));
    case TemplateKind.STRATEGY:
      return (await c.analysis.listTemplates({})).templates.map((template) => ({ kind, template }));
    case TemplateKind.SIGNAL_SOURCE:
      return (await c.ingest.listTemplates({})).templates.map((template) => ({ kind, template }));
  }
}

/** Active (non-retired) templates of one kind, via the given segment's BFF. */
export function useTemplates(kind: CatalogKind, segment: TemplateSegment = 'insights') {
  return useQuery({
    queryKey: [TEMPLATES_KEY, segment, kind],
    queryFn: () => listCatalog(kind, segment),
  });
}

/** An mcp_client source needs the caller's own bearer at instantiation (prompted, never rendered back). */
export function needsBearer(row: CatalogTemplate): boolean {
  return (
    row.kind === TemplateKind.SIGNAL_SOURCE && row.template.payload?.sourceType === 'mcp_client'
  );
}

/** Where a freshly instantiated object lives. */
export function instanceHref(kind: CatalogKind, id: string): string {
  switch (kind) {
    case TemplateKind.FORMULA:
      return `/insights/formulas/${encodeURIComponent(id)}`;
    case TemplateKind.STRATEGY:
      return `/insights/strategies/${encodeURIComponent(id)}`;
    case TemplateKind.SIGNAL_SOURCE:
      return '/insights/signal-sources';
  }
}

export interface InstantiateInput {
  kind: CatalogKind;
  templateId: string;
  /** Strategy kind only; empty = the template's strategy_id, suffixed _N on collision. */
  strategyId?: string;
}

async function instantiate({ kind, templateId, strategyId }: InstantiateInput): Promise<string> {
  const c = CLIENTS.insights;
  switch (kind) {
    case TemplateKind.FORMULA:
      return (await c.indicators.instantiateTemplate({ templateId })).formula?.formulaId ?? '';
    case TemplateKind.STRATEGY:
      return (await c.analysis.instantiateTemplate({ templateId, strategyId: strategyId ?? '' }))
        .strategyId;
    case TemplateKind.SIGNAL_SOURCE:
      return (await c.ingest.instantiateTemplate({ templateId })).slug;
  }
}

/** Copy a template into a private object owned by the caller; resolves to the new object's id. */
export function useInstantiateTemplate() {
  return useInvalidatingMutation(instantiate, [
    ['indicators-formulas'],
    ['analysis-strategy-definitions'],
    ['analysis-strategies'],
    ['insights-signal-sources'],
    ['signal-sources'],
  ]);
}

export type ManageTemplateInput =
  | {
      kind: TemplateKind.FORMULA;
      operation: TemplateOperation;
      template: MessageInitShape<typeof FormulaTemplateSchema>;
    }
  | {
      kind: TemplateKind.STRATEGY;
      operation: TemplateOperation;
      template: MessageInitShape<typeof StrategyTemplateSchema>;
    }
  | {
      kind: TemplateKind.SIGNAL_SOURCE;
      operation: TemplateOperation;
      template: MessageInitShape<typeof SourceTemplateSchema>;
    };

async function manage(input: ManageTemplateInput): Promise<void> {
  const c = CLIENTS['config-ui'];
  const { operation } = input;
  switch (input.kind) {
    case TemplateKind.FORMULA:
      await c.indicators.manageTemplate({ operation, template: input.template });
      return;
    case TemplateKind.STRATEGY:
      await c.analysis.manageTemplate({ operation, template: input.template });
      return;
    case TemplateKind.SIGNAL_SOURCE:
      await c.ingest.manageTemplate({ operation, template: input.template });
      return;
  }
}

/** Admin create / update / retire (config-ui BFF; the backend re-checks the ADMIN bit). */
export function useManageTemplate() {
  return useInvalidatingMutation(manage, [[TEMPLATES_KEY]]);
}
