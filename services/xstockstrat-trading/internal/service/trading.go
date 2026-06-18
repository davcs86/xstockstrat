package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"sync"
	"time"

	"github.com/google/uuid"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/keepalive"
	grpcstatus "google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	ledgerv1 "github.com/xstockstrat/contracts/gen/go/ledger/v1"
	notifyv1 "github.com/xstockstrat/contracts/gen/go/notify/v1"
	portfoliov1 "github.com/xstockstrat/contracts/gen/go/portfolio/v1"
	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"
	"github.com/xstockstrat/trading/internal/broker"
	"github.com/xstockstrat/trading/internal/config"
	"github.com/xstockstrat/trading/internal/middleware"
	"github.com/xstockstrat/trading/internal/repository"
)

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
	// Multi-broker pool: key is account_id.
	brokers     map[string]brokerPoolEntry
	brokersMu   sync.RWMutex
	accountRepo repository.AccountRepository
	encKey      string // hex-encoded AES-256-GCM key
	ledger      ledgerv1.LedgerServiceClient
	notify      notifyv1.NotifyServiceClient
	// portfolio is used for pre-trade risk checks (non-blocking on failure).
	portfolio portfoliov1.PortfolioServiceClient
	// repo persists orders to trading.orders hypertable.
	repo *repository.TradingRepo
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
	return &TradingService{
		cfg:              cfg,
		cfgW:             cfgW,
		brokers:          make(map[string]brokerPoolEntry),
		accountRepo:      accountRepo,
		encKey:           encKey,
		ledger:           ledgerv1.NewLedgerServiceClient(ledgerConn),
		notify:           notifyv1.NewNotifyServiceClient(notifyConn),
		portfolio:        portfoliov1.NewPortfolioServiceClient(portfolioConn),
		repo:             repo,
		orders:           make(map[string]*tradingv1.Order),
		subs:             make(map[string]chan *tradingv1.Order),
		credStatus:       make(map[string]int32),
		credSkipLoggedAt: make(map[string]time.Time),
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

// resolveAccount returns the broker pool entry for the given accountID.
// If accountID is empty and exactly one broker is registered, that one is returned.
func (s *TradingService) resolveAccount(accountID string) (brokerPoolEntry, error) {
	s.brokersMu.RLock()
	defer s.brokersMu.RUnlock()

	if accountID != "" {
		entry, ok := s.brokers[accountID]
		if !ok {
			return brokerPoolEntry{}, grpcstatus.Errorf(codes.NotFound, "broker account %q not found in pool", accountID)
		}
		return entry, nil
	}

	if len(s.brokers) == 1 {
		for _, entry := range s.brokers {
			return entry, nil
		}
	}
	if len(s.brokers) == 0 {
		return brokerPoolEntry{}, grpcstatus.Errorf(codes.FailedPrecondition, "no broker accounts registered; call RegisterBrokerAccount first")
	}
	return brokerPoolEntry{}, grpcstatus.Errorf(codes.InvalidArgument, "multiple broker accounts registered; account_id is required")
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

	// Resolve broker account.
	accountEntry, err := s.resolveAccount(req.AccountId)
	if err != nil {
		return nil, err
	}

	// Non-blocking portfolio risk check: log warnings but never block order placement.
	s.checkPortfolioRisk(ctx, req)

	// Resolve trading mode: request field takes precedence; fall back to live config, then env.
	mode := s.resolveTradingMode(req.TradingMode)

	// Check approval thresholds from live config.
	approvalQtyThreshold := s.cfgW.GetFloat("trading.approval.require_above_qty", 500)
	approvalNotionalThreshold := s.cfgW.GetFloat("trading.approval.require_above_notional", 50000)
	requiresApproval := req.Qty > approvalQtyThreshold ||
		(req.LimitPrice > 0 && req.Qty*req.LimitPrice > approvalNotionalThreshold)

	orderID := uuid.New().String()
	orderStatus := tradingv1.OrderStatus_ORDER_STATUS_NEW
	if requiresApproval {
		orderStatus = tradingv1.OrderStatus_ORDER_STATUS_PENDING_APPROVAL
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
		UserId:        req.UserId,
		TradingMode:   mode,
		AccountId:     req.AccountId,
		BrokerType:    commonv1.BrokerType(accountEntry.brokerType),
		CreatedAt:     timestamppb.New(time.Now()),
		UpdatedAt:     timestamppb.New(time.Now()),
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
	// Forward our order ID as the broker client_order_id so a retried submission
	// (trading.order.max_retries) is de-duplicated by the broker instead of placing
	// a second order.
	brokerReq.ClientOrderID = orderID
	brokerOrder, err := accountEntry.client.SubmitOrder(ctx, brokerReq)
	if err != nil {
		order.Status = tradingv1.OrderStatus_ORDER_STATUS_REJECTED
		order.UpdatedAt = timestamppb.New(time.Now())
		go s.emitLedgerEvent(context.Background(), "order.broker_rejected", orderID, map[string]interface{}{
			"order_id": orderID, "error": err.Error(), "trading_mode": mode.String(),
		})
		_ = s.repo.UpsertOrder(context.Background(), order)
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

	// Persist updated order with broker fields.
	if err := s.repo.UpsertOrder(context.Background(), order); err != nil {
		slog.Warn("db upsert after broker submit failed", "order_id", orderID, "error", err)
	}

	go s.emitLedgerEvent(context.Background(), "order.broker_submitted", orderID, map[string]interface{}{
		"order_id": orderID, "broker_order_id": brokerOrder.BrokerOrderID,
		"broker_status": brokerOrder.Status, "trading_mode": mode.String(),
	})

	slog.Info("order submitted to broker", "order_id", orderID, "broker_order_id", brokerOrder.BrokerOrderID,
		"trading_mode", mode.String(), "broker_status", brokerOrder.Status)
	return order, nil
}

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

	// Cancel at broker if we have a broker order ID.
	if order.BrokerOrderId != "" {
		entry, resolveErr := s.resolveAccount(order.AccountId)
		if resolveErr != nil {
			slog.Warn("cancel: could not resolve broker account", "order_id", req.OrderId, "account_id", order.AccountId, "error", resolveErr)
		} else {
			if err := entry.client.CancelOrder(ctx, order.BrokerOrderId); err != nil {
				slog.Warn("broker cancel failed", "order_id", req.OrderId, "broker_order_id", order.BrokerOrderId, "error", err)
				// Continue with internal cancellation — broker may have already filled/canceled.
			}
		}
	}

	order.Status = tradingv1.OrderStatus_ORDER_STATUS_CANCELED
	order.UpdatedAt = timestamppb.New(time.Now())

	_ = s.repo.UpsertOrder(ctx, order)

	go s.emitLedgerEvent(context.Background(), "order.canceled", req.OrderId, map[string]interface{}{
		"order_id": req.OrderId, "user_id": req.UserId,
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

	if order.BrokerOrderId == "" {
		return nil, grpcstatus.Errorf(codes.FailedPrecondition,
			"order %s has no broker order id yet; cannot replace", req.OrderId)
	}

	entry, err := s.resolveAccount(order.AccountId)
	if err != nil {
		return nil, err
	}

	// Only the changed fields are sent to the broker (zero/empty = leave unchanged).
	brokerReq := broker.OrderRequest{
		Qty:         req.Qty,
		LimitPrice:  req.LimitPrice,
		StopPrice:   req.StopPrice,
		Trail:       req.Trail,
		TimeInForce: req.TimeInForce,
	}
	if _, replaceErr := entry.client.ReplaceOrder(ctx, order.BrokerOrderId, brokerReq); replaceErr != nil {
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

	_ = s.repo.UpsertOrder(ctx, order)

	go s.emitLedgerEvent(context.Background(), "order.replaced", req.OrderId, map[string]interface{}{
		"order_id": req.OrderId, "user_id": req.UserId,
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
	// Snapshot the broker pool under read lock.
	s.brokersMu.RLock()
	brokerMap := make(map[string]brokerPoolEntry, len(s.brokers))
	for id, e := range s.brokers {
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
		if newStatus == order.Status {
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

		case tradingv1.OrderStatus_ORDER_STATUS_PARTIALLY_FILLED:
			go s.emitLedgerEvent(context.Background(), "order.partially_filled", order.OrderId, map[string]interface{}{
				"order_id": order.OrderId, "symbol": order.Symbol,
				"filled_qty": order.FilledQty, "fill_price": order.FilledAvgPrice,
				"user_id": order.UserId, "trading_mode": order.TradingMode.String(),
				"account_id": order.AccountId,
			})

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
func (s *TradingService) checkPortfolioRisk(ctx context.Context, req *tradingv1.PlaceOrderRequest) {
	if req.UserId == "" {
		return
	}
	maxPositionPct := s.cfgW.GetFloat("trading.risk.max_position_pct", 0.05)
	if maxPositionPct <= 0 {
		return
	}

	riskCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()

	portfolio, err := s.portfolio.GetPortfolio(riskCtx, &portfoliov1.GetPortfolioRequest{
		UserId:      req.UserId,
		TradingMode: req.TradingMode,
	})
	if err != nil {
		slog.Warn("portfolio risk check skipped", "user_id", req.UserId, "error", err)
		return
	}

	if portfolio.Equity <= 0 {
		return
	}

	orderNotional := req.Qty * req.LimitPrice
	if orderNotional > 0 {
		pct := orderNotional / portfolio.Equity
		if pct > maxPositionPct {
			slog.Warn("order exceeds max_position_pct threshold",
				"order_id_pending", req.Symbol,
				"order_notional", orderNotional,
				"portfolio_equity", portfolio.Equity,
				"pct", pct,
				"max_pct", maxPositionPct,
			)
		}
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
