// Mirrors the agent's scopes.MCP_SCOPES_SUPPORTED; both are pinned to the vector prm.expected.
export const MCP_SCOPES_SUPPORTED = [
  'xstockstrat.read',
  'xstockstrat.write',
  'xstockstrat.admin',
  'xstockstrat.trade',
] as const;
