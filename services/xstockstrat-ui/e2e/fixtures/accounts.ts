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

/** CREDENTIAL_STATUS_UNSPECIFIED — offline accounts have no credentials to validate. */
const CREDENTIAL_STATUS_UNSPECIFIED = 0;

/** An offline (manually-tracked) account (feature 157): broker_type OFFLINE, no credentials. */
export const BROKER_ACCOUNT_OFFLINE = {
  id: 'offline-001',
  displayName: 'Offline Book',
  brokerType: 3, // BROKER_TYPE_OFFLINE
  isPaper: true,
  isActive: true,
  credentialStatus: CREDENTIAL_STATUS_UNSPECIFIED,
};

/**
 * A halted broker account (feature 179). `isActive: true` AND `halted: true` together — the
 * load-bearing invariant: the Resume action lives inside the `isActive` gate, so a halted-but-
 * inactive fixture would make Step 8 green vacuously (fails.md:1650). `haltSource: 1` =
 * HALT_SOURCE_BRACKET_PROTECTION.
 */
export const BROKER_ACCOUNT_HALTED = {
  id: 'halted-001',
  displayName: 'Halted Alpaca',
  brokerType: 1, // BROKER_TYPE_ALPACA
  isPaper: true,
  isActive: true,
  credentialStatus: CREDENTIAL_STATUS_VALID,
  halted: true,
  haltReason: 'bracket flatten failed',
  haltSource: 1, // HALT_SOURCE_BRACKET_PROTECTION
};

/** The default two-account universe (Alpaca + IBKR paper). */
export const BROKER_ACCOUNTS = [BROKER_ACCOUNT_ALPACA, BROKER_ACCOUNT_IBKR];
