package repository

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// IntentState mirrors the trading.v1.IntentState proto enum's integer values —
// the order_intents.state column is SMALLINT, never compared against a string literal.
const (
	IntentStateUnspecified int16 = 0
	IntentStatePending     int16 = 1
	IntentStateCompleted   int16 = 2
	IntentStateRejected    int16 = 3
	IntentStateUnknown     int16 = 4
)

type OrderIntentRecord struct {
	IntentID        string
	OrderID         string
	RequestHash     string
	State           int16
	BrokerAccountID string
	FirstResponse   []byte // JSONB, nil if unset
	LatestResponse  []byte
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

// OrderIntentRepository is the insert-or-return-existing dedup store (design.md §
// Concurrency). Defined as an interface (mirroring AccountRepository) so
// internal/service tests can substitute a fake without a live DB.
type OrderIntentRepository interface {
	// InsertIntent attempts the ON CONFLICT DO NOTHING RETURNING insert. ok=true means
	// this call owns the intent (proceed to the broker); ok=false means an existing row
	// was found and the caller must GetIntentByID and branch (design.md's reactive path).
	InsertIntent(ctx context.Context, rec *OrderIntentRecord) (ok bool, err error)
	GetIntentByID(ctx context.Context, intentID string) (*OrderIntentRecord, error)
	// ReclaimOrphanIntent is the single CAS shared by the reactive path and the sweeper
	// (design.md § Reclaim CAS). reclaimed=false means someone else already reclaimed it
	// or it is no longer stale — a safe no-op, not an error.
	ReclaimOrphanIntent(ctx context.Context, intentID string, staleBefore time.Time) (reclaimed bool, rec *OrderIntentRecord, err error)
	FinalizeIntent(ctx context.Context, intentID, orderID string, state int16, response []byte) error
	// SweepStalePending returns up to limit PENDING intents older than staleBefore, for
	// StartOrderIntentSweeper (internal/service/order_intent.go).
	SweepStalePending(ctx context.Context, staleBefore time.Time, limit int) ([]*OrderIntentRecord, error)
	// ListUnknownForAccount returns every UNKNOWN-state intent for one broker account
	// (feature 102 — FR-6, resolves 101's own deferred "who resolves an UNKNOWN order
	// intent" question).
	ListUnknownForAccount(ctx context.Context, brokerAccountID string) ([]*OrderIntentRecord, error)
	// ResolveUnknownIntent CAS-transitions an UNKNOWN intent to a definite outcome
	// (IntentStateCompleted or IntentStateRejected) once broker truth is known (feature 102).
	// Guarded on state=Unknown, mirroring FinalizeIntent's own state-guard CAS pattern
	// (design.md § Late-broker-response race) applied to the UNKNOWN->definite transition
	// instead of Pending->definite. resolved=false means the row was no longer UNKNOWN when
	// this ran (already resolved by a concurrent caller) — a safe no-op, not an error.
	ResolveUnknownIntent(ctx context.Context, intentID string, newState int16, response []byte) (resolved bool, err error)
}

type pgOrderIntentRepo struct {
	pool *pgxpool.Pool
}

func NewOrderIntentRepo(pool *pgxpool.Pool) OrderIntentRepository {
	return &pgOrderIntentRepo{pool: pool}
}

const insertIntentSQL = `
INSERT INTO trading.order_intents
    (intent_id, order_id, request_hash, state, broker_account_id, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5, now(), now())
ON CONFLICT (intent_id) DO NOTHING
RETURNING intent_id, order_id, request_hash, state, broker_account_id,
          first_response, latest_response, created_at, updated_at`

func (r *pgOrderIntentRepo) InsertIntent(ctx context.Context, rec *OrderIntentRecord) (bool, error) {
	row := r.pool.QueryRow(ctx, insertIntentSQL,
		rec.IntentID, rec.OrderID, rec.RequestHash, IntentStatePending, rec.BrokerAccountID)
	var out OrderIntentRecord
	err := row.Scan(&out.IntentID, &out.OrderID, &out.RequestHash, &out.State, &out.BrokerAccountID,
		&out.FirstResponse, &out.LatestResponse, &out.CreatedAt, &out.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

const getIntentByIDSQL = `
SELECT intent_id, order_id, request_hash, state, broker_account_id,
       first_response, latest_response, created_at, updated_at
FROM trading.order_intents WHERE intent_id = $1`

func (r *pgOrderIntentRepo) GetIntentByID(ctx context.Context, intentID string) (*OrderIntentRecord, error) {
	row := r.pool.QueryRow(ctx, getIntentByIDSQL, intentID)
	var out OrderIntentRecord
	err := row.Scan(&out.IntentID, &out.OrderID, &out.RequestHash, &out.State, &out.BrokerAccountID,
		&out.FirstResponse, &out.LatestResponse, &out.CreatedAt, &out.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &out, nil
}

// reclaimOrphanIntentSQL is the single CAS shared by the reactive path and the sweeper
// (design.md § Reclaim CAS) — one SQL statement for both call sites, deliberately, to
// avoid two divergent implementations of the same safety-critical transition.
const reclaimOrphanIntentSQL = `
UPDATE trading.order_intents
SET state = $1, updated_at = now()
WHERE intent_id = $2 AND state = $3 AND updated_at < $4
RETURNING intent_id, order_id, request_hash, broker_account_id, updated_at`

func (r *pgOrderIntentRepo) ReclaimOrphanIntent(ctx context.Context, intentID string, staleBefore time.Time) (bool, *OrderIntentRecord, error) {
	row := r.pool.QueryRow(ctx, reclaimOrphanIntentSQL, IntentStateUnknown, intentID, IntentStatePending, staleBefore)
	var out OrderIntentRecord
	err := row.Scan(&out.IntentID, &out.OrderID, &out.RequestHash, &out.BrokerAccountID, &out.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil, nil
		}
		return false, nil, err
	}
	return true, &out, nil
}

// finalizeIntentSQL's WHERE state=$5(Pending) guard means this CAS can only ever fire
// once per row (state leaves PENDING permanently after) — see design.md § Late-broker-
// response race for why a 0-row affect here (a reclaimed row) is a deliberate no-op, not
// an error: resurrecting a reclaimed row would reintroduce the ambiguity this design
// exists to prevent.
const finalizeIntentSQL = `
UPDATE trading.order_intents
SET state = $1, order_id = $2,
    first_response = COALESCE(first_response, $3), latest_response = $3, updated_at = now()
WHERE intent_id = $4 AND state = $5
RETURNING intent_id`

func (r *pgOrderIntentRepo) FinalizeIntent(ctx context.Context, intentID, orderID string, state int16, response []byte) error {
	row := r.pool.QueryRow(ctx, finalizeIntentSQL, state, orderID, response, intentID, IntentStatePending)
	var discard string
	err := row.Scan(&discard)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Deliberate no-op (design.md § Late-broker-response race) — the intent was
			// already reclaimed to UNKNOWN (or otherwise left PENDING) between this
			// handler's broker call starting and returning. Not an error.
			return nil
		}
		return err
	}
	return nil
}

const sweepSelectSQL = `
SELECT intent_id, order_id, request_hash, broker_account_id
FROM trading.order_intents
WHERE state = $1 AND updated_at < $2
ORDER BY updated_at
LIMIT $3`

func (r *pgOrderIntentRepo) SweepStalePending(ctx context.Context, staleBefore time.Time, limit int) ([]*OrderIntentRecord, error) {
	rows, err := r.pool.Query(ctx, sweepSelectSQL, IntentStatePending, staleBefore, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []*OrderIntentRecord
	for rows.Next() {
		var rec OrderIntentRecord
		if err := rows.Scan(&rec.IntentID, &rec.OrderID, &rec.RequestHash, &rec.BrokerAccountID); err != nil {
			return nil, err
		}
		out = append(out, &rec)
	}
	return out, rows.Err()
}

const listUnknownForAccountSQL = `
SELECT intent_id, order_id, request_hash, state, broker_account_id,
       first_response, latest_response, created_at, updated_at
FROM trading.order_intents
WHERE broker_account_id = $1 AND state = $2`

func (r *pgOrderIntentRepo) ListUnknownForAccount(ctx context.Context, brokerAccountID string) ([]*OrderIntentRecord, error) {
	rows, err := r.pool.Query(ctx, listUnknownForAccountSQL, brokerAccountID, IntentStateUnknown)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []*OrderIntentRecord
	for rows.Next() {
		var rec OrderIntentRecord
		if err := rows.Scan(&rec.IntentID, &rec.OrderID, &rec.RequestHash, &rec.State, &rec.BrokerAccountID,
			&rec.FirstResponse, &rec.LatestResponse, &rec.CreatedAt, &rec.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, &rec)
	}
	return out, rows.Err()
}

const resolveUnknownIntentSQL = `
UPDATE trading.order_intents
SET state = $1, latest_response = $2, updated_at = now()
WHERE intent_id = $3 AND state = $4
RETURNING intent_id`

func (r *pgOrderIntentRepo) ResolveUnknownIntent(ctx context.Context, intentID string, newState int16, response []byte) (bool, error) {
	row := r.pool.QueryRow(ctx, resolveUnknownIntentSQL, newState, response, intentID, IntentStateUnknown)
	var discard string
	err := row.Scan(&discard)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}
