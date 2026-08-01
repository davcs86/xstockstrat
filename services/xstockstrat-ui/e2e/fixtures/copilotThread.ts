/**
 * Copilot rail thread fixtures (feature 083, Step 27). The rail persists user notes in the
 * ledger append-only store (event_type `copilot.message`, per-user stream key forced by the
 * BFF). The mock backend keeps an in-memory thread; these values are the canonical note text
 * the copilot e2e appends and then asserts on replay.
 *
 * Registered in e2e/fixtures/INVENTORY.md.
 */

/** A user note the copilot e2e writes via AppendEvent, then reads back via QueryEvents. */
export const COPILOT_NOTE_TEXT = 'Watch AAPL into earnings — trim if it gaps up.';

/** Shape of a replayed copilot message payload (google.protobuf.Struct → JSON object). */
export interface CopilotMessageFixture {
  role: 'user';
  text: string;
}

export const COPILOT_NOTE: CopilotMessageFixture = { role: 'user', text: COPILOT_NOTE_TEXT };
