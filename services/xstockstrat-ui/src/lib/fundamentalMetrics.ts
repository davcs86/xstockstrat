/**
 * Two-vocabulary helpers bridging the FundamentalMetric catalog and the marketdata Fundamentals
 * row for the formula fundamentals test grid (feature 205).
 *
 * The sandbox `data` global is keyed by snake_case data-keys (`pe_ratio`), matching the indicators
 * FundamentalMetric enum names. The marketdata `Fundamentals` proto message exposes those same
 * metrics as protobuf-es camelCase fields (`peRatio`). These functions convert between the two and
 * build the sandbox input_data from a GetFundamentalsMulti response row.
 */

/** A snake_case data-key with its protobuf-es camelCase field name, from the catalog. */
export interface MetricKey {
  dataKey: string;
}

/**
 * Derive the protobuf-es camelCase field name for a snake_case data-key: `pe_ratio` -> `peRatio`,
 * `year_high` -> `yearHigh`. This is the accessor used to read the metric off a marketdata
 * `Fundamentals` message.
 */
export function dataKeyToProtoField(dataKey: string): string {
  return dataKey.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/**
 * The subset of a marketdata `Fundamentals` row this module reads: the numeric metric fields
 * (protobuf-es camelCase) plus the authoritative `missingMetrics` list (MARKETDATA-11 — a metric
 * the provider did not supply, never inferred from a `0` value).
 */
export interface FundamentalsRow {
  missingMetrics?: string[];
  [field: string]: unknown;
}

/**
 * Build the sandbox `input_data` record from a GetFundamentalsMulti response row, restricted to the
 * declared metrics in `catalog`. A metric listed in `missingMetrics`, absent, or non-finite maps to
 * `null` — never `NaN` (fails.md:86 — MessageToDict rejects NaN in a Struct). Keys are the
 * snake_case data-keys; the caller strips `null` entries before sending.
 */
export function fundamentalsToInputData(
  row: FundamentalsRow,
  catalog: MetricKey[],
): Record<string, number | null> {
  const missing = new Set(row.missingMetrics ?? []);
  const out: Record<string, number | null> = {};
  for (const { dataKey } of catalog) {
    if (missing.has(dataKey)) {
      out[dataKey] = null;
      continue;
    }
    const v = row[dataKeyToProtoField(dataKey)];
    out[dataKey] = typeof v === 'number' && Number.isFinite(v) ? v : null;
  }
  return out;
}
