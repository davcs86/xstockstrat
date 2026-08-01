'use client';
import { AccountProvider, useAccountContext } from '@/context/AccountContext';
import { OrderForm } from '@/components/trader/OrderForm';

/**
 * Signal-detail order ticket (feature 083, FR-6). A re-presentation of the trader
 * `OrderForm` on the Decide → Signal-detail page, pinned to the signal's symbol. Execution
 * semantics are unchanged (FR-20): the same `usePlaceOrder` → trading BFF path runs, and the
 * PAPER/LIVE mode is the environment-fixed one from `AccountContext` — never user-selectable.
 *
 * The insights layout provides only the React Query provider, so this wraps `AccountProvider`
 * (which sources broker accounts + the trading environment via the /trader BFF) around the
 * form. The account/environment fetch is cross-segment-safe: the browser trading client posts
 * to /trader/api regardless of the page it renders on.
 */
function TicketBody({ symbol }: { symbol: string }) {
  const { environmentMode } = useAccountContext();
  const mode = environmentMode ?? 'paper';
  return <OrderForm mode={mode} initialSymbol={symbol} />;
}

export function SignalOrderTicket({ symbol }: { symbol: string }) {
  return (
    <AccountProvider>
      <TicketBody symbol={symbol} />
    </AccountProvider>
  );
}
