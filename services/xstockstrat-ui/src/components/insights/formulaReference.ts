/**
 * Single source of authoring knowledge for the formula workspace.
 *
 * The indicators sandbox executes a formula as a fresh subprocess: it receives
 * one `data` dict and must assign one `result` dict. Only a fixed set of
 * libraries is importable. This module documents that contract for the UI and
 * supplies runnable starter templates + sample input so authors are never
 * guessing about the shape of the data or which operations are available.
 *
 * Keep this in sync with:
 *   - services/xstockstrat-indicators/app/services/sandbox.py (safe builtins, imports)
 *   - docs/runbooks/indicator-builder.md (the contract + limits table)
 */
import { ParameterType, SandboxExitReason } from '@xstockstrat/proto/indicators/v1/indicators_pb';
import type { ParameterDraft } from './ParameterEditor';
import type { OutputDraft } from './OutputEditor';

export interface FormulaTemplate {
  id: string;
  label: string;
  description: string;
  source: string;
  /**
   * Typed parameters the template declares. Loading a template fills the
   * Parameters cell with these and the run-cell form seeds each input from the
   * declared `default`. Read inside the formula via `params["<name>"]`.
   */
  parameters: ParameterDraft[];
  /**
   * Secondary output series the template emits beyond the implicit primary
   * `value` series. Loading a template fills the Outputs cell with these.
   */
  outputs: OutputDraft[];
  /** Pre-fills the run cell's `data` editor so the template executes as-is. */
  sampleInput: Record<string, unknown>;
}

/** Concise builder for a numeric (int/float) parameter draft. */
function numericParam(
  name: string,
  type: ParameterType.INT | ParameterType.FLOAT,
  def: number,
  description: string,
  min?: number,
): ParameterDraft {
  return {
    name,
    type,
    default: String(def),
    description,
    required: false,
    min: min !== undefined ? String(min) : '',
    max: '',
  };
}

export interface LibraryRef {
  name: string;
  importAs: string;
  blurb: string;
  examples: string[];
}

// A short, deterministic close-price series used to seed the run cell and the
// per-template sample inputs. Long enough that rolling windows produce output.
const SAMPLE_CLOSE = [
  44.5, 44.3, 44.8, 45.1, 44.9, 45.5, 46.0, 45.8, 46.2, 46.5, 45.9, 46.1, 46.8,
  47.0, 46.5, 47.2, 47.8, 47.5, 48.1, 48.4, 47.9, 48.6, 49.0, 48.7,
];

/**
 * A representative OHLCV bundle authors can load into the run cell. This is the
 * `data` input only — typed parameters live in the separate `params` namespace
 * (the Parameters cell), never embedded here.
 */
export const SAMPLE_OHLCV: Record<string, unknown> = {
  open: SAMPLE_CLOSE.map((c) => Math.round((c - 0.2) * 100) / 100),
  high: SAMPLE_CLOSE.map((c) => Math.round((c + 0.4) * 100) / 100),
  low: SAMPLE_CLOSE.map((c) => Math.round((c - 0.5) * 100) / 100),
  close: SAMPLE_CLOSE,
  volume: SAMPLE_CLOSE.map((_, i) => 1_000_000 + i * 25_000),
};

/** Pretty-printed default for the run cell's `data` editor (series only). */
export const SAMPLE_INPUT_JSON = JSON.stringify({ close: SAMPLE_CLOSE }, null, 2);

/**
 * What a formula receives and what it must return. Surfaced verbatim in the
 * reference panel so authors don't have to read the runbook to get started.
 */
export const INPUT_CONTRACT = [
  'Your code runs with a dict named `data` already in scope — the JSON you',
  'enter in the run cell below. Time-series come in as lists of numbers',
  '(`data["close"]`), e.g. OHLCV bars.',
].join(' ');

export const PARAMS_CONTRACT = [
  'Typed parameters arrive in a separate `params` dict — never merged into',
  '`data`. Declare each one in the Parameters cell with a type, default, and',
  'optional min/max, then read it inside the formula as `params["period"]`.',
].join(' ');

export const OUTPUT_CONTRACT = [
  'Before your code finishes, assign a dict to `result`. The primary series is',
  '`result["value"]`; declare any extra series (e.g. `upper`, `signal`) in the',
  'Outputs cell and emit them under matching keys. Values must be',
  'JSON-serializable (lists, numbers, strings, bools, null). A non-dict result',
  'is wrapped as `{"value": <result>}`.',
].join(' ');

export const AVAILABLE_LIBRARIES: LibraryRef[] = [
  {
    name: 'numpy',
    importAs: 'import numpy as np',
    blurb: 'Vectorized array math — fast windows, diffs, and elementwise ops.',
    examples: [
      'arr = np.array(data["close"], dtype=float)',
      'sma = np.convolve(arr, np.ones(n) / n, mode="valid")',
      'delta = np.diff(arr)',
      'np.where(delta > 0, delta, 0.0)',
    ],
  },
  {
    name: 'pandas',
    importAs: 'import pandas as pd',
    blurb: 'Series/DataFrame with rolling windows and exponential averages.',
    examples: [
      's = pd.Series(data["close"], dtype=float)',
      'mid = s.rolling(period).mean()',
      'std = s.rolling(period).std()',
      'ema = s.ewm(span=12, adjust=False).mean()',
    ],
  },
  {
    name: 'math',
    importAs: 'import math',
    blurb: 'Scalar math constants and functions.',
    examples: ['math.sqrt(x)', 'math.log(x)', 'math.pi'],
  },
  {
    name: 'statistics',
    importAs: 'import statistics',
    blurb: 'Pure-Python descriptive stats over plain lists.',
    examples: ['statistics.mean(xs)', 'statistics.pstdev(xs)', 'statistics.median(xs)'],
  },
];

/** Modules and builtins the sandbox blocks — shown so failures aren't a surprise. */
export const FORBIDDEN = [
  'os',
  'sys',
  'subprocess',
  'socket',
  'urllib',
  'requests',
  'open',
  'exec',
  'eval',
  '__import__',
];

export interface SandboxLimit {
  label: string;
  value: string;
  note: string;
}

// Defaults from indicators.sandbox.* config keys (docs/runbooks/indicator-builder.md).
export const SANDBOX_LIMITS: SandboxLimit[] = [
  { label: 'Time limit', value: '5 s', note: 'Per execution (indicators.sandbox.timeout_ms).' },
  { label: 'Memory', value: '128 MiB', note: 'Hard cap (indicators.sandbox.memory_bytes).' },
  { label: 'Network / disk', value: 'None', note: 'No filesystem or network access.' },
  { label: 'print()', value: 'Captured', note: 'Output is returned as stdout, not a live console.' },
];

/** Human-readable labels + badge intent for each sandbox exit reason. */
export const EXIT_REASON: Record<SandboxExitReason, { label: string; tone: 'buy' | 'warning' | 'destructive' }> = {
  [SandboxExitReason.UNSPECIFIED]: { label: 'Unknown', tone: 'warning' },
  [SandboxExitReason.SUCCESS]: { label: 'Success', tone: 'buy' },
  [SandboxExitReason.TIMEOUT]: { label: 'Timed out', tone: 'destructive' },
  [SandboxExitReason.MEMORY_EXCEEDED]: { label: 'Out of memory', tone: 'destructive' },
  [SandboxExitReason.RUNTIME_ERROR]: { label: 'Runtime error', tone: 'destructive' },
  [SandboxExitReason.IMPORT_BLOCKED]: { label: 'Blocked import', tone: 'destructive' },
};

export const FORMULA_TEMPLATES: FormulaTemplate[] = [
  {
    id: 'blank',
    label: 'Blank',
    description: 'Minimal scaffold showing the data → result contract.',
    source: `# \`data\` holds the input series from the run cell (e.g. data["close"]).
# \`params\` holds your typed parameters (e.g. params["period"]).
# Assign your output to \`result\` as a dict of JSON-serializable values;
# the primary series is result["value"].

close = data["close"]

result = {"value": close}
`,
    parameters: [],
    outputs: [],
    sampleInput: { close: SAMPLE_CLOSE },
  },
  {
    id: 'sma',
    label: 'SMA',
    description: 'Simple moving average via numpy convolution.',
    source: `import numpy as np

close = np.array(data["close"], dtype=float)
period = int(params["period"])

weights = np.ones(period) / period
sma = np.convolve(close, weights, mode="valid")

result = {"value": sma.tolist()}
`,
    parameters: [numericParam('period', ParameterType.INT, 20, 'Lookback window in bars.', 1)],
    outputs: [],
    sampleInput: { close: SAMPLE_CLOSE },
  },
  {
    id: 'rsi',
    label: 'RSI',
    description: 'Relative Strength Index from average gains/losses.',
    source: `import numpy as np

close = np.array(data["close"], dtype=float)
period = int(params["period"])

delta = np.diff(close)
gain = np.where(delta > 0, delta, 0.0)
loss = np.where(delta < 0, -delta, 0.0)

avg_gain = np.convolve(gain, np.ones(period) / period, mode="valid")
avg_loss = np.convolve(loss, np.ones(period) / period, mode="valid")

rs = np.divide(
    avg_gain, avg_loss,
    out=np.full_like(avg_gain, np.inf),
    where=avg_loss != 0,
)
rsi = 100 - (100 / (1 + rs))

result = {"value": rsi.tolist()}
`,
    parameters: [numericParam('period', ParameterType.INT, 14, 'Averaging window in bars.', 2)],
    outputs: [],
    sampleInput: { close: SAMPLE_CLOSE },
  },
  {
    id: 'bollinger',
    label: 'Bollinger Bands',
    description: 'Rolling mean ± N standard deviations with pandas.',
    source: `import pandas as pd

close = pd.Series(data["close"], dtype=float)
period = int(params["period"])
mult = float(params["multiplier"])

mid = close.rolling(period).mean()
std = close.rolling(period).std()

# Primary "value" series is the middle band; upper/lower are declared outputs.
result = {
    "value": mid.dropna().tolist(),
    "upper": (mid + mult * std).dropna().tolist(),
    "lower": (mid - mult * std).dropna().tolist(),
}
`,
    parameters: [
      numericParam('period', ParameterType.INT, 20, 'Rolling window in bars.', 1),
      numericParam('multiplier', ParameterType.FLOAT, 2.0, 'Std-dev band width.', 0),
    ],
    outputs: [
      { name: 'upper', description: 'Upper band (mid + mult · std).' },
      { name: 'lower', description: 'Lower band (mid − mult · std).' },
    ],
    sampleInput: { close: SAMPLE_CLOSE },
  },
  {
    id: 'macd',
    label: 'MACD',
    description: 'Fast/slow EMA crossover with signal and histogram.',
    source: `import pandas as pd

close = pd.Series(data["close"], dtype=float)
fast = int(params["fast"])
slow = int(params["slow"])
signal = int(params["signal"])

ema_fast = close.ewm(span=fast, adjust=False).mean()
ema_slow = close.ewm(span=slow, adjust=False).mean()
macd = ema_fast - ema_slow
signal_line = macd.ewm(span=signal, adjust=False).mean()

# Primary "value" series is the MACD line; signal/histogram are declared outputs.
result = {
    "value": macd.tolist(),
    "signal": signal_line.tolist(),
    "histogram": (macd - signal_line).tolist(),
}
`,
    parameters: [
      numericParam('fast', ParameterType.INT, 12, 'Fast EMA span.', 1),
      numericParam('slow', ParameterType.INT, 26, 'Slow EMA span.', 1),
      numericParam('signal', ParameterType.INT, 9, 'Signal EMA span.', 1),
    ],
    outputs: [
      { name: 'signal', description: 'Signal line (EMA of MACD).' },
      { name: 'histogram', description: 'MACD minus signal line.' },
    ],
    sampleInput: { close: SAMPLE_CLOSE },
  },
];

export const BLANK_TEMPLATE = FORMULA_TEMPLATES[0];
