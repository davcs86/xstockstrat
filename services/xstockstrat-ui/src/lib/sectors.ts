import { Sector } from '@xstockstrat/proto/common/v1/common_pb';

// Exhaustive Record<Sector,…> — a new proto enum value fails `tsc` here (feature 217).
export const SECTOR_LABEL: Record<Sector, string> = {
  [Sector.UNSPECIFIED]: 'Unclassified',
  [Sector.ENERGY]: 'Energy',
  [Sector.MATERIALS]: 'Materials',
  [Sector.INDUSTRIALS]: 'Industrials',
  [Sector.CONSUMER_DISCRETIONARY]: 'Consumer Discretionary',
  [Sector.CONSUMER_STAPLES]: 'Consumer Staples',
  [Sector.HEALTH_CARE]: 'Health Care',
  [Sector.FINANCIALS]: 'Financials',
  [Sector.TECHNOLOGY]: 'Technology',
  [Sector.COMMUNICATION_SERVICES]: 'Communication Services',
  [Sector.UTILITIES]: 'Utilities',
  [Sector.REAL_ESTATE]: 'Real Estate',
};

// UNSPECIFIED is the default bucket (default_value), never a by_sector key.
export const OVERRIDABLE_SECTORS: Sector[] = (Object.keys(SECTOR_LABEL) as unknown as string[])
  .map(Number)
  .filter((s) => s !== Sector.UNSPECIFIED);

export type SectorValueDraft = { sector: Sector; value: number };

// Mirrors analysis.v1.SectorParamOverride field names so it assigns to the proto init shape.
export type SectorOverrideDraft = {
  componentRef: string;
  paramName: string;
  defaultValue: number;
  bySector: SectorValueDraft[];
};

type ComponentLike = { refName: string; params: Record<string, number> };

/** Overrides that still target an existing component param (the server rejects dangling refs). */
export function liveOverrides(
  overrides: SectorOverrideDraft[],
  components: ComponentLike[],
): SectorOverrideDraft[] {
  const params = new Map(components.map((c) => [c.refName, c.params]));
  return overrides.filter(
    (o) =>
      o.componentRef !== '' &&
      o.paramName !== '' &&
      params.get(o.componentRef)?.[o.paramName] !== undefined,
  );
}

/** A copy without duplicate sectors (last value wins) and with non-finite values dropped. */
export function normalizeOverride(o: SectorOverrideDraft): SectorOverrideDraft {
  const bySector = new Map<Sector, number>();
  for (const sv of o.bySector) {
    if (sv.sector !== Sector.UNSPECIFIED && Number.isFinite(sv.value))
      bySector.set(sv.sector, sv.value);
  }
  return {
    ...o,
    bySector: [...bySector.entries()].map(([sector, value]) => ({ sector, value })),
  };
}
