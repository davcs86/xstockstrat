/**
 * Canonical BrokerAccount fixtures.
 *
 * Shape source: `xstockstrat.trading.v1.BrokerAccount`
 * (packages/proto/trading/v1/trading.proto). Field names are the Connect-JSON
 * camelCase proto names, so the same object works both as a gRPC handler
 * response init (mock-backend.ts) and as a page.route() fulfill body.
 *
 * Registered in e2e/fixtures/INVENTORY.md — update it when this file changes.
 */

/** CREDENTIAL_STATUS_VALID */
const CREDENTIAL_STATUS_VALID = 1;

export const BROKER_ACCOUNT_ALPACA = {
  id: 'alpaca-default',
  displayName: 'Alpaca Paper',
  brokerType: 1, // BROKER_TYPE_ALPACA
  isPaper: true,
  isActive: true,
  credentialStatus: CREDENTIAL_STATUS_VALID,
};

export const BROKER_ACCOUNT_IBKR = {
  id: 'ibkr-001',
  displayName: 'IBKR Paper',
  brokerType: 2, // BROKER_TYPE_IBKR
  isPaper: true,
  isActive: true,
  credentialStatus: CREDENTIAL_STATUS_VALID,
};

/** Response to a successful RegisterBrokerAccount in registration flows. */
export const BROKER_ACCOUNT_NEW = {
  id: 'new-account-001',
  displayName: 'New Account',
  brokerType: 1,
  isPaper: true,
  isActive: true,
  credentialStatus: CREDENTIAL_STATUS_VALID,
};

/** The default two-account universe (Alpaca + IBKR paper). */
export const BROKER_ACCOUNTS = [BROKER_ACCOUNT_ALPACA, BROKER_ACCOUNT_IBKR];
