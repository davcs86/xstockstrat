package testdata

// ReconciliationPollerCallerID must equal the xstockstrat-config INTERNAL_CALLER_ALLOWLIST grant
// the reconciliation poller authenticates as (x-internal-caller); config credits the write to it.
const ReconciliationPollerCallerID = "trading-reconciliation-poller"
