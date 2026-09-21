import type { OhlcData } from '@/hooks/useOhlcBars';
import { fmtShortDate } from '@/lib/protoTime';
import { fmtUsd } from '@/lib/money';

export function OhlcBlock({ data, testId }: { data: OhlcData | undefined; testId?: string }) {
  if (!data) return null;
  const text = `${fmtShortDate(data.date)}  O ${fmtUsd(data.open)}  H ${fmtUsd(data.high)}  L ${fmtUsd(data.low)}  C ${fmtUsd(data.close)}`;
  return (
    <span
      className="font-mono text-xs tabular-nums whitespace-nowrap overflow-hidden text-ellipsis"
      title={text}
      aria-label={`OHLC for ${fmtShortDate(data.date)}: Open ${fmtUsd(data.open)}, High ${fmtUsd(data.high)}, Low ${fmtUsd(data.low)}, Close ${fmtUsd(data.close)}`}
      data-testid={testId}
    >
      {text}
    </span>
  );
}
