package service

// An in-package _test.go must never import internal/handler (import cycle with the external wire test).
// Keep this file to these two exports so external tests cannot bypass the production interceptor chain.

import (
	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"
	"github.com/xstockstrat/trading/internal/repository"
)

// NewOwnerScopeTestService builds a TradingService over repo, accounts and the given in-memory orders.
func NewOwnerScopeTestService(repo *repository.TradingRepo, accounts repository.AccountRepository, orders ...*tradingv1.Order) *TradingService {
	byID := make(map[string]*tradingv1.Order, len(orders))
	for _, o := range orders {
		byID[o.OrderId] = o
	}
	return &TradingService{repo: repo, accountRepo: accounts, orders: byID, subs: make(map[string]orderSubscriber)}
}

// BroadcastOrderForTest fans o out to the live StreamOrderUpdates subscribers.
func (s *TradingService) BroadcastOrderForTest(o *tradingv1.Order) {
	s.broadcastOrder(o)
}
