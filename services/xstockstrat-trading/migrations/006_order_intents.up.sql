-- state values match the trading.v1.IntentState proto enum:
--   0 = UNSPECIFIED, 1 = PENDING, 2 = COMPLETED, 3 = REJECTED, 4 = UNKNOWN.
-- Every INSERT sets state explicitly (see OrderIntentRepository.InsertIntent) — the DEFAULT
-- is a schema-level safety net only, never relied on by application code.
CREATE TABLE IF NOT EXISTS trading.order_intents (
    intent_id         UUID        PRIMARY KEY,
    order_id          UUID,       -- populated at INSERT for ALL command types (design.md round 7)
    request_hash      TEXT        NOT NULL,
    state             SMALLINT    NOT NULL DEFAULT 0,
    broker_account_id UUID        NOT NULL,
    first_response    JSONB,
    latest_response   JSONB,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sweep + reactive reclaim predicate (design.md § Sweep, § Reclaim CAS): both scan/update
-- exactly this shape (state=1/PENDING, ordered/filtered by updated_at).
CREATE INDEX IF NOT EXISTS idx_order_intents_pending_updated_at
    ON trading.order_intents (updated_at)
    WHERE state = 1;

-- Cross-intent precedence LATERAL join added to GetOrder/ListOrders in Step 7
-- (design.md § Cross-intent precedence, Open Risk #6) — keeps that join cheap on
-- ListOrders' existing LIMIT 500 query.
CREATE INDEX IF NOT EXISTS idx_order_intents_order_id_updated_at
    ON trading.order_intents (order_id, updated_at DESC);
