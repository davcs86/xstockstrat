package service

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"net"
	"strconv"
	"sync"
	"time"

	"github.com/google/uuid"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/keepalive"
	"google.golang.org/grpc/metadata"
	grpcstatus "google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	configv1 "github.com/xstockstrat/contracts/gen/go/config/v1"
	ledgerv1 "github.com/xstockstrat/contracts/gen/go/ledger/v1"
	marketdatav1 "github.com/xstockstrat/contracts/gen/go/marketdata/v1"
	notifyv1 "github.com/xstockstrat/contracts/gen/go/notify/v1"
	portfoliov1 "github.com/xstockstrat/contracts/gen/go/portfolio/v1"
	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"
	"github.com/xstockstrat/contracts/pnl"
	"github.com/xstockstrat/trading/internal/broker"
	"github.com/xstockstrat/trading/internal/config"
	"github.com/xstockstrat/trading/internal/middleware"
	"github.com/xstockstrat/trading/internal/repository"
)

// configSetConfigForwarder is the seam TradingService.escalateSystemic calls through — see the
// TradingService.configSetter field doc comment for why this exists. *config.Watcher's real
// SetConfig method already matches this signature exactly.
type configSetConfigForwarder interface {
	SetConfig(ctx context.Context, callerID string, req *configv1.SetConfigRequest) (*configv1.SetConfigResponse, error)
}

// offlineBaselineStore is the seam SnapshotOfflinePositions and recomputeAndEmitOfflinePositions
// call through for baseline-related persistence. *repository.TradingRepo satisfies it in
// production. Extracted for testability — same hoisting-for-testability approach as
// configSetConfigForwarder and AccountRepository (feature 163, Step 9).
type offlineBaselineStore interface {
	UpsertBaselineSnapshot(ctx context.Context, accountID, clientSnapshotID string, asOf time.Time, rows []repository.BaselineRow) error
	EffectiveBaselineByAccount(ctx context.Context, accountID string) (asOf time.Time, lots map[string]pnl.Lot, ok bool, err error)
	DeleteBaselinesByAccount(ctx context.Context, accountID string) error
	HasUnconfirmedOfflineOrders(ctx context.Context, accountID string) (bool, error)
	ListConfirmedOfflineOrdersByAccount(ctx context.Context, accountID string) ([]*tradingv1.Order, error)
}

// brokerPoolEntry holds a broker client and its type tag for a registered account.
type brokerPoolEntry struct {
	client     broker.Broker
	brokerType int32
	// userID is the owner of the account; propagated into account.positions.synced
	// events so xstockstrat-portfolio stores synced positions under the right user.
	userID string
}

// alpacaCreds is the JSON shape for Alpaca broker account credentials.
type alpacaCreds struct {
	APIKey    string `json:"api_key"`
	APISecret string `json:"api_secret"`
}

// ibkrCreds is the JSON shape for IBKR broker account credentials.
type ibkrCreds struct {
	ConsumerKey       string `json:"consumer_key"`
	AccessToken       string `json:"access_token"`
	AccessTokenSecret string `json:"access_token_secret"`
	IBKRAccountID     string `json:"ibkr_account_id"`
}

// TradingService implements business logic for order placement, cancellation,
// and lifecycle management. Writes all events to xstockstrat-ledger.
type TradingService struct {
	cfg  *config.Config
	cfgW *config.Watcher
	// configSetter is the narrow seam escalateSystemic calls through instead of cfgW.SetConfig
	// directly (feature 102). *config.Watcher satisfies it in production. config.Watcher's
	// underlying gRPC client field is unexported (package config), so a test in this package
	// has no way to construct a *config.Watcher around a fake client — extracting this
	// interface lets a test substitute a fake without touching the config package, the same
	// hoisting-for-testability approach this codebase has used repeatedly (030/023/101's own
	// config-value hoists), applied here to a client dependency instead of a config value.
	configSetter configSetConfigForwarder
	// Multi-broker pool: key is account_id.
	brokers     map[string]brokerPoolEntry
	brokersMu   sync.RWMutex
	accountRepo repository.AccountRepository
	encKey      string // hex-encoded AES-256-GCM key
	ledger      ledgerv1.LedgerServiceClient
	notify      notifyv1.NotifyServiceClient
	// portfolio is used for pre-trade risk checks (non-blocking on failure).
	portfolio portfoliov1.PortfolioServiceClient
	// marketdata is used by ComputePositionSize for ATR bars and current price.
	marketdata marketdatav1.MarketDataServiceClient
	// repo persists orders to trading.orders hypertable.
	repo *repository.TradingRepo
	// baselineStore is the narrow seam for offline-baseline persistence (feature 163).
	// *repository.TradingRepo satisfies it in production; tests inject a fake.
	baselineStore offlineBaselineStore
	// orderIntentRepo is the insert-or-return-existing dedup store (feature 101). Struct
	// field added here (Step 9) so order_intent.go's sweeper compiles; NewTradingService's
	// constructor parameter and main.go wiring land in Step 11.
	orderIntentRepo repository.OrderIntentRepository
	// bracketRepo persists the per-order bracket (stop-loss/take-profit) state machine
	// (feature 030).
	bracketRepo repository.BracketRepository
	// In-memory order store for active fan-out and fill polling.
	// Orders are also written to DB on every state change.
	orders map[string]*tradingv1.Order
	// Fan-out channels for StreamOrderUpdates
	mu   sync.Mutex
	subs map[string]chan *tradingv1.Order
	// credStatus tracks the last-persisted CredentialStatus per account so the
	// health poller can skip DB writes when the status has not changed. Seeded
	// from the DB in LoadBrokerPool.
	credStatus   map[string]int32
	credStatusMu sync.Mutex
	// credSkipLoggedAt throttles the "skipping account: credentials invalid" warning
	// to once per credSkipLogInterval per account. Accessed only from the single
	// position-sync poller goroutine (syncPositions), so it needs no lock.
	credSkipLoggedAt map[string]time.Time
	// halted / haltReasons track each account's persisted automated halt (feature 030).
	// Seeded from the DB in LoadBrokerPool. Mirrors credStatus/credStatusMu's shape.
	halted      map[string]bool
	haltReasons map[string]string
	// haltedLastPolled records when reconcileTick last polled the broker for an already-
	// halted account, so it can be throttled to trading.reconciliation.halted_poll_interval_ms
	// (a slower cadence than the ordinary tick interval) instead of the full-rate poll a
	// still-tradeable account gets — an already-halted account can't place new orders
	// regardless (isAccountHalted gates PlaceOrder/ReplaceOrder), so there is no need to
	// re-check broker state at the same frequency. Set the instant an account becomes
	// halted (haltAccount) so the cooldown starts immediately rather than after one more
	// free poll.
	haltedLastPolled map[string]time.Time
	haltedMu         sync.Mutex
	// flattenInFlight dedups the protection-window watchdog's per-bracket flatten
	// goroutines — a slow flatten must not be re-triggered by the next tick.
	flattenInFlight   map[string]bool
	flattenInFlightMu sync.Mutex
	// reconcileCandidates tracks how many consecutive ticks a candidate mismatch has been
	// observed (feature 102), keyed by "accountID:order:orderID" or "accountID:pos:symbol".
	// Cleared once resolved (no longer observed on a later tick) or once it crosses the
	// grace window and becomes a real finding. reconcileTick runs on a single poller
	// goroutine, but this is guarded by its own mutex anyway per design.md's instruction
	// (defensive — a future caller from another goroutine must not silently race).
	reconcileCandidates   map[string]int
	reconcileCandidatesMu sync.Mutex
	// confirmLocks serializes ConfirmOrder's persist→recompute→emit per offline account
	// (feature 157). Request-driven confirm lacks the poller's one-goroutine-per-account
	// serialization, so two concurrent edits on the same account would otherwise lost-update
	// the recomputed position snapshot. Keyed by account_id.
	confirmLocks   map[string]*sync.Mutex
	confirmLocksMu sync.Mutex
}

// clientKeepAlive prevents silent connection drops on idle inter-service links.
var clientKeepAlive = grpc.WithKeepaliveParams(keepalive.ClientParameters{
	Time:                30 * time.Second,
	Timeout:             10 * time.Second,
	PermitWithoutStream: true,
})

func NewTradingService(
	cfg *config.Config,
	cfgW *config.Watcher,
	accountRepo repository.AccountRepository,
	repo *repository.TradingRepo,
	orderIntentRepo repository.OrderIntentRepository,
	bracketRepo repository.BracketRepository,
	encKey string,
) (*TradingService, error) {
	ledgerConn, err := grpc.NewClient(cfg.LedgerEndpoint, grpc.WithTransportCredentials(insecure.NewCredentials()), clientKeepAlive, grpc.WithChainUnaryInterceptor(middleware.UnaryClientInterceptor))
	if err != nil {
		return nil, fmt.Errorf("dial ledger: %w", err)
	}
	notifyConn, err := grpc.NewClient(cfg.NotifyEndpoint, grpc.WithTransportCredentials(insecure.NewCredentials()), clientKeepAlive, grpc.WithChainUnaryInterceptor(middleware.UnaryClientInterceptor))
	if err != nil {
		return nil, fmt.Errorf("dial notify: %w", err)
	}
	portfolioConn, err := grpc.NewClient(cfg.PortfolioEndpoint, grpc.WithTransportCredentials(insecure.NewCredentials()), clientKeepAlive, grpc.WithChainUnaryInterceptor(middleware.UnaryClientInterceptor))
	if err != nil {
		return nil, fmt.Errorf("dial portfolio: %w", err)
	}
	marketdataConn, err := grpc.NewClient(cfg.MarketDataEndpoint, grpc.WithTransportCredentials(insecure.NewCredentials()), clientKeepAlive, grpc.WithChainUnaryInterceptor(middleware.UnaryClientInterceptor))
	if err != nil {
		return nil, fmt.Errorf("dial marketdata: %w", err)
	}
	return &TradingService{
		cfg:                 cfg,
		cfgW:                cfgW,
		configSetter:        cfgW,
		brokers:             make(map[string]brokerPoolEntry),
		accountRepo:         accountRepo,
		encKey:              encKey,
		ledger:              ledgerv1.NewLedgerServiceClient(ledgerConn),
		notify:              notifyv1.NewNotifyServiceClient(notifyConn),
		portfolio:           portfoliov1.NewPortfolioServiceClient(portfolioConn),
		marketdata:          marketdatav1.NewMarketDataServiceClient(marketdataConn),
		repo:                repo,
		baselineStore:       repo,
		orderIntentRepo:     orderIntentRepo,
		bracketRepo:         bracketRepo,
		orders:              make(map[string]*tradingv1.Order),
		subs:                make(map[string]chan *tradingv1.Order),
		credStatus:          make(map[string]int32),
		credSkipLoggedAt:    make(map[string]time.Time),
		halted:              make(map[string]bool),
		haltReasons:         make(map[string]string),
		haltedLastPolled:    make(map[string]time.Time),
		flattenInFlight:     make(map[string]bool),
		reconcileCandidates: make(map[string]int),
		confirmLocks:        make(map[string]*sync.Mutex),
	}, nil
}

// LoadBrokerPool reads all active broker accounts from DB, decrypts credentials,
// instantiates the appropriate broker client, and populates s.brokers.
func (s *TradingService) LoadBrokerPool(ctx context.Context) error {
	accounts, err := s.accountRepo.ListActiveBrokerAccounts(ctx)
	if err != nil {
		return fmt.Errorf("LoadBrokerPool: list accounts: %w", err)
	}

	s.brokersMu.Lock()
	defer s.brokersMu.Unlock()

	for _, rec := range accounts {
		// Offline accounts (feature 157) have no credentials and no broker client. Load them into
		// the pool with a nil client (tagged OFFLINE) so PlaceOrder/ConfirmOrder resolve them after
		// a restart; every broker poller skips OFFLINE entries.
		if rec.BrokerType == int32(commonv1.BrokerType_BROKER_TYPE_OFFLINE) {
			s.brokers[rec.ID] = brokerPoolEntry{client: nil, brokerType: rec.BrokerType, userID: rec.UserID}
			slog.Info("LoadBrokerPool: loaded offline account", "account_id", rec.ID, "user_id", rec.UserID)
			continue
		}
		plaintext, err := repository.DecryptCredentials(s.encKey, rec.CredentialsEnc)
		if err != nil {
			slog.Warn("LoadBrokerPool: decrypt failed, skipping account", "account_id", rec.ID, "error", err)
			continue
		}
		b, err := s.instantiateBrokerLocked(rec, plaintext)
		if err != nil {
			slog.Warn("LoadBrokerPool: instantiate broker failed, skipping account", "account_id", rec.ID, "error", err)
			continue
		}
		s.brokers[rec.ID] = brokerPoolEntry{client: b, brokerType: rec.BrokerType, userID: rec.UserID}
		s.credStatusMu.Lock()
		s.credStatus[rec.ID] = rec.CredentialStatus
		s.credStatusMu.Unlock()
		// Hydrate the persisted automated halt (feature 030) — a routine redeploy must
		// never silently un-halt an account whose failure condition might still be
		// present (design.md round 5's caught regression).
		s.haltedMu.Lock()
		s.halted[rec.ID] = rec.Halted
		s.haltReasons[rec.ID] = rec.HaltReason
		s.haltedMu.Unlock()
		slog.Info("LoadBrokerPool: loaded account", "account_id", rec.ID, "broker_type", rec.BrokerType, "is_paper", rec.IsPaper)
	}
	return nil
}

// LoadInflightOrders repopulates the in-memory order map from the DB with orders that are
// still in-flight at the broker (status NEW / PARTIALLY_FILLED with a broker_order_id). The
// fill poller only tracks orders present in s.orders, which otherwise starts empty after a
// restart — so an order placed before the restart would never have its fill detected, leaving
// it stuck NEW forever. Called once at startup, before StartFillPoller. Best-effort: a DB read
// failure is logged and the poller simply starts with whatever in-process orders exist.
func (s *TradingService) LoadInflightOrders(ctx context.Context) error {
	orders, err := s.repo.ListSubmittedOrders(ctx)
	if err != nil {
		return fmt.Errorf("LoadInflightOrders: list submitted orders: %w", err)
	}
	s.mu.Lock()
	for _, o := range orders {
		if _, exists := s.orders[o.OrderId]; !exists {
			s.orders[o.OrderId] = o
		}
	}
	n := len(orders)
	s.mu.Unlock()
	slog.Info("loaded in-flight orders for fill polling", "count", n)
	return nil
}

// resolveAccount returns the resolved account ID and broker pool entry for the given
// accountID. If accountID is empty and exactly one broker is registered, that one is
// returned. The resolved ID is returned explicitly (feature 101) — the previous 2-return
// signature discarded it on this fallback path, leaving order.AccountId (and now
// order_intents.broker_account_id, NOT NULL) empty even though a real account was used.
func (s *TradingService) resolveAccount(accountID string) (resolvedID string, entry brokerPoolEntry, err error) {
	s.brokersMu.RLock()
	defer s.brokersMu.RUnlock()

	if accountID != "" {
		e, ok := s.brokers[accountID]
		if !ok {
			return "", brokerPoolEntry{}, grpcstatus.Errorf(codes.NotFound, "broker account %q not found in pool", accountID)
		}
		return accountID, e, nil
	}

	// Sole-account fallback: auto-select only when exactly one BROKER account is registered.
	// Offline accounts (feature 157) are never the implicit account for a broker-routed order —
	// an offline PlaceOrder names its account_id and takes its own branch before this is reached.
	var soleID string
	var soleEntry brokerPoolEntry
	brokerCount := 0
	for id, e := range s.brokers {
		if e.brokerType == int32(commonv1.BrokerType_BROKER_TYPE_OFFLINE) {
			continue
		}
		brokerCount++
		soleID, soleEntry = id, e
	}
	if brokerCount == 1 {
		return soleID, soleEntry, nil
	}
	if brokerCount == 0 {
		return "", brokerPoolEntry{}, grpcstatus.Errorf(codes.FailedPrecondition, "no broker accounts registered; call RegisterBrokerAccount first")
	}
	return "", brokerPoolEntry{}, grpcstatus.Errorf(codes.InvalidArgument, "multiple broker accounts registered; account_id is required")
}

// SubscribeOrderUpdates registers a subscriber channel for order update broadcasts.
func (s *TradingService) SubscribeOrderUpdates(id string) <-chan *tradingv1.Order {
	ch := make(chan *tradingv1.Order, 64)
	s.mu.Lock()
	s.subs[id] = ch
	s.mu.Unlock()
	return ch
}

// UnsubscribeOrderUpdates removes a subscriber channel.
func (s *TradingService) UnsubscribeOrderUpdates(id string) {
	s.mu.Lock()
	if ch, ok := s.subs[id]; ok {
		close(ch)
		delete(s.subs, id)
	}
	s.mu.Unlock()
}

// broadcastOrder fans out an order update to all subscribers.
func (s *TradingService) broadcastOrder(order *tradingv1.Order) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, ch := range s.subs {
		select {
		case ch <- order:
		default:
		}
	}
}

func (s *TradingService) PlaceOrder(ctx context.Context, req *tradingv1.PlaceOrderRequest) (*tradingv1.Order, error) {
	// Check platform maintenance mode.
	if s.cfgW.GetBool("platform.maintenance_mode", false) {
		return nil, fmt.Errorf("platform is in maintenance mode — trading halted")
	}

	// Validate trailing-stop parameters: a trailing_stop order requires exactly one
	// of trail_price / trail_percent; any other order type must leave both zero.
	// Catching this here returns a clean InvalidArgument instead of a broker 422.
	if req.OrderType == tradingv1.OrderType_ORDER_TYPE_TRAILING_STOP {
		if (req.TrailPrice > 0) == (req.TrailPercent > 0) {
			return nil, grpcstatus.Errorf(codes.InvalidArgument,
				"trailing_stop order requires exactly one of trail_price or trail_percent")
		}
	} else if req.TrailPrice != 0 || req.TrailPercent != 0 {
		return nil, grpcstatus.Errorf(codes.InvalidArgument,
			"trail_price/trail_percent are only valid for trailing_stop orders")
	}

	// client_order_id is now mandatory (feature 101, FR-1): a stable client-generated
	// nonce reused across retries of the same logical place-order action, and this
	// order's intent ID for dedup purposes.
	if req.ClientOrderId == "" {
		return nil, grpcstatus.Errorf(codes.InvalidArgument, "client_order_id is required")
	}

	// Resolve broker account.
	resolvedAccountID, accountEntry, err := s.resolveAccount(req.AccountId)
	if err != nil {
		return nil, err
	}

	// Guard B (feature 159): route on the authoritative persisted broker_type as well as the
	// in-memory pool tag. broker_type is immutable post-create, so the two normally agree; reading
	// the persisted record makes the offline decision divergence-safe — an offline account can never
	// fall through to a broker path even if its pool entry is stale or mistyped. A DB read error is
	// non-fatal: fall back to the pool-tag-only decision (best-effort, mirroring the service's other
	// non-blocking reads) so a transient DB blip never fails a legitimate broker order open.
	persistedOffline := false
	if s.accountRepo != nil {
		if rec, gErr := s.accountRepo.GetBrokerAccount(ctx, resolvedAccountID); gErr != nil {
			slog.Warn("placeorder: could not read authoritative broker_type; falling back to pool tag",
				"account_id", resolvedAccountID, "error", gErr)
		} else if rec != nil {
			persistedOffline = rec.BrokerType == int32(commonv1.BrokerType_BROKER_TYPE_OFFLINE)
		}
	}

	// Offline account (feature 157): record the order as manual bookkeeping — this branch
	// precedes every broker-routing path below. It deliberately skips broker submit,
	// ComputePositionSize, bracket submission, and the halt/trading-state gates (there is no
	// broker to protect, no live position to size against, and no bracket to arm — a NEW offline
	// order becomes real only when ConfirmOrder writes its fill). resolveAccount already tagged
	// the entry OFFLINE, so no broker call is ever constructed for it (@AC-4/@AC-8).
	if accountEntry.brokerType == int32(commonv1.BrokerType_BROKER_TYPE_OFFLINE) || persistedOffline {
		return s.recordOfflineOrder(ctx, req, resolvedAccountID, accountEntry.userID)
	}

	// Resolve trading mode: request field takes precedence; fall back to live config, then env.
	mode := s.resolveTradingMode(req.TradingMode)

	// Persisted per-account automated halt (feature 030) — gates right after the
	// account is resolved, mirroring the trading_state gate immediately below.
	// ReplaceOrder gets the identical gate (no reduce-only carve-out); CancelOrder is
	// deliberately never gated (the operator's sole remaining manual de-risk tool).
	if s.isAccountHalted(resolvedAccountID) {
		return nil, grpcstatus.Errorf(codes.FailedPrecondition, "account is halted: %s", s.haltReason(resolvedAccountID))
	}

	// platform.trading_state gate (feature 100): HALTED blocks outright; REDUCE_ONLY
	// blocks only exposure-increasing orders (verified via PortfolioService.GetPosition).
	// Independent of and parallel to platform.maintenance_mode below.
	if err := s.checkTradingStateForPlaceOrder(ctx, accountEntry.userID, req.Symbol, mode, req.Side); err != nil {
		return nil, err
	}

	// Compute the request-content hash (feature 101, FR-3) — the dedup mechanism's
	// content-identity check, independent of the client_order_id nonce itself. Deliberately
	// computed BEFORE position sizing (feature 023) mutates req.Qty below: the hash must
	// reflect the caller's original request so a genuine retry of the same logical action
	// always matches, even if market data has since moved and would size differently.
	hashDigest, err := placeOrderRequestHash(req)
	if err != nil {
		return nil, grpcstatus.Errorf(codes.Internal, "compute request hash: %v", err)
	}
	requestHashHex := hex.EncodeToString(hashDigest)

	// Position sizing (feature 023): qty <= 0 means "auto-size this order" — the
	// sizing_enabled master gate rejects that up front if sizing is disabled (AC-4).
	sizingEnabled := s.cfgW.GetBool("trading.risk.sizing_enabled", true)
	needSizing := req.Qty <= 0
	if needSizing && !sizingEnabled {
		return nil, grpcstatus.Errorf(codes.FailedPrecondition, "position sizing is disabled; an explicit qty is required")
	}

	// Hoisted from checkPortfolioRisk's own internal guard so sizing and the warn-only
	// risk check can share one equity lookup instead of each fetching it independently.
	// Caller identity from the trusted x-user-id header (deprecated request body user_id ignored).
	needRiskCheck := middleware.FromContext(ctx).UserID != "" && s.cfgW.GetFloat("trading.risk.max_position_pct", 0.05) > 0
	var equity float64
	var equityErr error
	if needSizing || needRiskCheck {
		equity, equityErr = s.resolveAccountEquity(ctx, resolvedAccountID)
	}

	// sizedStopPrice is the informational stop computed by ComputePositionSize (feature
	// 023) — set on the order below only for MARKET/LIMIT auto-sized orders; never a real
	// broker-submitted STOP/STOP_LIMIT/TRAILING_STOP trigger. entryPriceProxy (feature 030)
	// is the bracket take-profit formula's entry-price estimate.
	var sizedStopPrice, entryPriceProxy float64
	if needSizing {
		// Fail-closed (design.md § Chosen Approach) — unlike checkPortfolioRisk below,
		// missing/zero equity aborts the order rather than just skipping a warning.
		if equityErr != nil || equity <= 0 {
			return nil, grpcstatus.Errorf(codes.FailedPrecondition, "cannot auto-size order: equity unavailable: %v", equityErr)
		}
		confidence := 1.0
		if req.Confidence != nil {
			confidence = *req.Confidence
		}
		if confidence < 0.0 || confidence > 1.0 {
			return nil, grpcstatus.Errorf(codes.InvalidArgument, "confidence must be in [0.0, 1.0], got %v", confidence)
		}
		sizedQty, _, computedStopPrice, computedCurrentPrice, sizeErr := s.ComputePositionSize(ctx, req, equity, confidence)
		if sizeErr != nil {
			return nil, sizeErr
		}
		// Mutate req.Qty in place — load-bearing: buildBrokerRequest(req) and the approval
		// threshold check below both read req.Qty after this point.
		req.Qty = sizedQty
		sizedStopPrice = computedStopPrice
		// Prefer the LIMIT order's own limit price over the fetched current price as the
		// entry-price proxy (feature 030) — a closer estimate of the actual fill price.
		entryPriceProxy = computedCurrentPrice
		if req.OrderType == tradingv1.OrderType_ORDER_TYPE_LIMIT {
			entryPriceProxy = req.LimitPrice
		}
	}

	// Non-blocking portfolio risk check: log warnings but never block order placement. Runs
	// after sizing so it evaluates the real (possibly auto-sized) req.Qty — fixes the
	// pre-existing bug where this structurally could never fire for auto-sized orders.
	if needRiskCheck {
		s.checkPortfolioRisk(ctx, req, mode, equity, equityErr)
	}

	// Check approval thresholds from live config.
	approvalQtyThreshold := s.cfgW.GetFloat("trading.approval.require_above_qty", 500)
	approvalNotionalThreshold := s.cfgW.GetFloat("trading.approval.require_above_notional", 50000)
	requiresApproval := req.Qty > approvalQtyThreshold ||
		(req.LimitPrice > 0 && req.Qty*req.LimitPrice > approvalNotionalThreshold)

	orderID := uuid.New().String()

	return s.submitOrder(ctx, req, accountEntry, mode, resolvedAccountID, orderID, requiresApproval,
		requestHashHex, needSizing, sizedStopPrice, entryPriceProxy)
}

// submitOrder is PlaceOrder's approval-decision-and-broker-submission seam, extracted
// (feature 030) so flattenAndHalt can reuse the exact same safety machinery — order
// intent dedup, ledger events, timeout-vs-definite-rejection handling, bracket
// submission — that any other order gets, rather than a parallel ad hoc broker call.
//
// Deviation from design.md's literal 6-parameter signature: requestHashHex/needSizing/
// sizedStopPrice/entryPriceProxy are also threaded through explicitly. design.md
// predates features 101 (order-intent dedup) and 023 (position sizing) actually
// landing on this branch, so it could not have anticipated their real shape. The
// request hash in particular MUST be the caller's pre-sizing computation (see
// PlaceOrder's own comment on why) — recomputing it here against the (possibly
// already-mutated) req would defeat that guarantee. flattenAndHalt calls this with
// needSizing=false (a flatten order always carries an explicit qty, never triggers
// bracket submission) and a freshly-computed requestHashHex over the flatten request
// (self-consistent: a flatten is never itself a candidate for the sizing-hash-order
// subtlety, since it's never auto-sized).
func (s *TradingService) submitOrder(
	ctx context.Context,
	req *tradingv1.PlaceOrderRequest,
	accountEntry brokerPoolEntry,
	mode commonv1.TradingMode,
	resolvedAccountID string,
	orderID string,
	requiresApproval bool,
	requestHashHex string,
	needSizing bool,
	sizedStopPrice, entryPriceProxy float64,
) (*tradingv1.Order, error) {
	intentID := req.ClientOrderId

	orderStatus := tradingv1.OrderStatus_ORDER_STATUS_NEW
	if requiresApproval {
		orderStatus = tradingv1.OrderStatus_ORDER_STATUS_PENDING_APPROVAL
	}

	// Dedup insert (feature 101): gated on !requiresApproval. An approval-required
	// order has no broker call yet at all — it is not part of this feature's dedup
	// surface (FR-1..FR-6 concern the broker call, which the approval path defers
	// indefinitely) — so it deliberately touches no order_intents row. This also
	// satisfies "insert before building the provisional order struct" (still true when
	// it does run) without an approval-required order acquiring an intent it should
	// never have.
	ownsIntent := true
	var intentState tradingv1.IntentState
	if !requiresApproval {
		ok, err := s.orderIntentRepo.InsertIntent(ctx, &repository.OrderIntentRecord{
			IntentID: intentID, OrderID: orderID, RequestHash: requestHashHex,
			BrokerAccountID: resolvedAccountID,
		})
		if err != nil {
			return nil, grpcstatus.Errorf(codes.Internal, "insert order intent: %v", err)
		}
		if !ok {
			existing, getErr := s.orderIntentRepo.GetIntentByID(ctx, intentID)
			if getErr != nil || existing == nil {
				return nil, grpcstatus.Errorf(codes.Internal, "load existing order intent: %v", getErr)
			}
			action, isStale := classifyIntentLookup(existing, requestHashHex, time.Now(), staleThreshold(s.cfgW))
			switch action {
			case intentActionRejectHashMismatch:
				return nil, grpcstatus.Errorf(codes.FailedPrecondition,
					"client_order_id %q was already used with different order content", intentID)
			case intentActionReturnStored:
				var stored tradingv1.Order
				if err := proto.Unmarshal(existing.LatestResponse, &stored); err != nil {
					return nil, grpcstatus.Errorf(codes.Internal, "unmarshal stored intent response: %v", err)
				}
				return &stored, nil
			case intentActionRejectUnknown:
				return nil, grpcstatus.Errorf(codes.FailedPrecondition,
					"order intent %q outcome is unknown; verify with the broker before retrying", intentID)
			default: // intentActionRejectPending
				if isStale {
					// Best-effort — the caller cannot and need not distinguish "not yet
					// stale" from "just reclaimed" (design.md § Concurrency).
					_, _, _ = s.orderIntentRepo.ReclaimOrphanIntent(ctx, intentID, existing.UpdatedAt.Add(staleThreshold(s.cfgW)))
				}
				return nil, grpcstatus.Errorf(codes.FailedPrecondition,
					"order intent %q is still pending", intentID)
			}
		}
		intentState = tradingv1.IntentState_INTENT_STATE_PENDING
	} else {
		ownsIntent = false
	}

	order := &tradingv1.Order{
		OrderId:       orderID,
		ClientOrderId: req.ClientOrderId,
		Symbol:        req.Symbol,
		Side:          req.Side,
		OrderType:     req.OrderType,
		Status:        orderStatus,
		Qty:           req.Qty,
		FilledQty:     0,
		LimitPrice:    req.LimitPrice,
		StopPrice:     req.StopPrice,
		TimeInForce:   req.TimeInForce,
		StrategyId:    req.StrategyId,
		UserId:        accountEntry.userID,
		TradingMode:   mode,
		AccountId:     resolvedAccountID,
		BrokerType:    commonv1.BrokerType(accountEntry.brokerType),
		CreatedAt:     timestamppb.New(time.Now()),
		UpdatedAt:     timestamppb.New(time.Now()),
		IntentState:   intentState,
	}
	// Informational stop price for auto-sized MARKET/LIMIT orders only (feature 023) — this
	// is never submitted to the broker as a real STOP/STOP_LIMIT/TRAILING_STOP trigger
	// (product-spec's Out-of-Scope note); every other order type and every override-mode
	// (explicit-qty) order keeps req.StopPrice, the real broker-trigger price, untouched.
	if needSizing && (req.OrderType == tradingv1.OrderType_ORDER_TYPE_MARKET || req.OrderType == tradingv1.OrderType_ORDER_TYPE_LIMIT) {
		order.StopPrice = sizedStopPrice
	}

	s.mu.Lock()
	s.orders[orderID] = order
	s.mu.Unlock()

	// Persist order to DB.
	if err := s.repo.UpsertOrder(ctx, order); err != nil {
		slog.Warn("db upsert order failed", "order_id", orderID, "error", err)
	}

	go s.emitLedgerEvent(context.Background(), "order.created", orderID, map[string]interface{}{
		"symbol": order.Symbol, "side": order.Side.String(), "qty": order.Qty,
		"status": orderStatus.String(), "trading_mode": mode.String(),
	})

	if requiresApproval {
		go s.emitLedgerEvent(context.Background(), "order.approval_requested", orderID, map[string]interface{}{
			"order_id": orderID, "symbol": order.Symbol, "qty": order.Qty,
			"limit_price": order.LimitPrice, "user_id": order.UserId,
		})
		go s.emitApprovalAlert(context.Background(), order)
		slog.Info("order pending approval", "order_id", orderID, "symbol", req.Symbol)
		return order, nil
	}

	// Emit order.submitted before calling broker — signals intent to submit.
	go s.emitLedgerEvent(context.Background(), "order.submitted", orderID, map[string]interface{}{
		"order_id": orderID, "symbol": order.Symbol, "side": order.Side.String(),
		"qty": order.Qty, "trading_mode": mode.String(),
	})

	// Submit to broker.
	brokerReq := s.buildBrokerRequest(req)
	// Forward the derived broker client-order-id (feature 101) instead of the raw
	// platform order ID, so a retried submission is de-duplicated by the broker too —
	// IBKR's only dedup mechanism (it has no server-side idempotency of its own).
	brokerReq.ClientOrderID = broker.DeriveBrokerClientOrderID(intentID)
	// Alpaca-native bracket attach (feature 030): strictly safer than post-fill
	// submission — no fill→stop gap. IBKR does not accept these fields on SubmitOrder
	// (no order_class field exists in its request shape); its legs go through
	// maybeSubmitBracket's SubmitBracketLegs follow-up call after the fill is confirmed.
	bracketOrdersEnabled := needSizing && sizedStopPrice > 0 && s.cfgW.GetBool("trading.risk.bracket_orders_enabled", true)
	if bracketOrdersEnabled && commonv1.BrokerType(accountEntry.brokerType) == commonv1.BrokerType_BROKER_TYPE_ALPACA {
		brokerReq.BracketStopPrice = sizedStopPrice
		brokerReq.BracketTakeProfitPrice = s.computeTakeProfitPrice(order.Side, sizedStopPrice, entryPriceProxy)
	}
	brokerOrder, err := accountEntry.client.SubmitOrder(ctx, brokerReq)
	if err != nil {
		var netErr net.Error
		isTimeout := errors.Is(err, context.DeadlineExceeded) || (errors.As(err, &netErr) && netErr.Timeout())
		if isTimeout {
			// Uncertain outcome (feature 101, FR-4): leave order.Status at its
			// pre-broker-call value and the intent PENDING for reclaim — do not
			// unconditionally mark REJECTED, which would conflate "definitely
			// rejected" with "we don't know what happened."
			_ = s.repo.UpsertOrder(context.Background(), order)
			go s.emitLedgerEvent(context.Background(), "order.broker_call_uncertain", orderID, map[string]interface{}{
				"order_id": orderID, "intent_id": intentID, "error": err.Error(),
			})
			slog.Warn("broker call uncertain (timeout)", "order_id", orderID, "intent_id", intentID, "error", err)
			return order, fmt.Errorf("broker submission failed: %w", err)
		}
		// Definite, synchronous rejection — existing behavior unchanged.
		order.Status = tradingv1.OrderStatus_ORDER_STATUS_REJECTED
		order.UpdatedAt = timestamppb.New(time.Now())
		go s.emitLedgerEvent(context.Background(), "order.broker_rejected", orderID, map[string]interface{}{
			"order_id": orderID, "error": err.Error(), "trading_mode": mode.String(),
		})
		_ = s.repo.UpsertOrder(context.Background(), order)
		if ownsIntent {
			if marshaled, mErr := proto.Marshal(order); mErr == nil {
				if fErr := s.orderIntentRepo.FinalizeIntent(context.Background(), intentID, orderID, repository.IntentStateRejected, marshaled); fErr != nil {
					slog.Warn("finalize order intent (rejected) failed", "intent_id", intentID, "error", fErr)
				}
			}
		}
		slog.Error("broker rejected order", "order_id", orderID, "error", err)
		return nil, fmt.Errorf("broker submission failed: %w", err)
	}

	// Update order with broker-assigned fields.
	order.BrokerOrderId = brokerOrder.BrokerOrderID
	// Keep the existing status (NEW) if the broker's submit response carries a transient
	// or unrecognized status (UNSPECIFIED) rather than clobbering it; the fill poller will
	// reconcile the order to its real status.
	if st := alpacaStatusToProto(brokerOrder.Status); st != tradingv1.OrderStatus_ORDER_STATUS_UNSPECIFIED {
		order.Status = st
	}
	order.UpdatedAt = timestamppb.New(time.Now())
	// Carry any fill the broker already reported on submit (market orders fill
	// immediately). Without this the fill poller — which skips orders already in
	// FILLED state — would never backfill the quantity, leaving FILLED orders at 0.
	order.FilledQty = brokerOrder.FilledQty
	order.FilledAvgPrice = brokerOrder.FilledAvgPrice
	if order.Status == tradingv1.OrderStatus_ORDER_STATUS_FILLED && order.FilledQty == 0 {
		order.FilledQty = order.Qty
	}
	order.IntentState = tradingv1.IntentState_INTENT_STATE_COMPLETED

	// Bracket submission (feature 030) — only once a fill is confirmed (a resting,
	// unfilled LIMIT entry has nothing to protect yet; the fill poller's own hook
	// handles that case when the fill is later detected). entryProxy prefers the real
	// average fill price over the pre-fill estimate once it's known.
	if order.FilledQty > 0 {
		entryProxy := entryPriceProxy
		if order.FilledAvgPrice > 0 {
			entryProxy = order.FilledAvgPrice
		}
		s.maybeSubmitBracket(context.Background(), order, accountEntry, brokerOrder, order.StopPrice, entryProxy,
			s.cfgW.GetBool("trading.risk.bracket_orders_enabled", true))
	}

	// Persist updated order with broker fields.
	if err := s.repo.UpsertOrder(context.Background(), order); err != nil {
		slog.Warn("db upsert after broker submit failed", "order_id", orderID, "error", err)
	}
	if ownsIntent {
		if marshaled, mErr := proto.Marshal(order); mErr == nil {
			if fErr := s.orderIntentRepo.FinalizeIntent(context.Background(), intentID, orderID, repository.IntentStateCompleted, marshaled); fErr != nil {
				slog.Warn("finalize order intent (completed) failed", "intent_id", intentID, "error", fErr)
			}
		}
	}

	go s.emitLedgerEvent(context.Background(), "order.broker_submitted", orderID, map[string]interface{}{
		"order_id": orderID, "broker_order_id": brokerOrder.BrokerOrderID,
		"broker_status": brokerOrder.Status, "trading_mode": mode.String(),
	})

	slog.Info("order submitted to broker", "order_id", orderID, "broker_order_id", brokerOrder.BrokerOrderID,
		"trading_mode", mode.String(), "broker_status", brokerOrder.Status)
	return order, nil
}

// recordOfflineOrder persists a manually-entered order for an offline account (feature 157). It
// never contacts a broker: it reuses feature 101's client_order_id dedup for idempotent record
// (a retried record with the same nonce returns the stored order) but finalizes the intent
// synchronously — there is no broker call to await. The order lands NEW with filled_qty = 0 and an
// empty broker_order_id; it becomes economically real only when ConfirmOrder writes its fill.
func (s *TradingService) recordOfflineOrder(ctx context.Context, req *tradingv1.PlaceOrderRequest, accountID, userID string) (*tradingv1.Order, error) {
	mode := s.resolveTradingMode(req.TradingMode)

	hashDigest, err := placeOrderRequestHash(req)
	if err != nil {
		return nil, grpcstatus.Errorf(codes.Internal, "compute request hash: %v", err)
	}
	requestHashHex := hex.EncodeToString(hashDigest)
	orderID := uuid.New().String()
	intentID := req.ClientOrderId

	ok, err := s.orderIntentRepo.InsertIntent(ctx, &repository.OrderIntentRecord{
		IntentID: intentID, OrderID: orderID, RequestHash: requestHashHex, BrokerAccountID: accountID,
	})
	if err != nil {
		return nil, grpcstatus.Errorf(codes.Internal, "insert order intent: %v", err)
	}
	if !ok {
		existing, getErr := s.orderIntentRepo.GetIntentByID(ctx, intentID)
		if getErr != nil || existing == nil {
			return nil, grpcstatus.Errorf(codes.Internal, "load existing order intent: %v", getErr)
		}
		action, _ := classifyIntentLookup(existing, requestHashHex, time.Now(), staleThreshold(s.cfgW))
		switch action {
		case intentActionRejectHashMismatch:
			return nil, grpcstatus.Errorf(codes.FailedPrecondition,
				"client_order_id %q was already used with different order content", intentID)
		case intentActionReturnStored:
			var stored tradingv1.Order
			if err := proto.Unmarshal(existing.LatestResponse, &stored); err != nil {
				return nil, grpcstatus.Errorf(codes.Internal, "unmarshal stored intent response: %v", err)
			}
			return &stored, nil
		default:
			// An offline record finalizes its intent synchronously below, so a PENDING/UNKNOWN
			// here means a concurrent in-flight record of the same nonce — reject as duplicate.
			return nil, grpcstatus.Errorf(codes.FailedPrecondition, "order intent %q is already in progress", intentID)
		}
	}

	order := &tradingv1.Order{
		OrderId:       orderID,
		ClientOrderId: req.ClientOrderId,
		Symbol:        req.Symbol,
		Side:          req.Side,
		OrderType:     req.OrderType,
		Status:        tradingv1.OrderStatus_ORDER_STATUS_NEW,
		Qty:           req.Qty,
		FilledQty:     0,
		LimitPrice:    req.LimitPrice,
		StopPrice:     req.StopPrice,
		TimeInForce:   req.TimeInForce,
		StrategyId:    req.StrategyId,
		UserId:        userID,
		TradingMode:   mode,
		AccountId:     accountID,
		BrokerType:    commonv1.BrokerType_BROKER_TYPE_OFFLINE,
		CreatedAt:     timestamppb.New(time.Now()),
		UpdatedAt:     timestamppb.New(time.Now()),
		// no broker_order_id and no filled_at — an offline order is unconfirmed until ConfirmOrder.
	}

	s.mu.Lock()
	s.orders[orderID] = order
	s.mu.Unlock()

	if err := s.repo.UpsertOrder(ctx, order); err != nil {
		return nil, grpcstatus.Errorf(codes.Internal, "persist offline order: %v", err)
	}
	if marshaled, mErr := proto.Marshal(order); mErr == nil {
		if fErr := s.orderIntentRepo.FinalizeIntent(ctx, intentID, orderID, repository.IntentStateCompleted, marshaled); fErr != nil {
			slog.Warn("finalize offline order intent failed", "intent_id", intentID, "error", fErr)
		}
	}

	go s.emitLedgerEvent(context.Background(), "order.created", orderID, map[string]interface{}{
		"symbol": order.Symbol, "side": order.Side.String(), "qty": order.Qty,
		"status": order.Status.String(), "trading_mode": mode.String(), "account_id": accountID,
	})
	return order, nil
}

// confirmLock returns the per-account mutex serializing ConfirmOrder's persist→recompute→emit.
func (s *TradingService) confirmLock(accountID string) *sync.Mutex {
	s.confirmLocksMu.Lock()
	defer s.confirmLocksMu.Unlock()
	lk, ok := s.confirmLocks[accountID]
	if !ok {
		lk = &sync.Mutex{}
		s.confirmLocks[accountID] = lk
	}
	return lk
}

// deriveOfflineStatus maps a confirmed fill quantity to an order status server-side (never
// client-supplied): 0 → NEW, 0 < filled < qty → PARTIALLY_FILLED, filled >= qty → FILLED.
func deriveOfflineStatus(filledQty, qty float64) tradingv1.OrderStatus {
	switch {
	case filledQty <= 0:
		return tradingv1.OrderStatus_ORDER_STATUS_NEW
	case filledQty < qty:
		return tradingv1.OrderStatus_ORDER_STATUS_PARTIALLY_FILLED
	default:
		return tradingv1.OrderStatus_ORDER_STATUS_FILLED
	}
}

// offlineFillsFromOrders maps an offline account's confirmed orders to the signed fills the pnl fold
// consumes: a BUY contributes +filled_qty, a SELL −filled_qty, at each order's filled_avg_price.
func offlineFillsFromOrders(orders []*tradingv1.Order) []pnl.Fill {
	fills := make([]pnl.Fill, 0, len(orders))
	for _, o := range orders {
		signed := o.FilledQty
		if o.Side == tradingv1.OrderSide_ORDER_SIDE_SELL {
			signed = -signed
		}
		fills = append(fills, pnl.Fill{Symbol: o.Symbol, Qty: signed, Price: o.FilledAvgPrice})
	}
	return fills
}

// ConfirmOrder writes the fill a broker would otherwise report onto an OFFLINE order (feature 157),
// then recomputes the account's absolute net positions from ALL its confirmed orders and emits the
// self-healing account.positions.synced event — never order.filled (the invariant that keeps
// portfolio's incremental fold from double-counting). It is order-sourced and never contacts a
// broker: it rejects broker accounts and non-owners from the persisted order alone.
func (s *TradingService) ConfirmOrder(ctx context.Context, req *tradingv1.ConfirmOrderRequest) (*tradingv1.Order, error) {
	if req.OrderId == "" {
		return nil, grpcstatus.Errorf(codes.InvalidArgument, "order_id is required")
	}
	if req.FilledQty < 0 {
		return nil, grpcstatus.Errorf(codes.InvalidArgument, "filled_qty must be >= 0")
	}

	order, err := s.repo.GetOrder(ctx, req.OrderId)
	if err != nil {
		return nil, grpcstatus.Errorf(codes.Internal, "load order: %v", err)
	}
	if order == nil {
		return nil, grpcstatus.Errorf(codes.NotFound, "order %q not found", req.OrderId)
	}
	// Order-sourced guard — GetOrder already selects broker_type + user_id, so no broker call is
	// needed to reject a broker account (@AC-9) or a non-owner.
	if order.BrokerType != commonv1.BrokerType_BROKER_TYPE_OFFLINE {
		return nil, grpcstatus.Errorf(codes.FailedPrecondition, "ConfirmOrder applies only to offline accounts")
	}
	if callerID := middleware.FromContext(ctx).UserID; callerID != "" && order.UserId != callerID {
		return nil, grpcstatus.Errorf(codes.FailedPrecondition, "order %q does not belong to caller", req.OrderId)
	}

	// Serialize persist→recompute→emit per account — request-driven confirm lacks the pollers'
	// one-goroutine-per-account serialization (@AC-10 idempotency depends on a consistent recompute).
	lock := s.confirmLock(order.AccountId)
	lock.Lock()
	defer lock.Unlock()

	// Server-derived status from filled_qty vs qty (never client-supplied).
	order.FilledQty = req.FilledQty
	order.FilledAvgPrice = req.FilledAvgPrice
	order.Status = deriveOfflineStatus(req.FilledQty, order.Qty)
	filledAt := time.Now()
	if req.FilledAt != nil {
		filledAt = req.FilledAt.AsTime()
	}
	order.FilledAt = timestamppb.New(filledAt)
	order.UpdatedAt = timestamppb.New(time.Now())

	if err := s.repo.UpsertOrder(ctx, order); err != nil {
		return nil, grpcstatus.Errorf(codes.Internal, "persist confirmed order: %v", err)
	}
	s.mu.Lock()
	s.orders[order.OrderId] = order
	s.mu.Unlock()

	// Recompute the account's absolute net positions from ALL its confirmed offline orders
	// (seeded by the effective baseline when one exists) — the @AC-10 idempotency guarantee.
	if err := s.recomputeAndEmitOfflinePositions(ctx, order.AccountId, order.UserId); err != nil {
		slog.Warn("ConfirmOrder: recompute failed; positions.synced not emitted",
			"account_id", order.AccountId, "error", err)
	}
	return order, nil
}

// recomputeAndEmitOfflinePositions recomputes the absolute net positions for an offline account
// from ALL its confirmed orders, seeded by the effective baseline when one exists, and emits the
// self-healing account.positions.synced event. Fail-closed: a query error skips the emit (an
// empty snapshot would make portfolio's DeletePositionsNotInSync wipe the account).
//
// caller must hold s.confirmLock(accountID).
func (s *TradingService) recomputeAndEmitOfflinePositions(ctx context.Context, accountID, userID string) error {
	// --- Load baseline (fail-closed: error → skip emit) ---
	asOf, seedLots, hasBaseline, err := s.baselineStore.EffectiveBaselineByAccount(ctx, accountID)
	if err != nil {
		slog.Warn("recomputeAndEmitOfflinePositions: baseline query failed; skipping positions.synced emit",
			"account_id", accountID, "error", err)
		return err
	}

	// --- Load confirmed orders (fail-closed: error → skip emit) ---
	confirmed, err := s.baselineStore.ListConfirmedOfflineOrdersByAccount(ctx, accountID)
	if err != nil {
		slog.Warn("recomputeAndEmitOfflinePositions: recompute query failed; skipping positions.synced emit",
			"account_id", accountID, "error", err)
		return err
	}

	// --- Fold: three-branch baseline build (design.md § One producer, three baseline cases) ---
	var result pnl.FoldResult
	// postT0Symbols tracks which symbols had a post-T0 fill (for provenance computation).
	postT0Symbols := make(map[string]bool)
	if hasBaseline {
		// Baseline branch: filter confirmed orders to only those with filled_at > asOf.
		var postT0Orders []*tradingv1.Order
		for _, o := range confirmed {
			if o.FilledAt != nil && o.FilledAt.AsTime().After(asOf) {
				postT0Orders = append(postT0Orders, o)
				postT0Symbols[o.Symbol] = true
			}
		}
		result = pnl.FoldFrom(seedLots, offlineFillsFromOrders(postT0Orders))
	} else {
		// No-baseline branch: fold ALL confirmed orders — byte-identical to feature-157 behavior.
		result = pnl.Fold(offlineFillsFromOrders(confirmed))
	}

	// --- Build position entries with symbol-level provenance ---
	baselineSymbols := make(map[string]bool, len(seedLots))
	for sym := range seedLots {
		baselineSymbols[sym] = true
	}

	tradingMode := "TRADING_MODE_LIVE"
	if s.environmentIsPaper() {
		tradingMode = "TRADING_MODE_PAPER"
	}
	posEntries := make([]interface{}, 0, len(result.Positions))
	for sym, lot := range result.Positions {
		avgCost := 0.0
		if lot.Qty != 0 {
			avgCost = lot.CostBasis / lot.Qty
		}
		entry := map[string]interface{}{
			"symbol":   sym,
			"qty":      lot.Qty,
			"avg_cost": avgCost,
			// Offline positions carry no broker mark-to-market — portfolio enriches from mid-quotes.
			"current_price":   0.0,
			"market_value":    0.0,
			"unrealized_pl":   0.0,
			"unrealized_plpc": 0.0,
			"day_pnl":         0.0,
			"day_pnl_pct":     0.0,
		}
		// Symbol-level provenance (design.md § Symbol-level MIXED):
		// - in baseline AND has a post-T0 fill → MIXED (3)
		// - in baseline, no post-T0 fill → BASELINE (2)
		// - only post-T0 fills (or no baseline exists) → ORDERS (1)
		if hasBaseline {
			inBaseline := baselineSymbols[sym]
			hasPostT0 := postT0Symbols[sym]
			switch {
			case inBaseline && hasPostT0:
				entry["source"] = int32(portfoliov1.PositionSource_POSITION_SOURCE_MIXED)
				entry["as_of"] = asOf.Format(time.RFC3339Nano)
			case inBaseline:
				entry["source"] = int32(portfoliov1.PositionSource_POSITION_SOURCE_BASELINE)
				entry["as_of"] = asOf.Format(time.RFC3339Nano)
			default:
				entry["source"] = int32(portfoliov1.PositionSource_POSITION_SOURCE_ORDERS)
			}
		} else {
			entry["source"] = int32(portfoliov1.PositionSource_POSITION_SOURCE_ORDERS)
		}
		posEntries = append(posEntries, entry)
	}
	// Emit account.positions.synced ONLY (never order.filled) — the disjointness invariant that
	// keeps portfolio's ConsumeOrderFills/GetPnL from double-folding. realized_pnl carries the
	// account-grain cumulative realized; broker syncs never set the key (nil on the portfolio side).
	// Run on the inbound request ctx (C-03 header propagation).
	s.emitLedgerEvent(ctx, "account.positions.synced", fmt.Sprintf("account:%s", accountID), map[string]interface{}{
		"account_id":   accountID,
		"user_id":      userID,
		"trading_mode": tradingMode,
		"positions":    posEntries,
		"realized_pnl": result.Realized,
	})
	return nil
}

// SnapshotOfflinePositions records brokerage-statement period-end holdings as an effective-dated
// opening baseline for an OFFLINE account (feature 163). Rejected with FailedPrecondition for
// broker (Alpaca/IBKR) accounts. Per-row validation is fault-tolerant: invalid rows are rejected
// individually, valid rows commit, and the response lists both.
func (s *TradingService) SnapshotOfflinePositions(ctx context.Context, req *tradingv1.SnapshotOfflinePositionsRequest) (*tradingv1.SnapshotOfflinePositionsResponse, error) {
	if req.AccountId == "" {
		return nil, grpcstatus.Errorf(codes.InvalidArgument, "account_id is required")
	}
	if req.UserId == "" {
		return nil, grpcstatus.Errorf(codes.InvalidArgument, "user_id is required")
	}
	if req.ClientSnapshotId == "" {
		return nil, grpcstatus.Errorf(codes.InvalidArgument, "client_snapshot_id is required")
	}
	if req.AsOf == nil {
		return nil, grpcstatus.Errorf(codes.InvalidArgument, "as_of is required")
	}

	// Offline-only gate: mirrors ConfirmOrder's guard (AC-9).
	rec, err := s.accountRepo.GetBrokerAccount(ctx, req.AccountId)
	if err != nil {
		return nil, grpcstatus.Errorf(codes.NotFound, "account %q not found: %v", req.AccountId, err)
	}
	if rec.BrokerType != int32(commonv1.BrokerType_BROKER_TYPE_OFFLINE) {
		return nil, grpcstatus.Errorf(codes.FailedPrecondition, "snapshots apply to OFFLINE accounts only")
	}

	// Per-row validation (fault-tolerant — FR-5/AC-7).
	var (
		validRows []repository.BaselineRow
		rejected  []*tradingv1.RejectedBaselineRow
	)
	for i, pos := range req.Positions {
		switch {
		case pos.Symbol == "":
			rejected = append(rejected, &tradingv1.RejectedBaselineRow{
				RowIndex: int32(i), Reason: "empty symbol",
			})
		case math.IsInf(pos.Qty, 0) || math.IsNaN(pos.Qty):
			rejected = append(rejected, &tradingv1.RejectedBaselineRow{
				RowIndex: int32(i), Reason: fmt.Sprintf("non-finite qty for %s", pos.Symbol),
			})
		case math.IsInf(pos.AvgCostPerShare, 0) || math.IsNaN(pos.AvgCostPerShare):
			rejected = append(rejected, &tradingv1.RejectedBaselineRow{
				RowIndex: int32(i), Reason: fmt.Sprintf("non-finite avg_cost_per_share for %s", pos.Symbol),
			})
		case pos.AvgCostPerShare < 0:
			rejected = append(rejected, &tradingv1.RejectedBaselineRow{
				RowIndex: int32(i), Reason: fmt.Sprintf("negative avg_cost_per_share for %s", pos.Symbol),
			})
		default:
			// qty == 0 is valid (flatten — commits, dropped later by EffectiveBaselineByAccount, AC-8/AC-15).
			validRows = append(validRows, repository.BaselineRow{
				Symbol:          pos.Symbol,
				Qty:             pos.Qty,
				AvgCostPerShare: pos.AvgCostPerShare,
			})
		}
	}

	asOf := req.AsOf.AsTime()

	// Warnings: check for unconfirmed NEW offline orders (AC-16, design.md § Snapshot-over-NEW).
	var warnings []string
	hasNew, warnErr := s.baselineStore.HasUnconfirmedOfflineOrders(ctx, req.AccountId)
	if warnErr != nil {
		slog.Warn("SnapshotOfflinePositions: failed to check for unconfirmed orders",
			"account_id", req.AccountId, "error", warnErr)
	} else if hasNew {
		warnings = append(warnings, "account has unconfirmed NEW offline orders; their fills are excluded from the position fold until confirmed")
	}

	// Serialize persist→audit→recompute→emit under the per-account lock (@AC-10).
	lock := s.confirmLock(req.AccountId)
	lock.Lock()
	defer lock.Unlock()

	if err := s.baselineStore.UpsertBaselineSnapshot(ctx, req.AccountId, req.ClientSnapshotId, asOf, validRows); err != nil {
		return nil, grpcstatus.Errorf(codes.Internal, "persist baseline: %v", err)
	}

	// Audit event: account.positions.baseline_set (FR-6/AC-10, append-latest).
	baselinePayload := make([]interface{}, 0, len(validRows))
	for _, r := range validRows {
		baselinePayload = append(baselinePayload, map[string]interface{}{
			"symbol":             r.Symbol,
			"qty":                r.Qty,
			"avg_cost_per_share": r.AvgCostPerShare,
		})
	}
	s.emitLedgerEvent(ctx, "account.positions.baseline_set", fmt.Sprintf("account:%s", req.AccountId), map[string]interface{}{
		"account_id":         req.AccountId,
		"user_id":            req.UserId,
		"client_snapshot_id": req.ClientSnapshotId,
		"as_of":              asOf.Format(time.RFC3339Nano),
		"positions":          baselinePayload,
	})

	// Recompute and emit the seeded positions.synced event.
	if err := s.recomputeAndEmitOfflinePositions(ctx, req.AccountId, req.UserId); err != nil {
		slog.Warn("SnapshotOfflinePositions: recompute failed after baseline persist",
			"account_id", req.AccountId, "error", err)
	}

	return &tradingv1.SnapshotOfflinePositionsResponse{
		AccountId:      req.AccountId,
		CommittedCount: int32(len(validRows)),
		Rejected:       rejected,
		Warnings:       warnings,
	}, nil
}

// CancelOrder is deliberately NOT gated by platform.trading_state (feature 100) — mirrors
// feature 030's identical decision on its own per-account halt: cancellation is the
// operator's sole remaining manual de-risk tool and must work even when trading is halted.
func (s *TradingService) CancelOrder(ctx context.Context, req *tradingv1.CancelOrderRequest) (*tradingv1.CancelOrderResponse, error) {
	s.mu.Lock()
	order, ok := s.orders[req.OrderId]
	s.mu.Unlock()
	if !ok {
		// Fall back to DB lookup.
		var err error
		order, err = s.repo.GetOrder(ctx, req.OrderId)
		if err != nil || order == nil {
			return nil, fmt.Errorf("order %s not found", req.OrderId)
		}
		s.mu.Lock()
		s.orders[order.OrderId] = order
		s.mu.Unlock()
	}

	// Guard A (feature 159): an offline order is manual bookkeeping — it never reaches a broker, so
	// CancelOrder must not flip it to CANCELED (the local transition below is otherwise unconditional).
	// Offline orders are un-placed by ConfirmOrder edits, not a broker cancel. Keyed on the authoritative
	// persisted order.BrokerType (GetOrder already selects broker_type), not an empty broker_order_id — a
	// broker order that has not yet received its broker_order_id also has an empty one and must stay
	// cancelable (the broker-cancel branch below already gates on a non-empty id).
	if order.BrokerType == commonv1.BrokerType_BROKER_TYPE_OFFLINE {
		return nil, grpcstatus.Errorf(codes.FailedPrecondition,
			"offline order %s is managed via ConfirmOrder, not broker cancel", req.OrderId)
	}

	// Dedup insert (feature 101): server-derived intent ID (a content-identical cancel
	// on the same order is safe to collapse — no client nonce needed).
	intentID, requestHashHex, err := deriveReplaceCancelIntentID(req)
	if err != nil {
		return nil, grpcstatus.Errorf(codes.Internal, "derive order intent: %v", err)
	}
	ok2, err := s.orderIntentRepo.InsertIntent(ctx, &repository.OrderIntentRecord{
		IntentID: intentID, OrderID: req.OrderId, RequestHash: requestHashHex,
		BrokerAccountID: order.AccountId,
	})
	if err != nil {
		return nil, grpcstatus.Errorf(codes.Internal, "insert order intent: %v", err)
	}
	if !ok2 {
		existing, getErr := s.orderIntentRepo.GetIntentByID(ctx, intentID)
		if getErr != nil || existing == nil {
			return nil, grpcstatus.Errorf(codes.Internal, "load existing order intent: %v", getErr)
		}
		action, isStale := classifyIntentLookup(existing, requestHashHex, time.Now(), staleThreshold(s.cfgW))
		switch action {
		case intentActionRejectHashMismatch:
			return nil, grpcstatus.Errorf(codes.FailedPrecondition,
				"cancel on order %s was already attempted with different content", req.OrderId)
		case intentActionReturnStored:
			var stored tradingv1.Order
			if err := proto.Unmarshal(existing.LatestResponse, &stored); err != nil {
				return nil, grpcstatus.Errorf(codes.Internal, "unmarshal stored intent response: %v", err)
			}
			return &tradingv1.CancelOrderResponse{Success: true, Order: &stored}, nil
		case intentActionRejectUnknown:
			return nil, grpcstatus.Errorf(codes.FailedPrecondition,
				"cancel intent for order %s outcome is unknown; verify with the broker before retrying", req.OrderId)
		default: // intentActionRejectPending
			if isStale {
				_, _, _ = s.orderIntentRepo.ReclaimOrphanIntent(ctx, intentID, existing.UpdatedAt.Add(staleThreshold(s.cfgW)))
			}
			return nil, grpcstatus.Errorf(codes.FailedPrecondition,
				"cancel on order %s is still pending", req.OrderId)
		}
	}
	order.IntentState = tradingv1.IntentState_INTENT_STATE_PENDING

	// Cancel at broker if we have a broker order ID. This branch's existing fail-open
	// behavior (log-only, cancellation proceeds locally regardless) is deliberately
	// UNCHANGED by this feature — "mark canceled locally regardless of broker response"
	// is a distinct, pre-existing decision (design.md § Cross-intent precedence).
	finalIntentState := repository.IntentStateCompleted
	var resolvedEntry brokerPoolEntry
	var haveEntry bool
	if order.BrokerOrderId != "" {
		_, entry, resolveErr := s.resolveAccount(order.AccountId)
		if resolveErr != nil {
			slog.Warn("cancel: could not resolve broker account", "order_id", req.OrderId, "account_id", order.AccountId, "error", resolveErr)
			// A broker-call failure doesn't support the certainty CONFIRMED (Completed)
			// would assert — the cancel intent goes to UNKNOWN, not CONFIRMED (design.md).
			finalIntentState = repository.IntentStateUnknown
		} else {
			resolvedEntry, haveEntry = entry, true
			if err := entry.client.CancelOrder(ctx, order.BrokerOrderId); err != nil {
				slog.Warn("broker cancel failed", "order_id", req.OrderId, "broker_order_id", order.BrokerOrderId, "error", err)
				// Continue with internal cancellation — broker may have already filled/canceled.
				finalIntentState = repository.IntentStateUnknown
			}
		}
	}

	// Bracket-leg cancellation on signal-driven close (feature 030, OQ-2): best-effort
	// — log failures, never block the close. Cancelling an already-filled leg is a
	// broker no-op (Alpaca returns 422 for an already-filled order, already tolerated
	// above); pollFills detecting a leg fill on an already-CANCELED bracket row is
	// likewise a no-op (maybeSubmitBracket's own status-branch guard).
	if haveEntry {
		if bracket, bErr := s.bracketRepo.GetBracketByOrderID(ctx, req.OrderId); bErr != nil {
			slog.Warn("cancel: bracket lookup failed", "order_id", req.OrderId, "error", bErr)
		} else if bracket != nil && bracket.Status == bracketStatusActive {
			if bracket.StopLegOrderID != "" {
				if err := resolvedEntry.client.CancelOrder(ctx, bracket.StopLegOrderID); err != nil {
					slog.Warn("cancel: bracket stop leg cancel failed", "order_id", req.OrderId, "leg_id", bracket.StopLegOrderID, "error", err)
				}
			}
			if bracket.TakeProfitLegOrderID != "" {
				if err := resolvedEntry.client.CancelOrder(ctx, bracket.TakeProfitLegOrderID); err != nil {
					slog.Warn("cancel: bracket take-profit leg cancel failed", "order_id", req.OrderId, "leg_id", bracket.TakeProfitLegOrderID, "error", err)
				}
			}
			if uErr := s.bracketRepo.UpdateBracketStatus(ctx, bracket.ID, bracketStatusCanceled, bracket.StopLegOrderID, bracket.TakeProfitLegOrderID, ""); uErr != nil {
				slog.Warn("cancel: update bracket status failed", "order_id", req.OrderId, "error", uErr)
			}
			go s.emitLedgerEvent(context.Background(), "order.bracket_updated", req.OrderId, bracketUpdatedPayload(order, "", ""))
		}
	}

	order.Status = tradingv1.OrderStatus_ORDER_STATUS_CANCELED
	order.UpdatedAt = timestamppb.New(time.Now())
	if finalIntentState == repository.IntentStateUnknown {
		order.IntentState = tradingv1.IntentState_INTENT_STATE_UNKNOWN
	} else {
		order.IntentState = tradingv1.IntentState_INTENT_STATE_COMPLETED
	}

	_ = s.repo.UpsertOrder(ctx, order)
	if marshaled, mErr := proto.Marshal(order); mErr == nil {
		if fErr := s.orderIntentRepo.FinalizeIntent(context.Background(), intentID, req.OrderId, finalIntentState, marshaled); fErr != nil {
			slog.Warn("finalize cancel intent failed", "intent_id", intentID, "error", fErr)
		}
	}

	go s.emitLedgerEvent(context.Background(), "order.canceled", req.OrderId, map[string]interface{}{
		"order_id": req.OrderId, "user_id": middleware.FromContext(ctx).UserID,
	})
	s.broadcastOrder(order)

	return &tradingv1.CancelOrderResponse{Success: true, Order: order}, nil
}

// ReplaceOrder modifies a working order's qty/price/TIF at the broker. It is
// broker-agnostic: resolveAccount routes by the order's account/broker_type so both
// Alpaca and IBKR are covered. Only NEW / PARTIALLY_FILLED orders may be replaced (FR-8);
// the per-account broker client's IsPaper()/baseURL() preserves the paper-only dev invariant.
func (s *TradingService) ReplaceOrder(ctx context.Context, req *tradingv1.ReplaceOrderRequest) (*tradingv1.Order, error) {
	s.mu.Lock()
	order, ok := s.orders[req.OrderId]
	s.mu.Unlock()
	if !ok {
		// Fall back to DB lookup.
		var err error
		order, err = s.repo.GetOrder(ctx, req.OrderId)
		if err != nil || order == nil {
			return nil, grpcstatus.Errorf(codes.NotFound, "order %s not found", req.OrderId)
		}
		s.mu.Lock()
		s.orders[order.OrderId] = order
		s.mu.Unlock()
	}

	// Fill-state gate (FR-8): only NEW / PARTIALLY_FILLED may be replaced. A
	// PARTIALLY_FILLED replace adjusts the remaining qty — req.Qty is passed straight
	// through; Alpaca/IBKR interpret it as the new total per their adapter.
	switch order.Status {
	case tradingv1.OrderStatus_ORDER_STATUS_NEW, tradingv1.OrderStatus_ORDER_STATUS_PARTIALLY_FILLED:
		// replaceable
	default:
		return nil, grpcstatus.Errorf(codes.FailedPrecondition,
			"order %s is not replaceable in status %s", req.OrderId, order.Status)
	}

	// Persisted per-account automated halt (feature 030) — identical gate to
	// PlaceOrder's, no reduce-only carve-out (design.md's explicit rejection: no such
	// precedent exists anywhere in this service). Placed ahead of the trading_state
	// gate below (order.AccountId is already known from the persisted order — no need
	// to wait for resolveAccount).
	if s.isAccountHalted(order.AccountId) {
		return nil, grpcstatus.Errorf(codes.FailedPrecondition, "account is halted: %s", s.haltReason(order.AccountId))
	}

	// platform.trading_state gate (feature 100): mirrors PlaceOrder's gate — HALTED
	// blocks outright; REDUCE_ONLY blocks only size-increasing replaces.
	if err := s.checkTradingStateForReplace(order, req); err != nil {
		return nil, err
	}

	if order.BrokerOrderId == "" {
		return nil, grpcstatus.Errorf(codes.FailedPrecondition,
			"order %s has no broker order id yet; cannot replace", req.OrderId)
	}

	_, entry, err := s.resolveAccount(order.AccountId)
	if err != nil {
		return nil, err
	}

	// Dedup insert (feature 101): server-derived intent ID (a content-identical replace
	// on the same order is safe to collapse — no client nonce needed, unlike PlaceOrder).
	intentID, requestHashHex, err := deriveReplaceCancelIntentID(req)
	if err != nil {
		return nil, grpcstatus.Errorf(codes.Internal, "derive order intent: %v", err)
	}
	ownsIntent := true
	ok2, err := s.orderIntentRepo.InsertIntent(ctx, &repository.OrderIntentRecord{
		IntentID: intentID, OrderID: req.OrderId, RequestHash: requestHashHex,
		BrokerAccountID: order.AccountId,
	})
	if err != nil {
		return nil, grpcstatus.Errorf(codes.Internal, "insert order intent: %v", err)
	}
	if !ok2 {
		existing, getErr := s.orderIntentRepo.GetIntentByID(ctx, intentID)
		if getErr != nil || existing == nil {
			return nil, grpcstatus.Errorf(codes.Internal, "load existing order intent: %v", getErr)
		}
		action, isStale := classifyIntentLookup(existing, requestHashHex, time.Now(), staleThreshold(s.cfgW))
		switch action {
		case intentActionRejectHashMismatch:
			return nil, grpcstatus.Errorf(codes.FailedPrecondition,
				"replace on order %s was already attempted with different content", req.OrderId)
		case intentActionReturnStored:
			var stored tradingv1.Order
			if err := proto.Unmarshal(existing.LatestResponse, &stored); err != nil {
				return nil, grpcstatus.Errorf(codes.Internal, "unmarshal stored intent response: %v", err)
			}
			return &stored, nil
		case intentActionRejectUnknown:
			return nil, grpcstatus.Errorf(codes.FailedPrecondition,
				"replace intent for order %s outcome is unknown; verify with the broker before retrying", req.OrderId)
		default: // intentActionRejectPending
			if isStale {
				_, _, _ = s.orderIntentRepo.ReclaimOrphanIntent(ctx, intentID, existing.UpdatedAt.Add(staleThreshold(s.cfgW)))
			}
			return nil, grpcstatus.Errorf(codes.FailedPrecondition,
				"replace on order %s is still pending", req.OrderId)
		}
	}
	order.IntentState = tradingv1.IntentState_INTENT_STATE_PENDING

	// Only the changed fields are sent to the broker (zero/empty = leave unchanged).
	brokerReq := broker.OrderRequest{
		Qty:         req.Qty,
		LimitPrice:  req.LimitPrice,
		StopPrice:   req.StopPrice,
		Trail:       req.Trail,
		TimeInForce: req.TimeInForce,
	}
	if _, replaceErr := entry.client.ReplaceOrder(ctx, order.BrokerOrderId, brokerReq); replaceErr != nil {
		var netErr net.Error
		isTimeout := errors.Is(replaceErr, context.DeadlineExceeded) || (errors.As(replaceErr, &netErr) && netErr.Timeout())
		if !isTimeout && ownsIntent {
			if marshaled, mErr := proto.Marshal(order); mErr == nil {
				if fErr := s.orderIntentRepo.FinalizeIntent(context.Background(), intentID, req.OrderId, repository.IntentStateRejected, marshaled); fErr != nil {
					slog.Warn("finalize replace intent (rejected) failed", "intent_id", intentID, "error", fErr)
				}
			}
		}
		// Timeout leaves the intent PENDING for reclaim — existing codes.Internal error
		// returned unchanged either way (this branch's RPC-level behavior is preserved).
		return nil, grpcstatus.Errorf(codes.Internal, "broker replace failed: %v", replaceErr)
	}

	if req.Qty != 0 {
		order.Qty = req.Qty
	}
	if req.LimitPrice != 0 {
		order.LimitPrice = req.LimitPrice
	}
	if req.StopPrice != 0 {
		order.StopPrice = req.StopPrice
	}
	if req.TimeInForce != "" {
		order.TimeInForce = req.TimeInForce
	}
	order.UpdatedAt = timestamppb.New(time.Now())
	order.IntentState = tradingv1.IntentState_INTENT_STATE_COMPLETED

	_ = s.repo.UpsertOrder(ctx, order)
	if ownsIntent {
		if marshaled, mErr := proto.Marshal(order); mErr == nil {
			if fErr := s.orderIntentRepo.FinalizeIntent(context.Background(), intentID, req.OrderId, repository.IntentStateCompleted, marshaled); fErr != nil {
				slog.Warn("finalize replace intent (completed) failed", "intent_id", intentID, "error", fErr)
			}
		}
	}

	go s.emitLedgerEvent(context.Background(), "order.replaced", req.OrderId, map[string]interface{}{
		"order_id": req.OrderId, "user_id": middleware.FromContext(ctx).UserID,
	})
	s.broadcastOrder(order)

	return order, nil
}

func (s *TradingService) GetOrder(ctx context.Context, req *tradingv1.GetOrderRequest) (*tradingv1.Order, error) {
	s.mu.Lock()
	order, ok := s.orders[req.OrderId]
	s.mu.Unlock()
	if ok {
		normalizeFilledQty(order)
		return order, nil
	}
	// Fall back to DB.
	order, err := s.repo.GetOrder(ctx, req.OrderId)
	if err != nil || order == nil {
		return nil, fmt.Errorf("order %s not found", req.OrderId)
	}
	normalizeFilledQty(order)
	return order, nil
}

func (s *TradingService) ListOrders(ctx context.Context, req *tradingv1.ListOrdersRequest) (*tradingv1.ListOrdersResponse, error) {
	orders, err := s.repo.ListOrders(ctx, req.UserId, req.Status, req.TradingMode, req.StrategyId, req.Symbol, req.Side, req.OrderType, req.AccountId, req.Range)
	if err != nil {
		slog.Warn("db list orders failed, falling back to in-memory", "error", err)
		var mem []*tradingv1.Order
		s.mu.Lock()
		for _, o := range s.orders {
			if req.UserId != "" && o.UserId != req.UserId {
				continue
			}
			if req.Status != tradingv1.OrderStatus_ORDER_STATUS_UNSPECIFIED && o.Status != req.Status {
				continue
			}
			if req.TradingMode != commonv1.TradingMode_TRADING_MODE_UNSPECIFIED && o.TradingMode != req.TradingMode {
				continue
			}
			if req.Symbol != "" && o.Symbol != req.Symbol {
				continue
			}
			if req.Side != tradingv1.OrderSide_ORDER_SIDE_UNSPECIFIED && o.Side != req.Side {
				continue
			}
			if req.OrderType != tradingv1.OrderType_ORDER_TYPE_UNSPECIFIED && o.OrderType != req.OrderType {
				continue
			}
			if req.AccountId != "" && o.AccountId != req.AccountId {
				continue
			}
			if req.Range != nil && o.CreatedAt != nil {
				ct := o.CreatedAt.AsTime()
				if req.Range.Start != nil && ct.Before(req.Range.Start.AsTime()) {
					continue
				}
				if req.Range.End != nil && ct.After(req.Range.End.AsTime()) {
					continue
				}
			}
			mem = append(mem, o)
		}
		s.mu.Unlock()
		for _, o := range mem {
			normalizeFilledQty(o)
		}
		page, pageResp := paginateOrders(mem, req.Page)
		return &tradingv1.ListOrdersResponse{Orders: page, Page: pageResp}, nil
	}
	for _, o := range orders {
		normalizeFilledQty(o)
	}
	page, pageResp := paginateOrders(orders, req.Page)
	return &tradingv1.ListOrdersResponse{Orders: page, Page: pageResp}, nil
}

// paginateOrders applies PageRequest windowing to an already-sorted order slice.
// PageToken is an opaque numeric offset (empty = first page); the response carries
// the total match count and the next offset token when more rows remain. A zero/absent
// PageSize disables windowing and returns the full slice.
func paginateOrders(all []*tradingv1.Order, page *commonv1.PageRequest) ([]*tradingv1.Order, *commonv1.PageResponse) {
	total := int32(len(all))
	if page == nil || page.PageSize <= 0 {
		return all, &commonv1.PageResponse{TotalCount: total}
	}
	offset := 0
	if page.PageToken != "" {
		if n, convErr := strconv.Atoi(page.PageToken); convErr == nil && n > 0 {
			offset = n
		}
	}
	if offset >= len(all) {
		return []*tradingv1.Order{}, &commonv1.PageResponse{TotalCount: total}
	}
	end := offset + int(page.PageSize)
	nextToken := ""
	if end < len(all) {
		nextToken = strconv.Itoa(end)
	} else {
		end = len(all)
	}
	return all[offset:end], &commonv1.PageResponse{TotalCount: total, NextPageToken: nextToken}
}

func (s *TradingService) StreamOrderUpdates(req *tradingv1.StreamOrderUpdatesRequest, stream tradingv1.TradingService_StreamOrderUpdatesServer) error {
	// Send current snapshot of matching orders.
	s.mu.Lock()
	snapshot := make([]*tradingv1.Order, 0)
	for _, order := range s.orders {
		if req.UserId != "" && order.UserId != req.UserId {
			continue
		}
		snapshot = append(snapshot, order)
	}
	s.mu.Unlock()

	for _, order := range snapshot {
		if err := stream.Send(order); err != nil {
			return err
		}
	}

	<-stream.Context().Done()
	return nil
}

// StartFillPoller polls submitted broker orders to detect fills.
// Interval is read from the live config key `trading.fill_poller.interval_ms`
// (default 5000 ms) so it can be adjusted without restarting the service.
func (s *TradingService) StartFillPoller(ctx context.Context) {
	const defaultIntervalMs = 5000.0
	currentInterval := time.Duration(defaultIntervalMs) * time.Millisecond
	ticker := time.NewTicker(currentInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.pollFills(ctx)
			intervalMs := s.cfgW.GetFloat("trading.fill_poller.interval_ms", defaultIntervalMs)
			if intervalMs > 0 {
				newInterval := time.Duration(intervalMs) * time.Millisecond
				if newInterval != currentInterval {
					currentInterval = newInterval
					ticker.Reset(currentInterval)
				}
			}
		}
	}
}

func (s *TradingService) pollFills(ctx context.Context) {
	// Snapshot the broker pool under read lock. Offline accounts (feature 157) have a nil client
	// and never reach a broker, so skip them — a fill is only ever confirmed via ConfirmOrder.
	s.brokersMu.RLock()
	brokerMap := make(map[string]brokerPoolEntry, len(s.brokers))
	for id, e := range s.brokers {
		if e.brokerType == int32(commonv1.BrokerType_BROKER_TYPE_OFFLINE) {
			continue
		}
		brokerMap[id] = e
	}
	s.brokersMu.RUnlock()

	// Collect in-flight orders from in-memory map.
	s.mu.Lock()
	candidates := make([]*tradingv1.Order, 0)
	for _, o := range s.orders {
		if o.BrokerOrderId == "" {
			continue
		}
		if o.Status == tradingv1.OrderStatus_ORDER_STATUS_FILLED ||
			o.Status == tradingv1.OrderStatus_ORDER_STATUS_CANCELED ||
			o.Status == tradingv1.OrderStatus_ORDER_STATUS_REJECTED ||
			o.Status == tradingv1.OrderStatus_ORDER_STATUS_EXPIRED {
			continue
		}
		candidates = append(candidates, o)
	}
	s.mu.Unlock()

	for _, order := range candidates {
		// Resolve the broker for this order's account.
		entry, ok := brokerMap[order.AccountId]
		if !ok {
			// Fallback: use sole account if pool has exactly one.
			if len(brokerMap) == 1 {
				for _, e := range brokerMap {
					entry = e
					ok = true
					break
				}
			}
		}
		if !ok {
			slog.Warn("fill poll: no broker for account", "order_id", order.OrderId, "account_id", order.AccountId)
			continue
		}

		brokerOrder, err := entry.client.GetOrder(ctx, order.BrokerOrderId)
		if err != nil {
			slog.Warn("fill poll: broker GetOrder failed", "order_id", order.OrderId, "error", err)
			continue
		}

		newStatus := alpacaStatusToProto(brokerOrder.Status)
		// A transient ("done_for_day") or unrecognized broker status maps to UNSPECIFIED;
		// don't overwrite the order's real status with it (that would both lose the current
		// status and, if it were terminal, stop reconciliation) — keep polling so the order
		// converges to its true terminal state on a later cycle.
		if newStatus == tradingv1.OrderStatus_ORDER_STATUS_UNSPECIFIED {
			continue
		}
		// A same-status repeat is normally a no-op poll tick — except a repeated
		// PARTIALLY_FILLED with a larger FilledQty (feature 030: a second partial fill
		// on the same order), which must still be processed so an ACTIVE IBKR bracket
		// gets resized on every fill delta, not just the first.
		if newStatus == order.Status && order.FilledQty == brokerOrder.FilledQty {
			continue
		}

		order.Status = newStatus
		order.UpdatedAt = timestamppb.New(time.Now())
		order.FilledAvgPrice = brokerOrder.FilledAvgPrice
		order.FilledQty = brokerOrder.FilledQty
		// A fully-filled order always has filled qty == order qty, even if the
		// broker omitted the figure from its response.
		if newStatus == tradingv1.OrderStatus_ORDER_STATUS_FILLED && order.FilledQty == 0 {
			order.FilledQty = order.Qty
		}

		if err := s.repo.UpsertOrder(ctx, order); err != nil {
			slog.Warn("fill poll: db upsert failed", "order_id", order.OrderId, "error", err)
		}

		s.broadcastOrder(order)

		switch newStatus {
		case tradingv1.OrderStatus_ORDER_STATUS_FILLED:
			go s.emitLedgerEvent(context.Background(), "order.filled", order.OrderId, map[string]interface{}{
				"order_id": order.OrderId, "symbol": order.Symbol,
				"qty": order.Qty, "fill_price": order.FilledAvgPrice,
				"user_id": order.UserId, "trading_mode": order.TradingMode.String(),
				"account_id": order.AccountId,
			})
			go s.emitFillAlert(context.Background(), order)
			slog.Info("order filled", "order_id", order.OrderId, "symbol", order.Symbol,
				"qty", order.Qty, "fill_price", order.FilledAvgPrice)
			// Fill detected asynchronously (feature 030) — order.StopPrice is only ever
			// nonzero here for an auto-sized MARKET/LIMIT entry (023's construction); a
			// no-op for every other order (see maybeSubmitBracket's own guard).
			s.maybeSubmitBracket(context.Background(), order, entry, brokerOrder, order.StopPrice, order.FilledAvgPrice,
				s.cfgW.GetBool("trading.risk.bracket_orders_enabled", true))

		case tradingv1.OrderStatus_ORDER_STATUS_PARTIALLY_FILLED:
			go s.emitLedgerEvent(context.Background(), "order.partially_filled", order.OrderId, map[string]interface{}{
				"order_id": order.OrderId, "symbol": order.Symbol,
				"filled_qty": order.FilledQty, "fill_price": order.FilledAvgPrice,
				"user_id": order.UserId, "trading_mode": order.TradingMode.String(),
				"account_id": order.AccountId,
			})
			// First partial fill creates the bracket; a later partial fill on an
			// already-ACTIVE IBKR bracket resizes it (maybeSubmitBracket's own dispatch).
			s.maybeSubmitBracket(context.Background(), order, entry, brokerOrder, order.StopPrice, order.FilledAvgPrice,
				s.cfgW.GetBool("trading.risk.bracket_orders_enabled", true))

		case tradingv1.OrderStatus_ORDER_STATUS_CANCELED:
			go s.emitLedgerEvent(context.Background(), "order.canceled", order.OrderId, map[string]interface{}{
				"order_id": order.OrderId, "symbol": order.Symbol,
			})

		case tradingv1.OrderStatus_ORDER_STATUS_REJECTED:
			go s.emitLedgerEvent(context.Background(), "order.rejected", order.OrderId, map[string]interface{}{
				"order_id": order.OrderId, "symbol": order.Symbol,
			})
		}
	}
}

// Mismatch classes emitted on reconciliation.mismatch_found (feature 102). An internal
// ledger-payload string tag, not a wire/proto type — the taxonomy is closed within this
// feature's own scope.
const (
	mismatchClassUnknownBrokerOrder  = "unknown_broker_order"
	mismatchClassQuantityDiscrepancy = "quantity_discrepancy"
	mismatchClassMissingBrokerOrder  = "missing_broker_order"
)

// isTerminalOrderStatus mirrors pollFills' own terminal-status set (see its candidate
// collection above).
func isTerminalOrderStatus(status tradingv1.OrderStatus) bool {
	switch status {
	case tradingv1.OrderStatus_ORDER_STATUS_FILLED,
		tradingv1.OrderStatus_ORDER_STATUS_CANCELED,
		tradingv1.OrderStatus_ORDER_STATUS_REJECTED,
		tradingv1.OrderStatus_ORDER_STATUS_EXPIRED:
		return true
	}
	return false
}

// StartReconciliationPoller periodically compares open orders/positions against broker truth
// (feature 102 — broker-state-reconciliation). Mirrors StartFillPoller's exact
// ticker+ctx.Done()+live-config-reread shape.
func (s *TradingService) StartReconciliationPoller(ctx context.Context) {
	const defaultIntervalMs = 60000.0
	currentInterval := time.Duration(defaultIntervalMs) * time.Millisecond
	ticker := time.NewTicker(currentInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.reconcileTick(ctx, int(s.cfgW.GetInt("trading.reconciliation.grace_ticks", 1)),
				s.cfgW.GetFloat("trading.reconciliation.systemic_threshold_pct", 0.5))
			intervalMs := s.cfgW.GetFloat("trading.reconciliation.interval_ms", defaultIntervalMs)
			if intervalMs > 0 {
				newInterval := time.Duration(intervalMs) * time.Millisecond
				if newInterval != currentInterval {
					currentInterval = newInterval
					ticker.Reset(currentInterval)
				}
			}
		}
	}
}

// recordReconciliationCandidate increments the consecutive-tick counter for a candidate
// mismatch and reports whether it has now crossed the grace window (1+graceTicks
// observations) and become a real finding. A real finding is cleared immediately, so a
// persisting mismatch starts a fresh episode on its next occurrence rather than re-firing
// every tick indefinitely.
func (s *TradingService) recordReconciliationCandidate(key string, graceTicks int) bool {
	s.reconcileCandidatesMu.Lock()
	defer s.reconcileCandidatesMu.Unlock()
	s.reconcileCandidates[key]++
	if s.reconcileCandidates[key] >= 1+graceTicks {
		delete(s.reconcileCandidates, key)
		return true
	}
	return false
}

// clearReconciliationCandidate drops a candidate no longer observed this tick — the
// propagation delay passed and the mismatch resolved on its own (self-heal; no ledger event,
// no halt, per design.md).
func (s *TradingService) clearReconciliationCandidate(key string) {
	s.reconcileCandidatesMu.Lock()
	delete(s.reconcileCandidates, key)
	s.reconcileCandidatesMu.Unlock()
}

// emitReconciliationFinding records a real (past-grace-window) mismatch: a ledger event, a
// CRITICAL alert, and the ordinary per-account halt (feature 030's mechanism, reused — no
// SetConfig/authz call for this common case; that is Step 19's rare systemic escalation).
//
// No-ops once the account is already halted: isAccountHalted already gates PlaceOrder/
// ReplaceOrder for every halt source, so a later finding against an already-halted account
// changes no trading behavior — only a human clearing the halt (a manual DB edit; nothing in
// this service ever un-halts) can resume it. Without this guard, an account with a handful of
// pre-existing broker orders the poller can never learn about (see LoadInflightOrders, which
// only hydrates NEW/PARTIALLY_FILLED orders) re-triggers this full sequence — ledger event,
// CRITICAL alert, ERROR log — every reconciliation tick, forever, for the same orders.
func (s *TradingService) emitReconciliationFinding(ctx context.Context, accountID, mismatchClass, orderID string, expected, brokerReported float64) {
	if s.isAccountHalted(accountID) {
		return
	}
	s.emitLedgerEvent(ctx, "reconciliation.mismatch_found", fmt.Sprintf("account:%s", accountID), map[string]interface{}{
		"mismatch_class":  mismatchClass,
		"order_id":        orderID,
		"expected":        expected,
		"broker_reported": brokerReported,
		"tick_at":         time.Now().UnixMilli(),
	})
	s.haltAccount(ctx, accountID, fmt.Sprintf("%s: %s", mismatchClass, orderID), int32(tradingv1.HaltSource_HALT_SOURCE_RECONCILIATION))
	_, err := s.notify.EmitAlert(ctx, &notifyv1.EmitAlertRequest{
		Severity:      notifyv1.AlertSeverity_ALERT_SEVERITY_CRITICAL,
		Category:      "reconciliation",
		Title:         fmt.Sprintf("Broker state mismatch: %s", mismatchClass),
		Body:          fmt.Sprintf("Account %s: %s (%s) — expected %.4f, broker reported %.4f", accountID, mismatchClass, orderID, expected, brokerReported),
		SourceService: "xstockstrat-trading",
	})
	if err != nil {
		slog.Warn("reconciliation: emit alert failed", "account_id", accountID, "mismatch_class", mismatchClass, "error", err)
	}
}

// reconcileTick compares each registered account's open orders and positions against broker
// truth (feature 102). Returns the number of accounts that errored this tick (systemicCount)
// out of the total registered accounts (totalAccounts) — Step 19's systemic-escalation trigger
// reads these.
//
// Deviation from design.md's literal "Qty - FilledQty on both sides" plan: broker.BrokerOrder
// (the ListOrders/GetOrder result shape) carries only a cumulative FilledQty, not a total
// order Qty — there is nothing to derive a broker-side "remaining" quantity from. The
// quantity-discrepancy check below compares FilledQty directly (platform vs. broker-reported),
// the only remaining-quantity-adjacent figure ListOrders actually returns.
//
// The "unprotected/impossible" bucket (an order/position under an account ID not present in
// s.brokers at all) is not implemented: every Broker client is constructed scoped to one
// account's own credentials (ibkrAccountID / the Alpaca key pair), so a ListOrders/GetPositions
// call can only ever return records for that same account — there is no code path by which a
// call scoped to account A could surface a record under a different, unregistered account B.
// This bucket is architecturally unreachable given this feature's broker-client design, not a
// skipped implementation; a genuine per-step finding, not a silent gap.
// graceTicks is hoisted as an explicit parameter (not read live via s.cfgW inside this
// function) — config.Watcher has no exported snapshot setter (an established limitation in
// this service; see 030/023/101's own identical hoisting of a config-read value for the same
// reason), so a live read here would make the "grace window not yet crossed" test case
// untestable against a hand-constructed service. The one real caller (StartReconciliationPoller)
// still reads the live config value and passes it in.
func (s *TradingService) reconcileTick(ctx context.Context, graceTicks int, systemicThresholdPct float64) (systemicCount, totalAccounts int) {
	s.brokersMu.RLock()
	brokerMap := make(map[string]brokerPoolEntry, len(s.brokers))
	for id, e := range s.brokers {
		// Offline accounts (feature 157) have no broker to reconcile against — skip them.
		if e.brokerType == int32(commonv1.BrokerType_BROKER_TYPE_OFFLINE) {
			continue
		}
		brokerMap[id] = e
	}
	s.brokersMu.RUnlock()

	s.credStatusMu.Lock()
	credStatus := make(map[string]int32, len(s.credStatus))
	for id, st := range s.credStatus {
		credStatus[id] = st
	}
	s.credStatusMu.Unlock()

	timeout := s.brokerCallTimeout()
	totalAccounts = len(brokerMap)

	for accountID, entry := range brokerMap {
		if credentialsKnownInvalid(credStatus[accountID]) {
			continue
		}
		// An already-halted account can't place new orders regardless of what this tick
		// finds (isAccountHalted gates PlaceOrder/ReplaceOrder), so poll it at a slower,
		// configurable cadence instead of the ordinary tick rate — cuts needless broker API
		// load while still eventually noticing broker-side drift on it.
		if s.isAccountHalted(accountID) && !s.shouldPollHaltedAccount(accountID, s.haltedPollInterval()) {
			continue
		}

		listCtx, cancel := context.WithTimeout(ctx, timeout)
		brokerOrders, err := entry.client.ListOrders(listCtx)
		cancel()
		if err != nil {
			slog.Warn("reconcileTick: ListOrders failed", "account_id", accountID, "error", err)
			systemicCount++
			continue
		}
		brokerByID := make(map[string]broker.BrokerOrder, len(brokerOrders))
		for _, bo := range brokerOrders {
			brokerByID[bo.BrokerOrderID] = bo
		}

		s.mu.Lock()
		var acctOrders []*tradingv1.Order
		for _, o := range s.orders {
			if o.AccountId == accountID && o.BrokerOrderId != "" {
				acctOrders = append(acctOrders, o)
			}
		}
		s.mu.Unlock()

		knownBrokerIDs := make(map[string]bool, len(acctOrders))
		for _, o := range acctOrders {
			knownBrokerIDs[o.BrokerOrderId] = true
			bo, found := brokerByID[o.BrokerOrderId]
			if !found {
				if isTerminalOrderStatus(o.Status) {
					continue // already reconciled to a terminal state; not a live mismatch
				}
				key := accountID + ":order:" + o.OrderId
				if s.recordReconciliationCandidate(key, graceTicks) {
					s.emitReconciliationFinding(ctx, accountID, mismatchClassMissingBrokerOrder, o.OrderId, o.Qty-o.FilledQty, 0)
				}
				continue
			}
			// A quantity discrepancy is a genuine post-grace-window disagreement, never a
			// bare PARTIALLY_FILLED status alone (FR-2) — the grace window below is exactly
			// that carve-out: a fresh disagreement must persist across ticks before it counts.
			key := accountID + ":order:" + o.OrderId
			if bo.FilledQty != o.FilledQty {
				if s.recordReconciliationCandidate(key, graceTicks) {
					s.emitReconciliationFinding(ctx, accountID, mismatchClassQuantityDiscrepancy, o.OrderId, o.FilledQty, bo.FilledQty)
				}
			} else {
				s.clearReconciliationCandidate(key)
			}
		}
		for boID, bo := range brokerByID {
			if knownBrokerIDs[boID] {
				continue
			}
			// An order the broker knows about that the platform has no record of at all —
			// detected regardless of fill state (AC-1), the primary reason ListOrders exists.
			key := accountID + ":order:" + boID
			if s.recordReconciliationCandidate(key, graceTicks) {
				s.emitReconciliationFinding(ctx, accountID, mismatchClassUnknownBrokerOrder, boID, 0, bo.FilledQty)
			}
		}

		// Position-side comparison: catches a fully FILLED order's resulting position
		// disagreeing with the broker's own position — FILLED orders already dropped out of
		// the order-side loop above (the same terminal-status convention pollFills uses).
		posCtx, posCancel := context.WithTimeout(ctx, timeout)
		brokerPositions, posErr := entry.client.GetPositions(posCtx)
		posCancel()
		if posErr != nil {
			slog.Warn("reconcileTick: GetPositions failed", "account_id", accountID, "error", posErr)
			systemicCount++
			continue
		}
		tradingMode := commonv1.TradingMode_TRADING_MODE_PAPER
		if !entry.client.IsPaper() {
			tradingMode = commonv1.TradingMode_TRADING_MODE_LIVE
		}
		listPosCtx, listPosCancel := context.WithTimeout(ctx, timeout)
		// Identity travels in the x-user-id header (portfolio resolves the caller from it); this
		// background poller has no inbound header, so inject the account owner explicitly.
		listPosCtx = metadata.AppendToOutgoingContext(listPosCtx, "x-user-id", entry.userID)
		platformPositions, ppErr := s.portfolio.ListPositions(listPosCtx, &portfoliov1.ListPositionsRequest{
			AccountId: &accountID, TradingMode: tradingMode,
			Page: &commonv1.PageRequest{PageSize: 500},
		})
		listPosCancel()
		if ppErr != nil {
			slog.Warn("reconcileTick: portfolio ListPositions failed", "account_id", accountID, "error", ppErr)
			continue // not counted toward systemic — the broker side of this account is fine
		}
		platformBySymbol := make(map[string]float64, len(platformPositions.Positions))
		for _, p := range platformPositions.Positions {
			platformBySymbol[p.Symbol] = p.Qty
		}
		for _, bp := range brokerPositions {
			key := accountID + ":pos:" + bp.Symbol
			platformQty := platformBySymbol[bp.Symbol]
			if platformQty != bp.Quantity {
				if s.recordReconciliationCandidate(key, graceTicks) {
					s.emitReconciliationFinding(ctx, accountID, mismatchClassQuantityDiscrepancy, bp.Symbol, platformQty, bp.Quantity)
				}
			} else {
				s.clearReconciliationCandidate(key)
			}
		}

		// FR-6: resolve 101's own deferred "who resolves an UNKNOWN order intent" question,
		// reusing this tick's already-fetched ListOrders result (brokerOrders) — not a second
		// broker round-trip.
		s.resolveUnknownIntents(ctx, accountID, entry, brokerOrders)
	}

	// Rare, genuinely systemic finding: half or more (default threshold) of registered
	// accounts errored/unreachable this tick — escalate platform-wide via the internal-caller
	// authz channel (Steps 4-8), rather than routing through 030's per-account halt (Step 17's
	// ordinary path above). Never called for an ordinary per-account finding.
	if totalAccounts > 0 && float64(systemicCount)/float64(totalAccounts) >= systemicThresholdPct {
		s.escalateSystemic(ctx, systemicCount, totalAccounts)
	}

	return systemicCount, totalAccounts
}

// escalateSystemic sets platform.trading_state=REDUCE_ONLY via the internal-caller authz
// channel (feature 102's own trading -> config edge, Step 13) and pages an operator — a
// config value must never silently change with no alert. Environment is set from this
// deployment's own s.cfg.ApplicationEnv; TradingMode is deliberately left UNSPECIFIED
// (resolves server-side to trading_mode='all') — a systemic broker-communication breakdown is
// by definition platform-wide, not scoped to one trading mode, so REDUCE_ONLY must apply to
// both paper and live simultaneously.
func (s *TradingService) escalateSystemic(ctx context.Context, systemicCount, totalAccounts int) {
	env := commonv1.Environment_ENVIRONMENT_STAGING // feature 147: non-production => staging
	if s.cfg.ApplicationEnv == "production" {
		env = commonv1.Environment_ENVIRONMENT_PRODUCTION
	}
	_, err := s.configSetter.SetConfig(ctx, "trading-reconciliation-poller", &configv1.SetConfigRequest{
		Namespace:   "platform",
		Key:         "trading_state",
		Value:       &configv1.ConfigValue{Value: &configv1.ConfigValue_StringVal{StringVal: "REDUCE_ONLY"}},
		Reason:      fmt.Sprintf("reconciliation: %d/%d accounts unreachable/unprotected this tick", systemicCount, totalAccounts),
		Author:      "system:reconciliation-poller",
		Environment: env,
	})
	if err != nil {
		slog.Warn("systemic escalation SetConfig failed", "error", err, "systemic_count", systemicCount, "total_accounts", totalAccounts)
	}

	_, alertErr := s.notify.EmitAlert(ctx, &notifyv1.EmitAlertRequest{
		Severity:      notifyv1.AlertSeverity_ALERT_SEVERITY_CRITICAL,
		Category:      "reconciliation",
		Title:         "Systemic broker-reconciliation failure — trading reduced to REDUCE_ONLY",
		Body:          fmt.Sprintf("%d of %d registered accounts were unreachable/unprotected this reconciliation tick.", systemicCount, totalAccounts),
		SourceService: "xstockstrat-trading",
	})
	if alertErr != nil {
		slog.Warn("systemic escalation alert failed", "error", alertErr)
	}
}

// resolveUnknownIntents implements FR-6: resolve 101's UNKNOWN-state order intents against
// broker truth (feature 102). For each UNKNOWN intent on this account:
//  1. First check the ledger for an order_intent.late_response_conflict event at stream key
//     order:{order_id} — resolves via the real recorded outcome. NOTE: 101's own
//     implementation-spec.md never actually emits this event anywhere in its Instructions (only
//     named in a forward-reference dependency note) — confirmed by direct grep of this
//     service's tree, zero hits for "late_response_conflict". This branch can therefore never
//     match today; it is left in place, not removed, because it is cheap, correct once 101 gains
//     an emit site, and documents the intended two-source design rather than silently degrading
//     to fallback-only. A one-time WARN fires if a full sweep finds zero such events ever
//     recorded, signaling the upstream gap needs fixing in 101, not 102.
//  2. Fallback (Alpaca only — IBKR's SubmitOrder never sends a customer-order tag, so
//     BrokerOrder.ClientOrderID is always "" for IBKR, see Steps 9/11): scan this tick's
//     already-fetched ListOrders result for a ClientOrderID matching the intent's derived nonce.
//  3. Genuinely inconclusive: no write this tick — never guess an outcome (FR-3).
func (s *TradingService) resolveUnknownIntents(ctx context.Context, accountID string, entry brokerPoolEntry, brokerOrders []broker.BrokerOrder) {
	if s.orderIntentRepo == nil {
		return
	}
	unknownIntents, err := s.orderIntentRepo.ListUnknownForAccount(ctx, accountID)
	if err != nil {
		slog.Warn("resolveUnknownIntents: ListUnknownForAccount failed", "account_id", accountID, "error", err)
		return
	}
	if len(unknownIntents) == 0 {
		return
	}

	byClientOrderID := make(map[string]broker.BrokerOrder, len(brokerOrders))
	for _, bo := range brokerOrders {
		if bo.ClientOrderID != "" {
			byClientOrderID[bo.ClientOrderID] = bo
		}
	}
	isAlpaca := commonv1.BrokerType(entry.brokerType) == commonv1.BrokerType_BROKER_TYPE_ALPACA

	for _, intent := range unknownIntents {
		// 2a. First check: a late-broker-response conflict event, if 101 ever emits one.
		events, qerr := s.ledger.QueryEvents(ctx, &ledgerv1.QueryEventsRequest{
			StreamKey: fmt.Sprintf("order:%s", intent.OrderID),
			EventType: "order_intent.late_response_conflict",
		})
		if qerr != nil {
			slog.Warn("resolveUnknownIntents: QueryEvents failed", "intent_id", intent.IntentID, "error", qerr)
		} else if len(events.Events) > 0 {
			payload := events.Events[0].Payload.AsMap()
			outcome, _ := payload["outcome"].(string)
			var newState int16
			switch outcome {
			case "rejected":
				newState = repository.IntentStateRejected
			case "completed":
				newState = repository.IntentStateCompleted
			default:
				continue // an unrecognized outcome literal is not a basis for a guess
			}
			responseJSON, _ := json.Marshal(payload)
			resolved, rerr := s.orderIntentRepo.ResolveUnknownIntent(ctx, intent.IntentID, newState, responseJSON)
			if rerr != nil {
				slog.Warn("resolveUnknownIntents: ResolveUnknownIntent failed", "intent_id", intent.IntentID, "error", rerr)
				continue
			}
			if resolved {
				s.emitLedgerEvent(ctx, "order_intent.resolved_by_reconciliation", fmt.Sprintf("order:%s", intent.OrderID), map[string]interface{}{
					"intent_id": intent.IntentID, "order_id": intent.OrderID, "resolved_via": "late_response_conflict",
				})
			}
			continue
		}

		// 2b. Fallback: Alpaca-only broker-side scan by the derived client-order-id nonce.
		if !isAlpaca {
			continue // IBKR never carries a client-order-id to match against (2c: no write)
		}
		bo, found := byClientOrderID[broker.DeriveBrokerClientOrderID(intent.IntentID)]
		if !found {
			continue // 2c: genuinely inconclusive this tick — retried next tick, no guess
		}
		status := alpacaStatusToProto(bo.Status)
		var newState int16
		switch status {
		case tradingv1.OrderStatus_ORDER_STATUS_REJECTED:
			newState = repository.IntentStateRejected
		case tradingv1.OrderStatus_ORDER_STATUS_UNSPECIFIED:
			continue // an unrecognized/transient broker status is not a basis for a guess
		default:
			newState = repository.IntentStateCompleted
		}
		resolved, rerr := s.orderIntentRepo.ResolveUnknownIntent(ctx, intent.IntentID, newState, nil)
		if rerr != nil {
			slog.Warn("resolveUnknownIntents: ResolveUnknownIntent failed", "intent_id", intent.IntentID, "error", rerr)
			continue
		}
		if resolved {
			s.emitLedgerEvent(ctx, "order_intent.resolved_by_reconciliation", fmt.Sprintf("order:%s", intent.OrderID), map[string]interface{}{
				"intent_id": intent.IntentID, "order_id": intent.OrderID, "resolved_via": "alpaca_list_orders_fallback",
			})
		}
	}
}

// StartPositionSyncPoller polls all registered broker accounts for open positions
// and emits ledger events. Interval is live-reloaded from config key
// `trading.position_sync.interval_ms` (default 300000 ms).
func (s *TradingService) StartPositionSyncPoller(ctx context.Context) {
	const defaultIntervalMs = 300000.0
	currentInterval := time.Duration(defaultIntervalMs) * time.Millisecond
	ticker := time.NewTicker(currentInterval)
	defer ticker.Stop()
	// lastOK is the time of the most recent cycle that emitted at least one
	// account.positions.synced event; the watchdog uses it to detect a silent stall.
	var lastOK time.Time
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			synced, skipped, failed := s.syncPositions(ctx)
			if synced > 0 {
				lastOK = time.Now()
			}
			// Heartbeat: make a healthy sync loop observable and a stalled one
			// diagnosable from logs alone. Previously a silent stall (e.g. every
			// account skipped for invalid credentials, or a wedged broker/ledger
			// call) looked identical to a healthy idle service — zero log output.
			slog.Info("position sync cycle complete",
				"accounts_synced", synced, "accounts_skipped", skipped, "accounts_failed", failed)
			// Watchdog: accounts are registered but none have synced for several
			// intervals. lastOK guards against a false positive before the first
			// successful sync (it stays zero until then).
			if synced == 0 && (skipped > 0 || failed > 0) && !lastOK.IsZero() {
				if stale := time.Since(lastOK); stale > 3*currentInterval {
					slog.Warn("position sync stalled: no account has synced recently",
						"stale_for", stale.Round(time.Second).String(),
						"accounts_skipped", skipped, "accounts_failed", failed)
				}
			}
			intervalMs := s.cfgW.GetFloat("trading.position_sync.interval_ms", defaultIntervalMs)
			if intervalMs > 0 {
				newInterval := time.Duration(intervalMs) * time.Millisecond
				if newInterval != currentInterval {
					currentInterval = newInterval
					ticker.Reset(currentInterval)
				}
			}
		}
	}
}

// syncPositions polls every registered broker account for positions and balance
// and emits the corresponding ledger snapshots. It returns per-cycle counts —
// synced (positions emitted), skipped (credentials marked invalid), and failed
// (broker fetch errored) — so the poller can emit a liveness heartbeat and detect
// a silent stall.
func (s *TradingService) syncPositions(ctx context.Context) (synced, skipped, failed int) {
	type syncAccount struct {
		client broker.Broker
		userID string
	}
	s.brokersMu.RLock()
	accounts := make(map[string]syncAccount, len(s.brokers))
	for id, e := range s.brokers {
		// Offline accounts (feature 157) have a nil client — their positions self-heal from
		// ConfirmOrder's account.positions.synced emit, never from a broker snapshot. Skip.
		if e.brokerType == int32(commonv1.BrokerType_BROKER_TYPE_OFFLINE) {
			continue
		}
		accounts[id] = syncAccount{client: e.client, userID: e.userID}
	}
	s.brokersMu.RUnlock()

	// Snapshot the last-known credential health so we can skip accounts whose secrets
	// already failed validation. Calling GetPositions on a known-INVALID account just
	// returns an unrecoverable 401 every cycle, hammering the broker and spamming logs.
	// The credential-health poller (StartCredentialHealthPoller) keeps re-checking and
	// flips the status back to OK once the secrets are fixed, at which point sync resumes.
	s.credStatusMu.Lock()
	credStatus := make(map[string]int32, len(s.credStatus))
	for id, st := range s.credStatus {
		credStatus[id] = st
	}
	s.credStatusMu.Unlock()

	for accountID, acct := range accounts {
		if credentialsKnownInvalid(credStatus[accountID]) {
			s.warnCredSkip(accountID)
			skipped++
			continue
		}
		if s.syncAccountPositions(ctx, accountID, acct.client, acct.userID) {
			synced++
		} else {
			failed++
		}
	}
	return synced, skipped, failed
}

// syncAccountPositions fetches one account's positions and balance from the broker
// and emits the account.positions.synced / account.balance.synced ledger snapshots.
// Every broker call runs under an explicit per-call deadline so a black-holed
// connection can never wedge the position-sync poller indefinitely — the
// credential-health poller already wraps its broker call this way, and this brings
// position sync to parity (the ledger emit is bounded inside emitLedgerEvent).
// Returns true when the positions snapshot was fetched and emitted; balance is
// best-effort and its failure does not flip the result to false.
func (s *TradingService) syncAccountPositions(ctx context.Context, accountID string, client broker.Broker, userID string) bool {
	timeout := s.brokerCallTimeout()

	posCtx, cancel := context.WithTimeout(ctx, timeout)
	positions, err := client.GetPositions(posCtx)
	cancel()
	if err != nil {
		slog.Warn("syncPositions: GetPositions failed", "account_id", accountID, "error", err)
		return false
	}

	tradingMode := "TRADING_MODE_LIVE"
	if client.IsPaper() {
		tradingMode = "TRADING_MODE_PAPER"
	}
	// structpb.NewStruct only accepts []interface{}, not typed slices.
	posEntries := make([]interface{}, len(positions))
	for i, p := range positions {
		posEntries[i] = map[string]interface{}{
			"symbol":   p.Symbol,
			"qty":      p.Quantity,
			"avg_cost": p.AvgCost,
			// Broker mark-to-market valuation — lets the portfolio card reconcile with
			// the broker's authoritative equity instead of recomputing from marketdata
			// mid-quotes (a different price basis that never ties out).
			"current_price":   p.CurrentPrice,
			"market_value":    p.MarketValue,
			"unrealized_pl":   p.UnrealizedPnl,
			"unrealized_plpc": p.UnrealizedPnlPct,
			// Today's (intraday) P&L — change since the previous close. Carried so the
			// positions table can show "Today's P/L" distinct from total unrealized P&L.
			"day_pnl":     p.DayPnl,
			"day_pnl_pct": p.DayPnlPct,
		}
	}
	s.emitLedgerEvent(ctx, "account.positions.synced", fmt.Sprintf("account:%s", accountID), map[string]interface{}{
		"account_id":   accountID,
		"user_id":      userID,
		"trading_mode": tradingMode,
		"positions":    posEntries,
	})

	// Sync the account balance snapshot (cash, buying power, equity) alongside
	// positions. Best-effort: a balance fetch failure must not block position sync.
	balCtx, cancelBal := context.WithTimeout(ctx, timeout)
	bal, err := client.GetAccount(balCtx)
	cancelBal()
	if err != nil {
		slog.Warn("syncPositions: GetAccount failed", "account_id", accountID, "error", err)
		return true
	}
	s.emitLedgerEvent(ctx, "account.balance.synced", fmt.Sprintf("account:%s", accountID), map[string]interface{}{
		"account_id":   accountID,
		"user_id":      userID,
		"trading_mode": tradingMode,
		"cash":         bal.Cash,
		"buying_power": bal.BuyingPower,
		"equity":       bal.Equity,
		"last_equity":  bal.LastEquity,
	})
	return true
}

// brokerCallTimeout is the per-call deadline for broker REST calls made by the
// sync pollers, sourced from the same live config key as the broker HTTP client's
// own timeout (trading.broker.timeout_ms, default 5000 ms). It is a context-level
// backstop so a stalled connection surfaces as an error instead of blocking forever.
func (s *TradingService) brokerCallTimeout() time.Duration {
	ms := s.cfgW.GetFloat("trading.broker.timeout_ms", 5000)
	if ms <= 0 {
		ms = 5000
	}
	return time.Duration(ms) * time.Millisecond
}

// haltedPollInterval is how often reconcileTick re-polls an already-halted account's broker
// state (trading.reconciliation.halted_poll_interval_ms, default 300000 ms / 5 min) — read
// live, like brokerCallTimeout above. Unlike graceTicks/systemicThresholdPct (see
// reconcileTick's own doc comment for why those are hoisted explicit parameters instead),
// this value has no test that needs to substitute an arbitrary override through
// config.Watcher's absent snapshot setter: the default itself is what a hand-constructed
// service in tests gets, and shouldPollHaltedAccount's own throttle/edge-case behavior is
// unit-tested directly against an explicit intervalMs argument.
func (s *TradingService) haltedPollInterval() float64 {
	return s.cfgW.GetFloat("trading.reconciliation.halted_poll_interval_ms", 300000)
}

// credSkipLogInterval throttles the per-account "skipping invalid credentials"
// warning so a persistently invalid account is visible without logging every cycle.
const credSkipLogInterval = 15 * time.Minute

// warnCredSkip logs that position sync is skipping an account for invalid
// credentials, throttled to once per credSkipLogInterval per account. Called only
// from the single-goroutine position-sync poller, so credSkipLoggedAt needs no lock.
func (s *TradingService) warnCredSkip(accountID string) {
	now := time.Now()
	if last, ok := s.credSkipLoggedAt[accountID]; ok && now.Sub(last) < credSkipLogInterval {
		return
	}
	s.credSkipLoggedAt[accountID] = now
	slog.Warn("position sync skipping account: broker credentials marked invalid; re-enter credentials to resume position/balance sync",
		"account_id", accountID)
}

// RegisterBrokerAccount registers a new broker account, encrypts credentials, and adds it to the pool.
// Paper vs. live is derived from the deployment environment (req.IsPaper is ignored)
// so users cannot register an account in a mode the environment does not allow.
func (s *TradingService) RegisterBrokerAccount(ctx context.Context, req *tradingv1.RegisterBrokerAccountRequest, userID string) (*tradingv1.BrokerAccount, error) {
	// Offline account (feature 157): no broker credentials, no broker client. Skip the
	// json.Valid/EncryptCredentials/instantiateBrokerLocked/validateAndRecordCredential path
	// entirely and persist with credentials_enc = NULL (migration 008 made the column nullable).
	if req.BrokerType == commonv1.BrokerType_BROKER_TYPE_OFFLINE {
		accountID := uuid.NewString()
		rec := &repository.BrokerAccountRecord{
			ID:          accountID,
			DisplayName: req.DisplayName,
			BrokerType:  int32(commonv1.BrokerType_BROKER_TYPE_OFFLINE),
			IsPaper:     s.environmentIsPaper(),
			IsActive:    true,
			UserID:      userID,
			// CredentialsEnc left nil → SQL NULL; CredentialStatus stays UNSPECIFIED.
		}
		if err := s.accountRepo.CreateBrokerAccount(ctx, rec); err != nil {
			return nil, grpcstatus.Errorf(codes.Internal, "create offline account: %v", err)
		}
		// Pool entry with a nil client tags this account OFFLINE so every broker poller skips it.
		s.brokersMu.Lock()
		s.brokers[accountID] = brokerPoolEntry{client: nil, brokerType: int32(commonv1.BrokerType_BROKER_TYPE_OFFLINE), userID: userID}
		s.brokersMu.Unlock()
		return recordToProtoAccount(rec), nil
	}

	if !json.Valid([]byte(req.CredentialsJson)) {
		return nil, grpcstatus.Errorf(codes.InvalidArgument, "credentials_json is not valid JSON")
	}

	encCreds, err := repository.EncryptCredentials(s.encKey, []byte(req.CredentialsJson))
	if err != nil {
		return nil, grpcstatus.Errorf(codes.Internal, "encrypt credentials: %v", err)
	}

	accountID := uuid.NewString()
	rec := &repository.BrokerAccountRecord{
		ID:             accountID,
		DisplayName:    req.DisplayName,
		BrokerType:     int32(req.BrokerType),
		IsPaper:        s.environmentIsPaper(),
		IsActive:       true,
		UserID:         userID,
		CredentialsEnc: encCreds,
	}
	if err := s.accountRepo.CreateBrokerAccount(ctx, rec); err != nil {
		return nil, grpcstatus.Errorf(codes.Internal, "create broker account: %v", err)
	}

	b, err := s.instantiateBrokerLocked(rec, []byte(req.CredentialsJson))
	if err != nil {
		slog.Warn("RegisterBrokerAccount: broker instantiation failed", "account_id", accountID, "error", err)
	} else {
		s.brokersMu.Lock()
		s.brokers[accountID] = brokerPoolEntry{client: b, brokerType: int32(req.BrokerType), userID: userID}
		s.brokersMu.Unlock()
		// Validate immediately so the UI gets an accurate status without waiting
		// for the next health poll. Best-effort: failures only affect status.
		rec.CredentialStatus, rec.CredentialCheckedAt = s.validateAndRecordCredential(ctx, accountID, b)
	}

	return recordToProtoAccount(rec), nil
}

// UpdateBrokerAccountCredentials replaces the stored API secrets for an existing
// account, re-instantiates its broker client, and re-validates the credentials.
func (s *TradingService) UpdateBrokerAccountCredentials(ctx context.Context, accountID, callerUserID, credentialsJSON string) (*tradingv1.BrokerAccount, error) {
	if !json.Valid([]byte(credentialsJSON)) {
		return nil, grpcstatus.Errorf(codes.InvalidArgument, "credentials_json is not valid JSON")
	}
	rec, err := s.accountRepo.GetBrokerAccount(ctx, accountID)
	if err != nil {
		return nil, grpcstatus.Errorf(codes.NotFound, "account %s not found: %v", accountID, err)
	}
	if rec.UserID != callerUserID {
		return nil, grpcstatus.Errorf(codes.PermissionDenied, "account %s does not belong to caller", accountID)
	}
	// Offline accounts (feature 157) have no credentials to update.
	if rec.BrokerType == int32(commonv1.BrokerType_BROKER_TYPE_OFFLINE) {
		return nil, grpcstatus.Errorf(codes.FailedPrecondition, "offline accounts have no broker credentials to update")
	}

	encCreds, err := repository.EncryptCredentials(s.encKey, []byte(credentialsJSON))
	if err != nil {
		return nil, grpcstatus.Errorf(codes.Internal, "encrypt credentials: %v", err)
	}
	if err := s.accountRepo.UpdateCredentials(ctx, accountID, encCreds); err != nil {
		return nil, grpcstatus.Errorf(codes.Internal, "update credentials: %v", err)
	}
	rec.CredentialsEnc = encCreds
	rec.CredentialStatus = 0
	rec.CredentialCheckedAt = nil
	// UpdateCredentials reset the persisted status to UNSPECIFIED; mirror that in
	// the cache so the re-validation below always writes the fresh status, even
	// if it matches the pre-update value.
	s.credStatusMu.Lock()
	s.credStatus[accountID] = 0
	s.credStatusMu.Unlock()

	b, err := s.instantiateBrokerLocked(rec, []byte(credentialsJSON))
	if err != nil {
		slog.Warn("UpdateBrokerAccountCredentials: broker instantiation failed", "account_id", accountID, "error", err)
	} else {
		s.brokersMu.Lock()
		s.brokers[accountID] = brokerPoolEntry{client: b, brokerType: rec.BrokerType, userID: rec.UserID}
		s.brokersMu.Unlock()
		rec.CredentialStatus, rec.CredentialCheckedAt = s.validateAndRecordCredential(ctx, accountID, b)
	}

	return recordToProtoAccount(rec), nil
}

// GetTradingEnvironment reports the deployment-fixed trading mode so the UI can
// display it and avoid offering a paper/live choice.
func (s *TradingService) GetTradingEnvironment(_ context.Context) *tradingv1.GetTradingEnvironmentResponse {
	mode := commonv1.TradingMode_TRADING_MODE_LIVE
	if s.environmentIsPaper() {
		mode = commonv1.TradingMode_TRADING_MODE_PAPER
	}
	return &tradingv1.GetTradingEnvironmentResponse{
		TradingMode:    mode,
		ApplicationEnv: s.cfg.ApplicationEnv,
	}
}

// environmentIsPaper resolves whether this deployment routes to paper trading.
// Priority: live config key trading.broker.paper > TRADING_MODE env default.
func (s *TradingService) environmentIsPaper() bool {
	return s.cfgW.GetBool("trading.broker.paper", s.cfg.TradingMode == "paper")
}

// validateAndRecordCredential validates a broker client's credentials, persists
// the resulting status, and returns it along with the check time. Best-effort:
// persistence failures are logged but do not surface to the caller. The DB write
// is skipped when the status has not changed since the last check (tracked in
// s.credStatus), so steady-state polling does no DB work.
func (s *TradingService) validateAndRecordCredential(ctx context.Context, accountID string, b broker.Broker) (int32, *time.Time) {
	valCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	status := credentialStatusFromError(b.ValidateCredentials(valCtx))
	checkedAt := time.Now().UTC()

	s.credStatusMu.Lock()
	prev, seen := s.credStatus[accountID]
	changed := !seen || prev != status
	s.credStatus[accountID] = status
	s.credStatusMu.Unlock()

	if changed {
		logCredentialStatusTransition(accountID, seen, prev, status)
		if err := s.accountRepo.UpdateCredentialStatus(context.Background(), accountID, status, checkedAt); err != nil {
			slog.Warn("validateAndRecordCredential: persist status failed", "account_id", accountID, "error", err)
			// Roll back the cached value so the next check retries the write.
			s.credStatusMu.Lock()
			if seen {
				s.credStatus[accountID] = prev
			} else {
				delete(s.credStatus, accountID)
			}
			s.credStatusMu.Unlock()
		}
	}
	return status, &checkedAt
}

// credentialHealthDefaultIntervalMs is the fallback poll interval when the config
// key trading.credential_health.interval_ms is unset.
const credentialHealthDefaultIntervalMs = 300000.0

// credentialHealthDisabledRecheck is how often the poller re-reads config while
// disabled (interval_ms <= 0), so it can resume without a restart.
const credentialHealthDisabledRecheck = 60 * time.Second

// maxConcurrentCredentialChecks bounds how many broker validations run in
// parallel per poll cycle, so a large pool cannot exhaust connections.
const maxConcurrentCredentialChecks = 8

// StartCredentialHealthPoller periodically re-validates every registered broker
// account's credentials and records the result, so the UI can surface accounts
// whose secrets stopped working. The interval is read from config key
// trading.credential_health.interval_ms (default 300000 ms) on every cycle;
// setting it to 0 or a negative value disables (pauses) the poller, which keeps
// re-checking config so it can be re-enabled live.
func (s *TradingService) StartCredentialHealthPoller(ctx context.Context) {
	for {
		intervalMs := s.cfgW.GetFloat("trading.credential_health.interval_ms", credentialHealthDefaultIntervalMs)

		wait := credentialHealthDisabledRecheck
		if intervalMs > 0 {
			wait = time.Duration(intervalMs) * time.Millisecond
		}

		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
			if intervalMs > 0 {
				s.checkCredentialHealth(ctx)
			}
		}
	}
}

// checkCredentialHealth validates every pooled account's credentials concurrently
// (bounded by maxConcurrentCredentialChecks) and records any status changes.
func (s *TradingService) checkCredentialHealth(ctx context.Context) {
	s.brokersMu.RLock()
	brokerMap := make(map[string]broker.Broker, len(s.brokers))
	for id, e := range s.brokers {
		// Offline accounts (feature 157) have no credentials and a nil client — skip them so the
		// health poller never dereferences nil or reports a spurious credential status.
		if e.brokerType == int32(commonv1.BrokerType_BROKER_TYPE_OFFLINE) {
			continue
		}
		brokerMap[id] = e.client
	}
	s.brokersMu.RUnlock()

	sem := make(chan struct{}, maxConcurrentCredentialChecks)
	var wg sync.WaitGroup
	for accountID, b := range brokerMap {
		wg.Add(1)
		sem <- struct{}{}
		go func(accountID string, b broker.Broker) {
			defer wg.Done()
			defer func() { <-sem }()
			s.validateAndRecordCredential(ctx, accountID, b)
		}(accountID, b)
	}
	wg.Wait()
}

// ── Per-account automated halt (feature 030) ────────────────────────────────────

// isAccountHalted reports whether the given account has an active automated halt.
func (s *TradingService) isAccountHalted(accountID string) bool {
	s.haltedMu.Lock()
	defer s.haltedMu.Unlock()
	return s.halted[accountID]
}

// shouldPollHaltedAccount reports whether reconcileTick should poll the broker for an
// already-halted account this tick, throttling to intervalMs
// (trading.reconciliation.halted_poll_interval_ms) instead of the ordinary tick rate — an
// already-halted account can't place new orders regardless (isAccountHalted gates
// PlaceOrder/ReplaceOrder), so there is no need to re-check its broker state at full
// frequency, only to eventually notice broker-side drift (e.g. a manual order placed via
// the broker's own dashboard). Records now as the new last-polled time whenever it returns
// true, including the first observation (intervalMs <= 0 always polls, matching
// StartReconciliationPoller's own "<=0 disables the override" convention for interval_ms).
func (s *TradingService) shouldPollHaltedAccount(accountID string, intervalMs float64) bool {
	now := time.Now()
	s.haltedMu.Lock()
	defer s.haltedMu.Unlock()
	if intervalMs > 0 {
		if last, seen := s.haltedLastPolled[accountID]; seen && now.Sub(last) < time.Duration(intervalMs)*time.Millisecond {
			return false
		}
	}
	s.haltedLastPolled[accountID] = now
	return true
}

// haltReason returns the last-recorded reason for an account's halt (empty if none).
func (s *TradingService) haltReason(accountID string) string {
	s.haltedMu.Lock()
	defer s.haltedMu.Unlock()
	return s.haltReasons[accountID]
}

// haltAccount sets the in-memory halt flag first, releases the mutex, then issues the
// bounded DB write — round-5-corrected ordering (design.md): never hold the mutex
// across the DB round-trip, and never roll back the in-memory flag on a write
// failure (fail-safe — the halt itself must never be undone by a persistence
// hiccup; this differs from validateAndRecordCredential's own rollback-on-failure,
// which is a deliberate, different choice for that unrelated concern).
//
// An already-halted account short-circuits before the DB write/alert/error-log: nothing
// in this service ever clears halted (resuming trading is a manual DB edit — see
// TestLoadBrokerPool_HydratesHaltedFromDB), so once set, re-running the full sequence for
// every later finding is pure noise, not a new signal — e.g. the reconciliation poller
// (StartReconciliationPoller) re-observing the same handful of pre-existing broker orders
// as "unknown" every tick previously re-halted, re-alerted (CRITICAL), and re-logged at
// ERROR indefinitely for an account that was already halted.
func (s *TradingService) haltAccount(ctx context.Context, accountID, reason string, haltSource int32) {
	now := time.Now().UTC()
	s.haltedMu.Lock()
	if s.halted[accountID] {
		s.haltedMu.Unlock()
		return
	}
	s.halted[accountID] = true
	s.haltReasons[accountID] = reason
	// Start the halted-account poll cooldown now, not on the next tick — otherwise
	// reconcileTick would still poll this account at full rate for one more tick before
	// shouldPollHaltedAccount's first observation kicks in.
	s.haltedLastPolled[accountID] = now
	s.haltedMu.Unlock()

	dbCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := s.accountRepo.UpdateHaltStatus(dbCtx, accountID, true, reason, &now, haltSource); err != nil {
		slog.Warn("haltAccount: persist halt failed", "account_id", accountID, "error", err)
	}

	_, err := s.notify.EmitAlert(ctx, &notifyv1.EmitAlertRequest{
		Severity:      notifyv1.AlertSeverity_ALERT_SEVERITY_CRITICAL,
		Category:      "halt",
		Title:         fmt.Sprintf("Account halted: %s", accountID),
		Body:          fmt.Sprintf("Account %s was automatically halted: %s", accountID, reason),
		SourceService: "xstockstrat-trading",
	})
	if err != nil {
		slog.Warn("haltAccount: emit alert failed", "account_id", accountID, "error", err)
	}
	slog.Error("account halted", "account_id", accountID, "reason", reason)
}

// flattenAndHalt closes the given bracket's underlying position at market (the
// protection window expired with no confirmed bracket) and, if that fails after
// exhausting retries, halts the account. Reuses PlaceOrder's own submission path
// (submitOrder) so the flatten gets the exact same broker-safety machinery as any
// other order.
func (s *TradingService) flattenAndHalt(ctx context.Context, bracket *repository.OrderBracketRecord) {
	s.brokersMu.RLock()
	accountEntry, ok := s.brokers[bracket.AccountID]
	s.brokersMu.RUnlock()
	if !ok {
		slog.Warn("flattenAndHalt: no broker for account", "account_id", bracket.AccountID, "order_id", bracket.OrderID)
		return
	}
	// Offline accounts (feature 157) never arm a bracket, so this is naturally unreachable for
	// them; guard explicitly anyway so a nil client can never be dereferenced below.
	if accountEntry.brokerType == int32(commonv1.BrokerType_BROKER_TYPE_OFFLINE) {
		slog.Warn("flattenAndHalt: offline account has no broker to flatten", "account_id", bracket.AccountID, "order_id", bracket.OrderID)
		return
	}

	s.mu.Lock()
	order, orderOK := s.orders[bracket.OrderID]
	s.mu.Unlock()
	if !orderOK {
		slog.Warn("flattenAndHalt: entry order not found", "order_id", bracket.OrderID)
		return
	}

	posCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	// x-user-id header carries the caller identity to portfolio; this background flatten path has
	// no inbound header, so inject the order owner explicitly.
	posCtx = metadata.AppendToOutgoingContext(posCtx, "x-user-id", order.UserId)
	position, err := s.portfolio.GetPosition(posCtx, &portfoliov1.GetPositionRequest{
		Symbol: order.Symbol, TradingMode: order.TradingMode,
	})
	cancel()
	if err != nil || position == nil || position.Qty == 0 {
		slog.Warn("flattenAndHalt: no open position to flatten", "account_id", bracket.AccountID, "symbol", order.Symbol, "error", err)
		return
	}

	flattenSide := tradingv1.OrderSide_ORDER_SIDE_SELL
	if position.Qty < 0 {
		flattenSide = tradingv1.OrderSide_ORDER_SIDE_BUY
	}
	qty := position.Qty
	if qty < 0 {
		qty = -qty
	}

	// Minted once per protection-gap-expiry episode, reused on every retry — preserves
	// the platform's broker-side dedup contract (design.md).
	clientOrderID := uuid.New().String()
	flattenOrderID := uuid.New().String()
	flattenReq := &tradingv1.PlaceOrderRequest{
		Symbol: order.Symbol, Side: flattenSide, OrderType: tradingv1.OrderType_ORDER_TYPE_MARKET,
		Qty: qty, TimeInForce: "day", AccountId: bracket.AccountID, ClientOrderId: clientOrderID,
		TradingMode: order.TradingMode,
	}
	mode := s.resolveTradingMode(order.TradingMode)

	// A flatten order is never auto-sized (it always carries an explicit qty), so
	// needSizing/sizedStopPrice/entryPriceProxy are all zero-valued — matches
	// maybeSubmitBracket's own no-op-when-stopPrice<=0 guard, so no new bracket is
	// ever opened on a position-closing flatten order.
	hashDigest, hashErr := placeOrderRequestHash(flattenReq)
	if hashErr != nil {
		slog.Warn("flattenAndHalt: compute request hash failed", "order_id", bracket.OrderID, "error", hashErr)
		return
	}
	requestHashHex := hex.EncodeToString(hashDigest)

	maxRetries := int(s.cfgW.GetFloat("trading.order.max_retries", 3))
	retryDelay := time.Duration(s.cfgW.GetFloat("trading.order.retry_delay_ms", 500)) * time.Millisecond

	var lastErr error
	for attempt := 0; attempt <= maxRetries; attempt++ {
		if attempt > 0 {
			time.Sleep(retryDelay)
		}
		_, lastErr = s.submitOrder(ctx, flattenReq, accountEntry, mode, bracket.AccountID, flattenOrderID, false,
			requestHashHex, false, 0, 0)
		if lastErr == nil {
			if uerr := s.bracketRepo.UpdateBracketStatus(ctx, bracket.ID, bracketStatusCanceled, bracket.StopLegOrderID, bracket.TakeProfitLegOrderID, ""); uerr != nil {
				slog.Warn("flattenAndHalt: update bracket status failed", "order_id", bracket.OrderID, "error", uerr)
			}
			slog.Info("flattenAndHalt: position flattened", "account_id", bracket.AccountID, "symbol", order.Symbol, "attempt", attempt)
			return
		}
		slog.Warn("flattenAndHalt: flatten attempt failed", "account_id", bracket.AccountID, "symbol", order.Symbol, "attempt", attempt, "error", lastErr)
	}

	s.haltAccount(context.Background(), bracket.AccountID,
		fmt.Sprintf("flatten failed after protection window expiry: order %s: %v", bracket.OrderID, lastErr),
		int32(tradingv1.HaltSource_HALT_SOURCE_BRACKET_PROTECTION))
}

// StartBracketProtectionWatchdog periodically scans for brackets whose protection
// window has expired (non-ACTIVE, non-terminal rows past protection_deadline) and
// flattens the underlying position. Piggybacks on the fill poller's own tick
// (trading.fill_poller.interval_ms) — no separate cadence config key, per design.md.
func (s *TradingService) StartBracketProtectionWatchdog(ctx context.Context) {
	for {
		intervalMs := s.cfgW.GetFloat("trading.fill_poller.interval_ms", 5000)
		wait := time.Duration(intervalMs) * time.Millisecond
		if wait <= 0 {
			wait = 5 * time.Second
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
			s.checkBracketProtection(ctx)
		}
	}
}

// checkBracketProtection is StartBracketProtectionWatchdog's per-tick body: a bounded
// scan for expired brackets, then one detached goroutine per row so a slow flatten on
// one account never blocks the next tick's scan or another account's flatten.
func (s *TradingService) checkBracketProtection(ctx context.Context) {
	scanCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	expired, err := s.bracketRepo.ListExpiredProtection(scanCtx, time.Now())
	cancel()
	if err != nil {
		slog.Warn("checkBracketProtection: scan failed", "error", err)
		return
	}
	for _, bracket := range expired {
		s.flattenInFlightMu.Lock()
		if s.flattenInFlight[bracket.ID] {
			s.flattenInFlightMu.Unlock()
			continue
		}
		s.flattenInFlight[bracket.ID] = true
		s.flattenInFlightMu.Unlock()

		go func(b *repository.OrderBracketRecord) {
			defer func() {
				s.flattenInFlightMu.Lock()
				delete(s.flattenInFlight, b.ID)
				s.flattenInFlightMu.Unlock()
			}()
			s.flattenAndHalt(context.Background(), b)
		}(bracket)
	}
}

// ListBrokerAccountsSvc returns all broker accounts for the given user.
func (s *TradingService) ListBrokerAccountsSvc(ctx context.Context, userID string) ([]*tradingv1.BrokerAccount, error) {
	recs, err := s.accountRepo.ListBrokerAccounts(ctx, userID)
	if err != nil {
		return nil, grpcstatus.Errorf(codes.Internal, "list broker accounts: %v", err)
	}
	accounts := make([]*tradingv1.BrokerAccount, 0, len(recs))
	for _, r := range recs {
		accounts = append(accounts, recordToProtoAccount(r))
	}
	return accounts, nil
}

// recordToProtoAccount maps a stored account record to its proto representation.
// Credentials are never included.
func recordToProtoAccount(r *repository.BrokerAccountRecord) *tradingv1.BrokerAccount {
	acct := &tradingv1.BrokerAccount{
		Id:               r.ID,
		DisplayName:      r.DisplayName,
		BrokerType:       commonv1.BrokerType(r.BrokerType),
		IsPaper:          r.IsPaper,
		UserId:           r.UserID,
		IsActive:         r.IsActive,
		CredentialStatus: tradingv1.CredentialStatus(r.CredentialStatus),
	}
	if r.CredentialCheckedAt != nil {
		acct.CredentialCheckedAt = timestamppb.New(*r.CredentialCheckedAt)
	}
	acct.Halted = r.Halted
	acct.HaltReason = r.HaltReason
	acct.HaltSource = tradingv1.HaltSource(r.HaltSource)
	if r.HaltedAt != nil {
		acct.HaltedAt = timestamppb.New(*r.HaltedAt)
	}
	return acct
}

// credentialStatusFromError maps a ValidateCredentials result to a proto
// CredentialStatus enum value (returned as int32 for repository persistence).
func credentialStatusFromError(err error) int32 {
	switch {
	case err == nil:
		return int32(tradingv1.CredentialStatus_CREDENTIAL_STATUS_OK)
	case errors.Is(err, broker.ErrInvalidCredentials):
		return int32(tradingv1.CredentialStatus_CREDENTIAL_STATUS_INVALID)
	default:
		return int32(tradingv1.CredentialStatus_CREDENTIAL_STATUS_UNKNOWN)
	}
}

// credentialsKnownInvalid reports whether an account's last-validated credential
// status is INVALID. syncPositions skips such accounts: calling GetPositions on
// them just returns an unrecoverable 401 every cycle, hammering the broker and
// spamming logs. UNKNOWN/UNSPECIFIED/OK are not skipped — only a confirmed
// failure is, and the credential-health poller re-enables the account once the
// secrets are fixed (status flips back to OK).
func credentialsKnownInvalid(status int32) bool {
	return status == int32(tradingv1.CredentialStatus_CREDENTIAL_STATUS_INVALID)
}

// logCredentialStatusTransition records a broker credential health change so an
// account whose secrets stop (or start) working is visible in logs, not only in the
// UI. OK→INVALID is logged at WARN because position/balance sync silently stops for
// that account; first observations and recoveries are INFO.
func logCredentialStatusTransition(accountID string, seen bool, prev, status int32) {
	if seen && prev == status {
		return
	}
	statusName := tradingv1.CredentialStatus(status).String()
	switch {
	case credentialsKnownInvalid(status):
		slog.Warn("broker credential status degraded; position/balance sync will skip this account",
			"account_id", accountID, "previous", tradingv1.CredentialStatus(prev).String(), "status", statusName)
	case !seen:
		slog.Info("broker credential status", "account_id", accountID, "status", statusName)
	default:
		slog.Info("broker credential status changed",
			"account_id", accountID, "previous", tradingv1.CredentialStatus(prev).String(), "status", statusName)
	}
}

// DeregisterBrokerAccountSvc deactivates a broker account and removes it from the pool.
func (s *TradingService) DeregisterBrokerAccountSvc(ctx context.Context, accountID, callerUserID string) error {
	rec, err := s.accountRepo.GetBrokerAccount(ctx, accountID)
	if err != nil {
		return grpcstatus.Errorf(codes.NotFound, "account %s not found: %v", accountID, err)
	}
	if rec.UserID != callerUserID {
		return grpcstatus.Errorf(codes.PermissionDenied, "account %s does not belong to caller", accountID)
	}
	if err := s.accountRepo.DeactivateBrokerAccount(ctx, accountID); err != nil {
		return grpcstatus.Errorf(codes.Internal, "deactivate account: %v", err)
	}
	s.brokersMu.Lock()
	delete(s.brokers, accountID)
	s.brokersMu.Unlock()
	s.credStatusMu.Lock()
	delete(s.credStatus, accountID)
	s.credStatusMu.Unlock()

	// Offline accounts (feature 157/163): purge the baseline table BEFORE the deregistered emit
	// so downstream consumers never see a stale baseline for a deregistered account (FR-8/AC-18).
	// Fail the RPC on error (retry-safe: both ops are idempotent).
	if rec.BrokerType == int32(commonv1.BrokerType_BROKER_TYPE_OFFLINE) {
		if err := s.baselineStore.DeleteBaselinesByAccount(ctx, accountID); err != nil {
			return grpcstatus.Errorf(codes.Internal, "purge baselines for account %s: %v", accountID, err)
		}
		// Emit account.deregistered so xstockstrat-portfolio purges the account's positions and its
		// account-grain realized P&L (no broker sync ever will).
		s.emitLedgerEvent(ctx, "account.deregistered", fmt.Sprintf("account:%s", accountID), map[string]interface{}{
			"account_id": accountID,
			"user_id":    rec.UserID,
		})
	}
	return nil
}

// instantiateBrokerLocked creates a broker.Broker from plaintext credentials JSON.
// Caller must not hold brokersMu (it acquires no lock itself).
func (s *TradingService) instantiateBrokerLocked(rec *repository.BrokerAccountRecord, plaintext []byte) (broker.Broker, error) {
	switch rec.BrokerType {
	case int32(commonv1.BrokerType_BROKER_TYPE_IBKR):
		var creds ibkrCreds
		if err := json.Unmarshal(plaintext, &creds); err != nil {
			return nil, fmt.Errorf("unmarshal IBKR creds: %w", err)
		}
		return broker.NewIBKRClient(broker.IBKRConfig{
			ConsumerKey:       creds.ConsumerKey,
			AccessToken:       creds.AccessToken,
			AccessTokenSecret: creds.AccessTokenSecret,
			IBKRAccountID:     creds.IBKRAccountID,
			IsPaper:           rec.IsPaper,
		}), nil
	default:
		var creds alpacaCreds
		if err := json.Unmarshal(plaintext, &creds); err != nil {
			return nil, fmt.Errorf("unmarshal Alpaca creds: %w", err)
		}
		return broker.NewClient(broker.ClientConfig{
			APIKey:    creds.APIKey,
			APISecret: creds.APISecret,
			PaperURL:  "https://paper-api.alpaca.markets",
			LiveURL:   "https://api.alpaca.markets",
			Paper:     rec.IsPaper,
			TimeoutMs: int(s.cfgW.GetInt("trading.broker.timeout_ms", 5000)),
		}), nil
	}
}

// checkPortfolioRisk makes a non-blocking GetPortfolio call to validate position
// concentration limits before placing an order. Warnings are logged but never
// block order placement — portfolio unavailability must not halt trading.
// checkPortfolioRisk is non-blocking (warn-only) — it logs when an order's notional exceeds
// trading.risk.max_position_pct but never rejects. Unlike ComputePositionSize (feature 023,
// fail-closed by design.md's explicit choice), this pre-existing check stays fail-open:
// "portfolio unavailability must not halt trading" on this single-instance, no-HA topology.
// equity/equityErr are now passed in (feature 023) rather than fetched here, so this and
// ComputePositionSize share one ListPortfolios call per PlaceOrder — fixing the pre-existing
// two-equity-sources bug (fails.md 2026-07-01 C-10(b)): this used to call GetPortfolio
// (position-value-summed, $0 for a flat funded account) while ComputePositionSize's sibling
// call uses ListPortfolios (the real account equity), so a flat account's order could silently
// bypass this check.
func (s *TradingService) checkPortfolioRisk(ctx context.Context, req *tradingv1.PlaceOrderRequest, mode commonv1.TradingMode, equity float64, equityErr error) {
	callerID := middleware.FromContext(ctx).UserID
	if callerID == "" {
		return
	}
	maxPositionPct := s.cfgW.GetFloat("trading.risk.max_position_pct", 0.05)
	if maxPositionPct <= 0 {
		return
	}

	if equityErr != nil {
		slog.Warn("portfolio risk check skipped", "user_id", callerID, "error", equityErr)
		return
	}

	if equity <= 0 {
		return
	}

	orderNotional := req.Qty * req.LimitPrice
	if orderNotional > 0 {
		pct := orderNotional / equity
		if pct > maxPositionPct {
			slog.Warn("order exceeds max_position_pct threshold",
				"order_id_pending", req.Symbol,
				"order_notional", orderNotional,
				"portfolio_equity", equity,
				"pct", pct,
				"max_pct", maxPositionPct,
				"trading_mode", mode.String(),
			)
		}
	}
}

// resolveAccountEquity fetches the given account's real equity via ListPortfolios (not
// GetPortfolio — see checkPortfolioRisk's comment above for why). Shared by
// checkPortfolioRisk and ComputePositionSize so both risk checks agree on one number per
// PlaceOrder call.
func (s *TradingService) resolveAccountEquity(ctx context.Context, accountID string) (float64, error) {
	eqCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()

	resp, err := s.portfolio.ListPortfolios(eqCtx, &portfoliov1.ListPortfoliosRequest{AccountId: &accountID})
	if err != nil {
		return 0, fmt.Errorf("list portfolios: %w", err)
	}
	if len(resp.Portfolios) == 0 {
		return 0, fmt.Errorf("no portfolio found for account %q", accountID)
	}
	return resp.Portfolios[0].Equity, nil
}

// wilderATR computes Wilder's true-range Average True Range over the given period from a
// chronologically-ascending (oldest-first) slice of bars. Requires len(bars) >= period+1 (the
// first true range needs a previous close, so period bars of TR need period+1 bars of price
// data).
func wilderATR(bars []*marketdatav1.Bar, period int) (float64, error) {
	if len(bars) < period+1 {
		return 0, fmt.Errorf("wilderATR: need at least %d bars, got %d", period+1, len(bars))
	}

	trueRange := func(high, low, prevClose float64) float64 {
		tr := high - low
		if v := math.Abs(high - prevClose); v > tr {
			tr = v
		}
		if v := math.Abs(low - prevClose); v > tr {
			tr = v
		}
		return tr
	}

	// First ATR = simple mean of the first `period` true ranges.
	sum := 0.0
	for i := 1; i <= period; i++ {
		sum += trueRange(bars[i].High, bars[i].Low, bars[i-1].Close)
	}
	atr := sum / float64(period)

	// Subsequent bars use Wilder's smoothing: ATR_i = ((prevATR * (period-1)) + TR_i) / period.
	for i := period + 1; i < len(bars); i++ {
		tr := trueRange(bars[i].High, bars[i].Low, bars[i-1].Close)
		atr = ((atr * float64(period-1)) + tr) / float64(period)
	}
	return atr, nil
}

// ComputePositionSize computes an auto-sized order's quantity, dollar risk, and informational
// stop price (feature 023) from account equity, ATR(14)-derived stop distance, signal
// confidence, and a portfolio concentration cap. Fail-closed by design (unlike
// checkPortfolioRisk above): any error or insufficient-data condition returns a non-nil error
// and no quantity — this is the enforcing counterpart to that warn-only check.
func (s *TradingService) ComputePositionSize(ctx context.Context, req *tradingv1.PlaceOrderRequest, equity, confidence float64) (qty float64, dollarRisk float64, stopPrice float64, currentPrice float64, err error) {
	// Belt-and-suspenders: PlaceOrder already fail-closes on equity<=0 before calling this
	// (its equityErr/equity<=0 check ahead of ComputePositionSize), but ComputePositionSize
	// is a public method other callers could invoke directly — it must not silently size to
	// a zero-quantity result for a non-positive equity input.
	if equity <= 0 {
		return 0, 0, 0, 0, grpcstatus.Errorf(codes.FailedPrecondition, "cannot size position: equity must be positive, got %v", equity)
	}

	mdCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()

	now := time.Now()
	barsResp, err := s.marketdata.GetBars(mdCtx, &marketdatav1.GetBarsRequest{
		Symbol: req.Symbol,
		Range: &commonv1.TimeRange{
			Start: timestamppb.New(now.Add(-45 * 24 * time.Hour)),
			End:   timestamppb.New(now),
		},
		Page:          &commonv1.PageRequest{PageSize: 40},
		TimeframeEnum: commonv1.Timeframe_TIMEFRAME_1DAY,
	})
	if err != nil {
		return 0, 0, 0, 0, grpcstatus.Errorf(codes.FailedPrecondition, "fetch bars for %s: %v", req.Symbol, err)
	}
	if len(barsResp.Bars) < 15 {
		return 0, 0, 0, 0, grpcstatus.Errorf(codes.FailedPrecondition,
			"insufficient bar history for %s: got %d bars, need at least 15", req.Symbol, len(barsResp.Bars))
	}
	// Bars are returned chronological ascending (oldest first); take the most recent 15.
	recentBars := barsResp.Bars[len(barsResp.Bars)-15:]
	atr, err := wilderATR(recentBars, 14)
	if err != nil {
		return 0, 0, 0, 0, grpcstatus.Errorf(codes.FailedPrecondition, "compute ATR for %s: %v", req.Symbol, err)
	}

	quote, err := s.marketdata.GetLatestQuote(mdCtx, &marketdatav1.GetLatestQuoteRequest{Symbol: req.Symbol})
	if err != nil {
		return 0, 0, 0, 0, grpcstatus.Errorf(codes.FailedPrecondition, "fetch quote for %s: %v", req.Symbol, err)
	}
	switch {
	case quote.AskPrice > 0 && quote.BidPrice > 0:
		currentPrice = (quote.AskPrice + quote.BidPrice) / 2
	case quote.AskPrice > 0:
		currentPrice = quote.AskPrice
	case quote.BidPrice > 0:
		currentPrice = quote.BidPrice
	default:
		return 0, 0, 0, 0, grpcstatus.Errorf(codes.FailedPrecondition, "no usable quote price for %s", req.Symbol)
	}

	maxRiskPct := s.cfgW.GetFloat("trading.risk.max_risk_per_trade_pct", 0.02)
	atrMultiplier := s.cfgW.GetFloat("trading.risk.atr_multiplier", 1.5)
	maxConcentrationPct := s.cfgW.GetFloat("trading.risk.max_concentration_pct", 0.10)

	dollarRiskBudget := equity * maxRiskPct * confidence
	stopDistance := atrMultiplier * atr
	if stopDistance <= 0 {
		return 0, 0, 0, 0, grpcstatus.Errorf(codes.FailedPrecondition, "computed stop distance for %s is non-positive", req.Symbol)
	}
	rawQty := math.Floor(dollarRiskBudget / stopDistance)

	finalQty := rawQty
	if finalQty*currentPrice > equity*maxConcentrationPct {
		finalQty = math.Floor(equity * maxConcentrationPct / currentPrice)
	}

	// Direction-aware stop: BUY (long) stops below current price, SELL (short) stops above.
	if req.Side == tradingv1.OrderSide_ORDER_SIDE_SELL {
		stopPrice = currentPrice + stopDistance
	} else {
		stopPrice = currentPrice - stopDistance
	}
	dollarRisk = finalQty * stopDistance

	slog.Info("computed position size",
		"symbol", req.Symbol, "sized_qty", finalQty, "stop_price", stopPrice, "dollar_risk", dollarRisk,
		"equity", equity, "confidence", confidence,
		"max_risk_per_trade_pct", maxRiskPct, "atr_multiplier", atrMultiplier, "max_concentration_pct", maxConcentrationPct,
	)

	return finalQty, dollarRisk, stopPrice, currentPrice, nil
}

// ── Bracket state machine (feature 030) ─────────────────────────────────────────

// bracketStatus values match trading.order_brackets' status SMALLINT encoding
// (migration 005) and design.md's state diagram: NONE→SUBMITTING→PENDING_VERIFY→
// ACTIVE→CANCELING→CANCELED, with a FAILED terminal on any submission error.
const (
	bracketStatusNone int32 = iota
	bracketStatusSubmitting
	bracketStatusPendingVerify //nolint:unused // reserved for a future broker-readback verification step; not written by this feature's first cut
	bracketStatusActive
	bracketStatusCanceling
	bracketStatusCanceled
	bracketStatusFailed
)

// oppositeSide returns the broker side string that closes (never extends) a position
// opened with the given entry side — "sell" to close a long, "buy" to close a short.
func oppositeSide(s tradingv1.OrderSide) string {
	if s == tradingv1.OrderSide_ORDER_SIDE_SELL {
		return "buy"
	}
	return "sell"
}

// computeTakeProfitPriceFromRR is the pure core of FR-2's take-profit formula
// (extracted, like feature 101's computeStaleThreshold, so it's directly
// unit-testable across every rr value — config.Watcher has no exported snapshot
// setter, so a live s.cfgW read can only ever be tested against its code default).
// Direction-aware off side: BUY (long) profits above entry, SELL (short) profits
// below. rr<=0 disables the leg (returns 0).
func computeTakeProfitPriceFromRR(side tradingv1.OrderSide, stopPrice, entryPriceProxy, rr float64) float64 {
	if rr <= 0 {
		return 0
	}
	if side == tradingv1.OrderSide_ORDER_SIDE_SELL {
		return entryPriceProxy - (stopPrice-entryPriceProxy)*rr
	}
	return entryPriceProxy + (entryPriceProxy-stopPrice)*rr
}

// computeTakeProfitPrice reads the live trading.risk.take_profit_rr_multiple config
// key and delegates to computeTakeProfitPriceFromRR. Shared by the entry-submission
// call site (Alpaca's atomic attach needs it before the fill is even known) and
// maybeSubmitBracket (recomputes the same deterministic value from the same
// inputs — pure given a fixed rr, safe to call twice).
func (s *TradingService) computeTakeProfitPrice(side tradingv1.OrderSide, stopPrice, entryPriceProxy float64) float64 {
	rr := s.cfgW.GetFloat("trading.risk.take_profit_rr_multiple", 2.0)
	return computeTakeProfitPriceFromRR(side, stopPrice, entryPriceProxy, rr)
}

// bracketUpdatedPayload builds the order.bracket_updated ledger event payload (Step 9
// Instruction 6). An empty stopLegID/takeProfitLegID means "cleared" — portfolio's
// consumer (Step 20) treats an empty string as null-out, not "leave unchanged".
func bracketUpdatedPayload(order *tradingv1.Order, stopLegID, takeProfitLegID string) map[string]interface{} {
	return map[string]interface{}{
		"user_id": order.UserId, "account_id": order.AccountId, "symbol": order.Symbol,
		"trading_mode":  order.TradingMode.String(),
		"stop_order_id": stopLegID, "take_profit_order_id": takeProfitLegID,
	}
}

// emitBracketFailureAlert pages the operator immediately on any bracket-submission
// failure (FR-6) — the position filled but is not protected. Body always includes the
// order ID (never empty, per notify's non-empty-body validation).
func (s *TradingService) emitBracketFailureAlert(ctx context.Context, order *tradingv1.Order, reason string) {
	_, err := s.notify.EmitAlert(ctx, &notifyv1.EmitAlertRequest{
		Severity: notifyv1.AlertSeverity_ALERT_SEVERITY_CRITICAL,
		Category: "bracket",
		Title:    fmt.Sprintf("Bracket order failed: %s %s x%.2f", order.Side.String(), order.Symbol, order.Qty),
		Body: fmt.Sprintf("Order %s (%s %s qty %.2f, intended stop %.4f): %s",
			order.OrderId, order.Side.String(), order.Symbol, order.Qty, order.StopPrice, reason),
		SourceService: "xstockstrat-trading",
		TargetUserId:  order.UserId,
	})
	if err != nil {
		slog.Warn("emit bracket failure alert failed", "order_id", order.OrderId, "error", err)
	}
}

// maybeSubmitBracket creates (or, for an IBKR position that fills incrementally,
// resizes) a stop-loss/take-profit bracket for an auto-sized MARKET/LIMIT entry order
// once a fill is confirmed (feature 030). No-op when stopPrice<=0 — order.StopPrice
// is only ever nonzero here for an auto-sized MARKET/LIMIT entry (023's order
// construction); a real STOP/STOP_LIMIT broker-trigger price is never mistaken for
// this, since those order types never reach this call site (see the two call sites'
// own order-type guard) — or when bracket orders are disabled.
//
// bracketOrdersEnabled is resolved by the caller (trading.risk.bracket_orders_enabled)
// rather than read internally — a deliberate deviation, mirroring 023's needSizing/
// sizingEnabled hoisting and 101's computeStaleThreshold extraction: config.Watcher
// has no exported snapshot setter, so hoisting the read is what makes the disabled
// branch (TestMaybeSubmitBracket_BracketOrdersDisabled) actually testable.
func (s *TradingService) maybeSubmitBracket(ctx context.Context, order *tradingv1.Order, accountEntry brokerPoolEntry, brokerOrder *broker.BrokerOrder, stopPrice, entryPriceProxy float64, bracketOrdersEnabled bool) {
	if stopPrice <= 0 || !bracketOrdersEnabled {
		return
	}

	existing, err := s.bracketRepo.GetBracketByOrderID(ctx, order.OrderId)
	if err != nil {
		slog.Warn("bracket lookup failed", "order_id", order.OrderId, "error", err)
		return
	}

	takeProfitPrice := s.computeTakeProfitPrice(order.Side, stopPrice, entryPriceProxy)
	deadline := time.Now().Add(time.Duration(s.cfgW.GetInt("trading.risk.max_unprotected_seconds", 30)) * time.Second)

	switch {
	case existing == nil:
		s.createBracket(ctx, order, accountEntry, brokerOrder, stopPrice, takeProfitPrice, deadline)
	case existing.Status == bracketStatusActive &&
		commonv1.BrokerType(accountEntry.brokerType) == commonv1.BrokerType_BROKER_TYPE_IBKR:
		// Partial-fill resize (design.md's "explicitly resized on each subsequent
		// partial-fill delta") — IBKR only; Alpaca's native bracket resizes itself and
		// is only ever read back via GetOrder, never re-submitted.
		s.resizeBracket(ctx, order, accountEntry, existing, stopPrice, takeProfitPrice, deadline)
	default:
		// Already SUBMITTING/PENDING_VERIFY/CANCELING/FAILED/CANCELED, or an Alpaca
		// ACTIVE bracket — nothing further to do at this hook.
	}
}

// createBracket is maybeSubmitBracket's fresh-bracket path: persist the row first
// (SUBMITTING), then dispatch by broker. A row-creation failure is itself a
// bracket-submission failure per FR-6's literal wording and must page the operator.
func (s *TradingService) createBracket(ctx context.Context, order *tradingv1.Order, accountEntry brokerPoolEntry, brokerOrder *broker.BrokerOrder, stopPrice, takeProfitPrice float64, deadline time.Time) {
	rec := &repository.OrderBracketRecord{
		OrderID: order.OrderId, AccountID: order.AccountId, BrokerType: int32(order.BrokerType),
		Status: bracketStatusSubmitting, BracketStopPrice: stopPrice,
		BracketTakeProfitPrice: &takeProfitPrice, ProtectionDeadline: deadline,
	}
	if err := s.bracketRepo.CreateBracket(ctx, rec); err != nil {
		slog.Warn("create bracket failed", "order_id", order.OrderId, "error", err)
		go s.emitBracketFailureAlert(context.Background(), order, fmt.Sprintf("bracket row creation failed: %v", err))
		return
	}

	switch commonv1.BrokerType(accountEntry.brokerType) {
	case commonv1.BrokerType_BROKER_TYPE_ALPACA:
		// Bracket already attached atomically at entry SubmitOrder (PlaceOrder's own
		// broker-submission statement) — just record the leg IDs the broker returned.
		if err := s.bracketRepo.UpdateBracketStatus(ctx, rec.ID, bracketStatusActive, brokerOrder.StopLegOrderID, brokerOrder.TakeProfitLegOrderID, ""); err != nil {
			slog.Warn("update bracket status failed", "order_id", order.OrderId, "error", err)
		}
		go s.emitLedgerEvent(context.Background(), "order.bracket_updated", order.OrderId,
			bracketUpdatedPayload(order, brokerOrder.StopLegOrderID, brokerOrder.TakeProfitLegOrderID))
	case commonv1.BrokerType_BROKER_TYPE_IBKR:
		resp, err := accountEntry.client.SubmitBracketLegs(ctx, order.BrokerOrderId, order.ClientOrderId, broker.BracketLegsRequest{
			Symbol: order.Symbol, Side: oppositeSide(order.Side), Qty: order.FilledQty,
			StopPrice: stopPrice, TakeProfitPrice: takeProfitPrice, TimeInForce: "day",
		})
		if err != nil {
			if uerr := s.bracketRepo.UpdateBracketStatus(ctx, rec.ID, bracketStatusFailed, "", "", err.Error()); uerr != nil {
				slog.Warn("update bracket status (failed) failed", "order_id", order.OrderId, "error", uerr)
			}
			go s.emitBracketFailureAlert(context.Background(), order, fmt.Sprintf("bracket leg submission failed: %v", err))
			return
		}
		if err := s.bracketRepo.UpdateBracketStatus(ctx, rec.ID, bracketStatusActive, resp.StopLegOrderID, resp.TakeProfitLegOrderID, ""); err != nil {
			slog.Warn("update bracket status failed", "order_id", order.OrderId, "error", err)
		}
		go s.emitLedgerEvent(context.Background(), "order.bracket_updated", order.OrderId,
			bracketUpdatedPayload(order, resp.StopLegOrderID, resp.TakeProfitLegOrderID))
	}
}

// resizeBracket is maybeSubmitBracket's IBKR partial-fill-resize path (design.md:
// "re-armed... at every transition that leaves ACTIVE, not just the initial one"):
// cancel both existing legs (best-effort), resubmit with the new cumulative filled
// quantity, and re-arm protection_deadline at this transition too.
func (s *TradingService) resizeBracket(ctx context.Context, order *tradingv1.Order, accountEntry brokerPoolEntry, existing *repository.OrderBracketRecord, stopPrice, takeProfitPrice float64, deadline time.Time) {
	if err := s.bracketRepo.UpdateBracketStatus(ctx, existing.ID, bracketStatusCanceling, existing.StopLegOrderID, existing.TakeProfitLegOrderID, ""); err != nil {
		slog.Warn("update bracket status (canceling) failed", "order_id", order.OrderId, "error", err)
	}
	if existing.StopLegOrderID != "" {
		if err := accountEntry.client.CancelOrder(ctx, existing.StopLegOrderID); err != nil {
			slog.Warn("cancel stop leg failed during resize", "order_id", order.OrderId, "leg_id", existing.StopLegOrderID, "error", err)
		}
	}
	if existing.TakeProfitLegOrderID != "" {
		if err := accountEntry.client.CancelOrder(ctx, existing.TakeProfitLegOrderID); err != nil {
			slog.Warn("cancel take-profit leg failed during resize", "order_id", order.OrderId, "leg_id", existing.TakeProfitLegOrderID, "error", err)
		}
	}
	if err := s.bracketRepo.UpdateBracketStatus(ctx, existing.ID, bracketStatusSubmitting, "", "", ""); err != nil {
		slog.Warn("update bracket status (submitting, resize) failed", "order_id", order.OrderId, "error", err)
	}
	if err := s.bracketRepo.ReArmProtection(ctx, existing.ID, deadline); err != nil {
		slog.Warn("rearm protection failed during resize", "order_id", order.OrderId, "error", err)
	}

	resp, err := accountEntry.client.SubmitBracketLegs(ctx, order.BrokerOrderId, order.ClientOrderId, broker.BracketLegsRequest{
		Symbol: order.Symbol, Side: oppositeSide(order.Side), Qty: order.FilledQty,
		StopPrice: stopPrice, TakeProfitPrice: takeProfitPrice, TimeInForce: "day",
	})
	if err != nil {
		if uerr := s.bracketRepo.UpdateBracketStatus(ctx, existing.ID, bracketStatusFailed, "", "", err.Error()); uerr != nil {
			slog.Warn("update bracket status (failed, resize) failed", "order_id", order.OrderId, "error", uerr)
		}
		go s.emitBracketFailureAlert(context.Background(), order, fmt.Sprintf("bracket resize failed: %v", err))
		return
	}
	if err := s.bracketRepo.UpdateBracketStatus(ctx, existing.ID, bracketStatusActive, resp.StopLegOrderID, resp.TakeProfitLegOrderID, ""); err != nil {
		slog.Warn("update bracket status (active, resize) failed", "order_id", order.OrderId, "error", err)
	}
	go s.emitLedgerEvent(context.Background(), "order.bracket_updated", order.OrderId,
		bracketUpdatedPayload(order, resp.StopLegOrderID, resp.TakeProfitLegOrderID))
}

// tradingState is the richer platform.trading_state enum (feature 100), independent of
// and parallel to platform.maintenance_mode.
type tradingState int

const (
	tradingStateActive tradingState = iota
	tradingStateReduceOnly
	tradingStateHalted
)

// parseTradingState maps the raw config string to a tradingState. Unrecognized or empty
// values fail to HALTED — the maximally conservative state — per design.md § Chosen Approach.
func parseTradingState(raw string) tradingState {
	switch raw {
	case "ACTIVE":
		return tradingStateActive
	case "REDUCE_ONLY":
		return tradingStateReduceOnly
	default: // "HALTED", "", or any unrecognized literal
		return tradingStateHalted
	}
}

// currentTradingState reads platform.trading_state live. The GetString default of "HALTED"
// (not "ACTIVE") means an unseeded/unreachable key fails closed, matching parseTradingState's
// own fail-closed default for an unrecognized value.
func (s *TradingService) currentTradingState() tradingState {
	return parseTradingState(s.cfgW.GetString("platform.trading_state", "HALTED"))
}

// isExposureIncreasing reports whether an order on the given side increases net exposure
// given the account's existing position qty in that symbol (0 = flat). A flat account
// increasing in either direction; a long position increases only on BUY; a short position
// increases only on SELL.
func isExposureIncreasing(side tradingv1.OrderSide, existingQty float64) bool {
	switch {
	case existingQty == 0:
		return true
	case existingQty > 0:
		return side == tradingv1.OrderSide_ORDER_SIDE_BUY
	default:
		return side == tradingv1.OrderSide_ORDER_SIDE_SELL
	}
}

// isReplaceRiskReducing reports whether a ReplaceOrder request is safe under REDUCE_ONLY:
// requestedQty == 0 means "leave qty unchanged" (trading.go:482's existing convention) —
// never exposure-increasing. Otherwise safe only when the new qty is <= the current qty.
func isReplaceRiskReducing(currentQty, requestedQty float64) bool {
	if requestedQty == 0 {
		return true
	}
	return requestedQty <= currentQty
}

// checkTradingStateForPlaceOrder blocks PlaceOrder when platform.trading_state is HALTED,
// or when it is REDUCE_ONLY and the order would increase exposure. REDUCE_ONLY fails
// closed on any GetPosition error (not just NotFound) — this gate is the enforcement
// point, not an advisory warning (design.md § Chosen Approach, a deliberate divergence
// from checkPortfolioRisk's fail-open philosophy).
func (s *TradingService) checkTradingStateForPlaceOrder(ctx context.Context, userID, symbol string, mode commonv1.TradingMode, side tradingv1.OrderSide) error {
	switch s.currentTradingState() {
	case tradingStateActive:
		return nil
	case tradingStateHalted:
		return grpcstatus.Errorf(codes.FailedPrecondition, "trading halted: platform.trading_state=HALTED")
	default: // REDUCE_ONLY
		posCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
		defer cancel()
		posCtx = metadata.AppendToOutgoingContext(posCtx, "x-user-id", userID)
		pos, err := s.portfolio.GetPosition(posCtx, &portfoliov1.GetPositionRequest{
			Symbol: symbol, TradingMode: mode,
		})
		if err != nil {
			if grpcstatus.Code(err) == codes.NotFound {
				return grpcstatus.Errorf(codes.FailedPrecondition,
					"trading reduce-only: no existing position in %s; order would increase exposure", symbol)
			}
			return grpcstatus.Errorf(codes.Unavailable,
				"trading reduce-only: unable to verify risk-reducing status for %s: %v", symbol, err)
		}
		if isExposureIncreasing(side, pos.Qty) {
			return grpcstatus.Errorf(codes.FailedPrecondition,
				"trading reduce-only: order for %s would increase exposure", symbol)
		}
		return nil
	}
}

// checkTradingStateForReplace mirrors checkTradingStateForPlaceOrder for ReplaceOrder,
// using a pure local qty comparison instead of a GetPosition call (the order's own current
// qty is already loaded — no cross-service call needed).
func (s *TradingService) checkTradingStateForReplace(order *tradingv1.Order, req *tradingv1.ReplaceOrderRequest) error {
	switch s.currentTradingState() {
	case tradingStateActive:
		return nil
	case tradingStateHalted:
		return grpcstatus.Errorf(codes.FailedPrecondition, "trading halted: platform.trading_state=HALTED")
	default: // REDUCE_ONLY
		if !isReplaceRiskReducing(order.Qty, req.Qty) {
			return grpcstatus.Errorf(codes.FailedPrecondition,
				"trading reduce-only: replace on order %s would increase size", req.OrderId)
		}
		return nil
	}
}

// resolveTradingMode determines the effective trading mode.
// Priority: explicit request field > live config key > env var default.
func (s *TradingService) resolveTradingMode(requested commonv1.TradingMode) commonv1.TradingMode {
	if requested != commonv1.TradingMode_TRADING_MODE_UNSPECIFIED {
		return requested
	}
	paper := s.cfgW.GetBool("trading.broker.paper", s.cfg.TradingMode == "paper")
	if paper {
		return commonv1.TradingMode_TRADING_MODE_PAPER
	}
	return commonv1.TradingMode_TRADING_MODE_LIVE
}

// buildBrokerRequest translates a PlaceOrderRequest into the normalized broker.OrderRequest.
func (s *TradingService) buildBrokerRequest(req *tradingv1.PlaceOrderRequest) broker.OrderRequest {
	sideMap := map[tradingv1.OrderSide]string{
		tradingv1.OrderSide_ORDER_SIDE_BUY:  "buy",
		tradingv1.OrderSide_ORDER_SIDE_SELL: "sell",
	}
	typeMap := map[tradingv1.OrderType]string{
		tradingv1.OrderType_ORDER_TYPE_MARKET:        "market",
		tradingv1.OrderType_ORDER_TYPE_LIMIT:         "limit",
		tradingv1.OrderType_ORDER_TYPE_STOP:          "stop",
		tradingv1.OrderType_ORDER_TYPE_STOP_LIMIT:    "stop_limit",
		tradingv1.OrderType_ORDER_TYPE_TRAILING_STOP: "trailing_stop",
	}

	tif := req.TimeInForce
	if tif == "" {
		tif = "day"
	}

	return broker.OrderRequest{
		Symbol:       req.Symbol,
		Qty:          req.Qty,
		Side:         sideMap[req.Side],
		OrderType:    typeMap[req.OrderType],
		TimeInForce:  tif,
		LimitPrice:   req.LimitPrice,
		StopPrice:    req.StopPrice,
		TrailPrice:   req.TrailPrice,
		TrailPercent: req.TrailPercent,
	}
}

// normalizeFilledQty enforces the orders-table invariant that a fully-filled order reports
// its full quantity. A FILLED order (Alpaca/IBKR) executed in full, so filled_qty must equal
// qty. Historical rows persisted before the fill-qty write guards existed — and any fill the
// poller missed across a restart (it skips terminal orders and never reloads them into memory)
// — can leave filled_qty at 0, which renders as "Filled 0" in the orders table. Coercing on
// read keeps the figure correct for every consumer without a data migration. Partial/canceled/
// expired states are left untouched: a sub-qty filled amount is legitimate there.
func normalizeFilledQty(o *tradingv1.Order) {
	if o == nil {
		return
	}
	if o.Status == tradingv1.OrderStatus_ORDER_STATUS_FILLED && o.FilledQty == 0 && o.Qty > 0 {
		o.FilledQty = o.Qty
	}
}

// alpacaStatusToProto maps broker order status strings to proto OrderStatus values.
// A broker status we recognize as transient/non-terminal — or one we don't recognize
// at all — maps to ORDER_STATUS_UNSPECIFIED, which callers must treat as "no actionable
// status change, keep reconciling" rather than overwriting the order's current status.
func alpacaStatusToProto(s string) tradingv1.OrderStatus {
	switch s {
	case "new", "accepted", "pending_new":
		return tradingv1.OrderStatus_ORDER_STATUS_NEW
	case "partially_filled":
		return tradingv1.OrderStatus_ORDER_STATUS_PARTIALLY_FILLED
	case "filled":
		return tradingv1.OrderStatus_ORDER_STATUS_FILLED
	case "canceled":
		return tradingv1.OrderStatus_ORDER_STATUS_CANCELED
	case "expired":
		return tradingv1.OrderStatus_ORDER_STATUS_EXPIRED
	case "rejected", "stopped", "suspended", "calculated":
		return tradingv1.OrderStatus_ORDER_STATUS_REJECTED
	// "done_for_day" is NOT terminal and NOT a cancellation — Alpaca reports it for a
	// `day` order at market close, then settles the order to its real terminal state
	// ("expired" or "filled") later. Mapping it to CANCELED used to freeze the order in
	// a wrong terminal status, after which the fill poller stopped reconciling and never
	// captured the eventual "expired". Treat it as UNSPECIFIED so reconciliation continues.
	case "done_for_day":
		return tradingv1.OrderStatus_ORDER_STATUS_UNSPECIFIED
	default:
		return tradingv1.OrderStatus_ORDER_STATUS_UNSPECIFIED
	}
}

// ledgerEmitTimeout bounds a single AppendEvent. gRPC keepalive already detects a
// dead transport, but a half-open connection or a server stalled mid-RPC can leave
// an unary call blocked; an explicit deadline guarantees the append surfaces as a
// logged error within the window instead of silently wedging the calling goroutine
// (which previously froze the position-sync poller with zero log output).
const ledgerEmitTimeout = 10 * time.Second

func (s *TradingService) emitLedgerEvent(ctx context.Context, eventType, streamKey string, payload map[string]interface{}) {
	p, _ := structpb.NewStruct(payload)
	emitCtx, cancel := context.WithTimeout(ctx, ledgerEmitTimeout)
	defer cancel()
	_, err := s.ledger.AppendEvent(emitCtx, &ledgerv1.AppendEventRequest{
		EventType:     eventType,
		SourceService: "xstockstrat-trading",
		StreamKey:     streamKey,
		Payload:       p,
	})
	if err != nil {
		slog.Warn("ledger emit failed", "event_type", eventType, "error", err)
	}
}

func (s *TradingService) emitApprovalAlert(ctx context.Context, order *tradingv1.Order) {
	_, err := s.notify.EmitAlert(ctx, &notifyv1.EmitAlertRequest{
		Severity:      notifyv1.AlertSeverity_ALERT_SEVERITY_WARNING,
		Category:      "approval",
		Title:         fmt.Sprintf("Order requires approval: %s %s %.2f", order.Symbol, order.Side.String(), order.Qty),
		Body:          fmt.Sprintf("Order %s exceeds approval threshold. Please review and approve.", order.OrderId),
		SourceService: "xstockstrat-trading",
		TargetUserId:  order.UserId,
	})
	if err != nil {
		slog.Warn("notify emit failed", "order_id", order.OrderId, "error", err)
	}
}

func (s *TradingService) emitFillAlert(ctx context.Context, order *tradingv1.Order) {
	_, err := s.notify.EmitAlert(ctx, &notifyv1.EmitAlertRequest{
		Severity: notifyv1.AlertSeverity_ALERT_SEVERITY_INFO,
		Category: "trade",
		Title: fmt.Sprintf("Order filled: %s %s %.2f @ %.4f",
			order.Symbol, order.Side.String(), order.Qty, order.FilledAvgPrice),
		Body: fmt.Sprintf("Order %s filled. Symbol: %s, Qty: %.2f, Avg Price: %.4f, Mode: %s",
			order.OrderId, order.Symbol, order.Qty, order.FilledAvgPrice, order.TradingMode.String()),
		SourceService: "xstockstrat-trading",
		TargetUserId:  order.UserId,
	})
	if err != nil {
		slog.Warn("notify fill alert failed", "order_id", order.OrderId, "error", err)
	}
}
