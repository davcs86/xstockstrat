/** MCP tool catalog entries as the agent's internal catalog RPC returns them (Connect-JSON). */
export const SAMPLE_TOOLS = [
  {
    name: 'ingest_signal',
    description: 'Ingest a trading signal into xstockstrat-ingest.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: "Ticker symbol e.g. 'NVDA'." },
        direction: { type: 'string' },
      },
      required: ['source', 'symbol', 'direction', 'valid_from'],
    },
  },
  {
    name: 'emit_alert',
    description: 'Emit an alert via xstockstrat-notify.',
    inputSchema: { type: 'object', properties: {} },
  },
];
