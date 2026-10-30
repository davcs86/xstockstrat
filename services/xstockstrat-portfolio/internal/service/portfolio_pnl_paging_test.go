package service

import (
	"context"
	"errors"
	"math"
	"strconv"
	"sync"
	"testing"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	ledgerv1 "github.com/xstockstrat/contracts/gen/go/ledger/v1"
	portfoliov1 "github.com/xstockstrat/contracts/gen/go/portfolio/v1"
	"github.com/xstockstrat/portfolio/internal/middleware"
)

// Feature 257 — GetPnL walks every ledger page exactly once, fails closed and keeps the largest partial.

// pagingFakePageSize is independent of the requested size, so 501 events always span several pages.
const pagingFakePageSize = 200

// pagingCallCap stops a never-ending token loop from spinning past the hang guard and leaking memory.
const pagingCallCap = 100

type pagingLedger struct {
	ledgerv1.LedgerServiceClient
	events      map[string][]*ledgerv1.LedgerEvent
	failPage    map[string]int // event type → page index answered with DeadlineExceeded
	ignoreToken bool           // always serve page 1 with a non-empty token
	mu          sync.Mutex
	reqs        []*ledgerv1.QueryEventsRequest
	users       []string
}

func (f *pagingLedger) QueryEvents(ctx context.Context, req *ledgerv1.QueryEventsRequest, _ ...grpc.CallOption) (*ledgerv1.QueryEventsResponse, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.reqs) >= pagingCallCap {
		return nil, status.Error(codes.ResourceExhausted, "paging fake call cap")
	}
	f.reqs = append(f.reqs, req)
	f.users = append(f.users, middleware.FromContext(ctx).UserID)
	start := 0
	if tok := req.GetPage().GetPageToken(); tok != "" && !f.ignoreToken {
		start, _ = strconv.Atoi(tok)
	}
	if p, ok := f.failPage[req.GetEventType()]; ok && start/pagingFakePageSize == p {
		return nil, status.Error(codes.DeadlineExceeded, "ledger page deadline")
	}
	evs := f.events[req.GetEventType()]
	end := min(start+pagingFakePageSize, len(evs))
	next := ""
	if end < len(evs) {
		next = strconv.Itoa(end)
	}
	return &ledgerv1.QueryEventsResponse{
		Events: evs[start:end],
		Page:   &commonv1.PageResponse{NextPageToken: next},
	}, nil
}

func (f *pagingLedger) callsFor(eventType string) []*ledgerv1.QueryEventsRequest {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []*ledgerv1.QueryEventsRequest
	for _, r := range f.reqs {
		if r.GetEventType() == eventType {
			out = append(out, r)
		}
	}
	return out
}

func pnlEvent(t *testing.T, typ, user, orderID string, qty, filledQty, price float64) *ledgerv1.LedgerEvent {
	t.Helper()
	p, err := structpb.NewStruct(map[string]interface{}{
		"user_id": user, "symbol": "AAPL", "qty": qty, "filled_qty": filledQty, "fill_price": price,
		"trading_mode": "TRADING_MODE_PAPER", "account_id": "acc-1", "order_id": orderID,
	})
	if err != nil {
		t.Fatal(err)
	}
	return &ledgerv1.LedgerEvent{EventType: typ, Payload: p}
}

func runPagedPnL(t *testing.T, ledger *pagingLedger) (*portfoliov1.PnLResponse, error) {
	t.Helper()
	svc, mock, _ := newQuoteSvc(t, &stubMarketData{}, 0)
	mock.ExpectQuery(`FROM portfolio.positions`).WithArgs(anyArgs(3)...).WillReturnRows(mock.NewRows(positionCols))
	svc.ledger = ledger
	var resp *portfoliov1.PnLResponse
	var err error
	guard(t, func() { resp, err = svc.GetPnL(ctxWithUser(t, "u-1"), &portfoliov1.GetPnLRequest{}) })
	return resp, err
}

// alternatingFills is 501 order.filled events: buy 1 @100 / sell 1 @101, ending with a buy (250 round trips).
func alternatingFills(t *testing.T) []*ledgerv1.LedgerEvent {
	evs := make([]*ledgerv1.LedgerEvent, 0, 501)
	for i := 0; i < 501; i++ {
		qty, price := 1.0, 100.0
		if i%2 == 1 {
			qty, price = -1.0, 101.0
		}
		evs = append(evs, pnlEvent(t, "order.filled", "u-1", "o-"+strconv.Itoa(i), qty, 0, price))
	}
	return evs
}

// @AC-3: every order.filled page is folded exactly once, at 1000 per request, under the caller's identity.
func TestGetPnL_AC3_FoldsEachFillOnceAcrossPages(t *testing.T) {
	ledger := &pagingLedger{events: map[string][]*ledgerv1.LedgerEvent{"order.filled": alternatingFills(t)}}
	resp, err := runPagedPnL(t, ledger)
	if err != nil {
		t.Fatalf("GetPnL: %v", err)
	}
	if math.Abs(resp.GetRealizedPnl()-250.00) > 1e-9 {
		t.Fatalf("RealizedPnl = %v, want 250.00", resp.GetRealizedPnl())
	}
	calls := ledger.callsFor("order.filled")
	if len(calls) < 3 {
		t.Fatalf("pass-1 calls = %d, want >= 3", len(calls))
	}
	if calls[0].GetPage().GetPageToken() != "" {
		t.Fatalf("first pass-1 token = %q, want empty", calls[0].GetPage().GetPageToken())
	}
	for i, r := range calls {
		if r.GetPage().GetPageSize() != 1000 {
			t.Fatalf("pass-1 call %d PageSize = %d, want 1000", i, r.GetPage().GetPageSize())
		}
	}
	for i, u := range ledger.users {
		if u != "u-1" {
			t.Fatalf("call %d saw user %q, want u-1 (request ctx must be kept)", i, u)
		}
	}
}

// @AC-3: a ledger that returns the token it was sent fails closed instead of looping or inflating the sum.
func TestGetPnL_AC3_RepeatedTokenFailsClosed(t *testing.T) {
	ledger := &pagingLedger{events: map[string][]*ledgerv1.LedgerEvent{"order.filled": alternatingFills(t)}, ignoreToken: true}
	resp, err := runPagedPnL(t, ledger)
	if resp != nil || !errors.Is(err, ErrLedgerUnavailable) {
		t.Fatalf("want ErrLedgerUnavailable and no response, got resp=%v err=%v", resp, err)
	}
}

// @AC-6: the largest cumulative partial fill wins regardless of the order the pages serve it in.
func TestGetPnL_AC6_LargestPartialAcrossPages(t *testing.T) {
	for _, desc := range []bool{false, true} {
		name := "ascending"
		if desc {
			name = "descending"
		}
		t.Run(name, func(t *testing.T) {
			partials := make([]*ledgerv1.LedgerEvent, 0, 501)
			for i := 1; i <= 501; i++ {
				cum := float64(i)
				if desc {
					cum = float64(502 - i)
				}
				partials = append(partials, pnlEvent(t, "order.partially_filled", "u-1", "o-s", 0, -cum, 101))
			}
			ledger := &pagingLedger{events: map[string][]*ledgerv1.LedgerEvent{
				"order.filled":           {pnlEvent(t, "order.filled", "u-1", "o-b", 600, 0, 100)},
				"order.partially_filled": partials,
			}}
			resp, err := runPagedPnL(t, ledger)
			if err != nil {
				t.Fatalf("GetPnL: %v", err)
			}
			if math.Abs(resp.GetRealizedPnl()-501.00) > 1e-9 {
				t.Fatalf("RealizedPnl = %v, want 501.00", resp.GetRealizedPnl())
			}
		})
	}
}

// @AC-4: a failed page in either pass returns ErrLedgerUnavailable and no partial realized sum.
func TestGetPnL_AC4_PageErrorFailsClosed(t *testing.T) {
	fills := make([]*ledgerv1.LedgerEvent, 0, 400)
	partials := make([]*ledgerv1.LedgerEvent, 0, 400)
	for i := 0; i < 400; i++ {
		fills = append(fills, pnlEvent(t, "order.filled", "u-1", "o-"+strconv.Itoa(i), 1, 0, 100))
		partials = append(partials, pnlEvent(t, "order.partially_filled", "u-1", "p-"+strconv.Itoa(i), 0, 1, 100))
	}
	for _, eventType := range []string{"order.filled", "order.partially_filled"} {
		t.Run(eventType, func(t *testing.T) {
			ledger := &pagingLedger{
				events:   map[string][]*ledgerv1.LedgerEvent{"order.filled": fills, "order.partially_filled": partials},
				failPage: map[string]int{eventType: 1},
			}
			resp, err := runPagedPnL(t, ledger)
			if resp != nil || !errors.Is(err, ErrLedgerUnavailable) {
				t.Fatalf("want ErrLedgerUnavailable and no response, got resp=%v err=%v", resp, err)
			}
		})
	}
}
