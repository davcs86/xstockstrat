package service_test

import (
	"context"
	"errors"
	"fmt"
	"net"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/pashagolub/pgxmock/v4"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"
	"github.com/xstockstrat/trading/internal/handler"
	"github.com/xstockstrat/trading/internal/middleware"
	"github.com/xstockstrat/trading/internal/repository"
	"github.com/xstockstrat/trading/internal/service"
	"github.com/xstockstrat/trading/internal/testdata"
)

const ownerScopeTimeout = 3 * time.Second

// ownerScopeClient serves svc over bufconn behind the production interceptor chain.
func ownerScopeClient(t *testing.T, svc *service.TradingService) tradingv1.TradingServiceClient {
	t.Helper()
	lis := bufconn.Listen(1 << 20)
	// These options mirror cmd/server/main.go's interceptor chain and must change with it.
	srv := grpc.NewServer(
		grpc.ChainUnaryInterceptor(middleware.UnaryServerInterceptor),
		grpc.ChainStreamInterceptor(middleware.StreamServerInterceptor),
	)
	tradingv1.RegisterTradingServiceServer(srv, handler.NewTradingHandler(svc).GRPCHandler())
	go func() { _ = srv.Serve(lis) }()
	t.Cleanup(srv.Stop)
	conn, err := grpc.NewClient("passthrough:///bufnet",
		grpc.WithContextDialer(func(context.Context, string) (net.Conn, error) { return lis.Dial() }),
		grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	return tradingv1.NewTradingServiceClient(conn)
}

// callCtx bounds every call; an empty userID sends no x-user-id at all.
func callCtx(t *testing.T, userID, scope string) context.Context {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), ownerScopeTimeout)
	t.Cleanup(cancel)
	if userID == "" {
		return ctx
	}
	return metadata.NewOutgoingContext(ctx, metadata.Pairs("x-user-id", userID, "x-access-scope", scope))
}

func newMockRepo(t *testing.T) (pgxmock.PgxPoolIface, *repository.TradingRepo) {
	t.Helper()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	t.Cleanup(mock.Close)
	return mock, repository.NewTradingRepoWithDB(mock)
}

// orderRowFor is testdata.NewOrderRow with its user_id column set to userID.
func orderRowFor(orderID, userID string) []any {
	row := testdata.NewOrderRow(orderID, time.Now(), 0)
	row[slices.Index(testdata.OrderRowColumns, "user_id")] = userID
	return row
}

func listOrdersReq(body string) *tradingv1.ListOrdersRequest {
	return &tradingv1.ListOrdersRequest{UserId: body} //nolint:staticcheck // regression input: the deprecated body user_id must be ignored
}

func streamOrdersReq(body string) *tradingv1.StreamOrderUpdatesRequest {
	return &tradingv1.StreamOrderUpdatesRequest{UserId: body} //nolint:staticcheck // regression input: the deprecated body user_id must be ignored
}

func wantCode(t *testing.T, err error, want codes.Code) {
	t.Helper()
	if got := status.Code(err); got != want {
		t.Fatalf("code = %v (err %v), want %v", got, err, want)
	}
}

func memOrder(id, userID string) *tradingv1.Order {
	return &tradingv1.Order{OrderId: id, UserId: userID}
}

var scopeBodyRows = []struct{ scope, body string }{{"3", ""}, {"3", "user-b"}, {"4", "user-b"}, {"4", ""}}

func TestOwnerScope_ListOrdersScopedToHeader(t *testing.T) {
	for _, tc := range scopeBodyRows {
		t.Run(fmt.Sprintf("scope=%s/body=%q", tc.scope, tc.body), func(t *testing.T) {
			mock, repo := newMockRepo(t)
			mock.ExpectQuery(`FROM trading\.orders`).WithArgs("user-a").
				WillReturnRows(pgxmock.NewRows(testdata.OrderRowColumns).AddRow(orderRowFor("oa-1", "user-a")...))
			client := ownerScopeClient(t, service.NewOwnerScopeTestService(repo, nil))

			resp, err := client.ListOrders(callCtx(t, "user-a", tc.scope), listOrdersReq(tc.body))
			if err != nil {
				t.Fatalf("ListOrders: %v", err)
			}
			if len(resp.Orders) != 1 {
				t.Fatalf("got %d orders, want 1", len(resp.Orders))
			}
			for _, o := range resp.Orders {
				if o.UserId != "user-a" {
					t.Errorf("order %s belongs to %q, want user-a", o.OrderId, o.UserId)
				}
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Errorf("repo query not scoped to the header owner: %v", err)
			}
		})
	}
}

func TestOwnerScope_ListOrdersInMemoryFallback(t *testing.T) {
	for _, body := range []string{"", "user-b"} {
		t.Run(fmt.Sprintf("body=%q", body), func(t *testing.T) {
			mock, repo := newMockRepo(t)
			mock.ExpectQuery(`FROM trading\.orders`).WithArgs("user-a").WillReturnError(errors.New("db down"))
			svc := service.NewOwnerScopeTestService(repo, nil, memOrder("oa-1", "user-a"), memOrder("ob-1", "user-b"))
			client := ownerScopeClient(t, svc)

			resp, err := client.ListOrders(callCtx(t, "user-a", "3"), listOrdersReq(body))
			if err != nil {
				t.Fatalf("ListOrders: %v", err)
			}
			if len(resp.Orders) != 1 || resp.Orders[0].UserId != "user-a" {
				t.Fatalf("got %v, want only user-a's order", resp.Orders)
			}
		})
	}
}

func TestOwnerScope_StreamOrderUpdatesScopedToHeader(t *testing.T) {
	for _, tc := range scopeBodyRows {
		t.Run(fmt.Sprintf("scope=%s/body=%q", tc.scope, tc.body), func(t *testing.T) {
			_, repo := newMockRepo(t)
			svc := service.NewOwnerScopeTestService(repo, nil)
			client := ownerScopeClient(t, svc)

			stream, err := client.StreamOrderUpdates(callCtx(t, "user-a", tc.scope), streamOrdersReq(tc.body))
			if err != nil {
				t.Fatalf("StreamOrderUpdates: %v", err)
			}
			got := make(chan *tradingv1.Order, 256)
			recvErr := make(chan error, 1)
			go func() {
				for {
					o, err := stream.Recv()
					if err != nil {
						recvErr <- err
						return
					}
					got <- o
				}
			}()
			next := func() *tradingv1.Order {
				select {
				case o := <-got:
					return o
				case err := <-recvErr:
					t.Fatalf("Recv: %v", err)
				}
				return nil
			}

			// The subscription registers asynchronously, so repeat the pair until one message lands.
			var first *tradingv1.Order
			for first == nil {
				svc.BroadcastOrderForTest(memOrder("ob-poll", "user-b"))
				svc.BroadcastOrderForTest(memOrder("oa-poll", "user-a"))
				select {
				case first = <-got:
				case err := <-recvErr:
					t.Fatalf("Recv: %v", err)
				case <-time.After(10 * time.Millisecond):
				}
			}
			svc.BroadcastOrderForTest(memOrder("ob-final", "user-b"))
			svc.BroadcastOrderForTest(memOrder("oa-final", "user-a"))
			for o := first; ; o = next() {
				if o.UserId != "user-a" {
					t.Fatalf("received %s owned by %q, want only user-a", o.OrderId, o.UserId)
				}
				if o.OrderId == "oa-final" {
					return
				}
			}
		})
	}
}

func TestHeaderless_OrderReadsRefused(t *testing.T) {
	t.Run("ListOrders", func(t *testing.T) {
		mock, repo := newMockRepo(t)
		client := ownerScopeClient(t, service.NewOwnerScopeTestService(repo, nil, memOrder("oa-1", "user-a")))
		resp, err := client.ListOrders(callCtx(t, "", ""), listOrdersReq(""))
		wantCode(t, err, codes.PermissionDenied)
		if len(resp.GetOrders()) != 0 {
			t.Errorf("delivered %d orders, want none", len(resp.GetOrders()))
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Errorf("unexpected repo state: %v", err)
		}
	})
	t.Run("GetOrder", func(t *testing.T) {
		_, repo := newMockRepo(t)
		client := ownerScopeClient(t, service.NewOwnerScopeTestService(repo, nil, memOrder("oa-1", "user-a")))
		order, err := client.GetOrder(callCtx(t, "", ""), &tradingv1.GetOrderRequest{OrderId: "oa-1"})
		wantCode(t, err, codes.PermissionDenied)
		if order != nil {
			t.Errorf("delivered order %v, want none", order)
		}
	})
	t.Run("StreamOrderUpdates", func(t *testing.T) {
		_, repo := newMockRepo(t)
		svc := service.NewOwnerScopeTestService(repo, nil)
		client := ownerScopeClient(t, svc)
		done := make(chan struct{})
		defer close(done)
		go func() {
			for {
				select {
				case <-done:
					return
				case <-time.After(10 * time.Millisecond):
					svc.BroadcastOrderForTest(memOrder("oa-1", "user-a"))
				}
			}
		}()
		stream, err := client.StreamOrderUpdates(callCtx(t, "", ""), streamOrdersReq(""))
		if err != nil {
			t.Fatalf("StreamOrderUpdates: %v", err)
		}
		order, err := stream.Recv()
		wantCode(t, err, codes.PermissionDenied)
		if order != nil {
			t.Errorf("delivered order %v, want none", order)
		}
	})
}

func TestOwnerScope_GetOrderCrossUserIsNotFound(t *testing.T) {
	for _, scope := range []string{"3", "4"} {
		t.Run("scope="+scope, func(t *testing.T) {
			mock, repo := newMockRepo(t)
			svc := service.NewOwnerScopeTestService(repo, nil, memOrder("ob-mem", "user-b"))
			client := ownerScopeClient(t, svc)
			mock.ExpectQuery(`FROM trading\.orders`).WithArgs("absent").
				WillReturnRows(pgxmock.NewRows(testdata.OrderRowColumns))
			_, err := client.GetOrder(callCtx(t, "user-a", scope), &tradingv1.GetOrderRequest{OrderId: "absent"})
			wantCode(t, err, codes.NotFound)
			absentMsg := status.Convert(err).Message()
			wantSameAsAbsent := func(id string, err error) {
				t.Helper()
				wantCode(t, err, codes.NotFound)
				if want := strings.ReplaceAll(absentMsg, "absent", id); status.Convert(err).Message() != want {
					t.Errorf("message = %q, want %q (same as an absent id)", status.Convert(err).Message(), want)
				}
			}

			_, err = client.GetOrder(callCtx(t, "user-a", scope), &tradingv1.GetOrderRequest{OrderId: "ob-mem"})
			wantSameAsAbsent("ob-mem", err)

			mock.ExpectQuery(`FROM trading\.orders`).WithArgs("ob-db").
				WillReturnRows(pgxmock.NewRows(testdata.OrderRowColumns).AddRow(orderRowFor("ob-db", "user-b")...))
			_, err = client.GetOrder(callCtx(t, "user-a", scope), &tradingv1.GetOrderRequest{OrderId: "ob-db"})
			wantSameAsAbsent("ob-db", err)

			if o, err := client.GetOrder(callCtx(t, "user-b", scope), &tradingv1.GetOrderRequest{OrderId: "ob-mem"}); err != nil || o.UserId != "user-b" {
				t.Errorf("owner in-memory read = (%v, %v), want user-b's order", o, err)
			}
			mock.ExpectQuery(`FROM trading\.orders`).WithArgs("ob-db").
				WillReturnRows(pgxmock.NewRows(testdata.OrderRowColumns).AddRow(orderRowFor("ob-db", "user-b")...))
			if o, err := client.GetOrder(callCtx(t, "user-b", scope), &tradingv1.GetOrderRequest{OrderId: "ob-db"}); err != nil || o.UserId != "user-b" {
				t.Errorf("owner repo read = (%v, %v), want user-b's order", o, err)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Errorf("repo expectations: %v", err)
			}
		})
	}
}

// fixedAccountRepo serves one broker-account record and counts writes.
type fixedAccountRepo struct {
	rec    *repository.BrokerAccountRecord
	writes int
}

func (r *fixedAccountRepo) CreateBrokerAccount(context.Context, *repository.BrokerAccountRecord) error {
	r.writes++
	return nil
}

func (r *fixedAccountRepo) ListBrokerAccounts(context.Context, string) ([]*repository.BrokerAccountRecord, error) {
	return []*repository.BrokerAccountRecord{r.rec}, nil
}

func (r *fixedAccountRepo) GetBrokerAccount(context.Context, string) (*repository.BrokerAccountRecord, error) {
	return r.rec, nil
}

func (r *fixedAccountRepo) DeactivateBrokerAccount(context.Context, string) error {
	r.writes++
	return nil
}

func (r *fixedAccountRepo) ListActiveBrokerAccounts(context.Context) ([]*repository.BrokerAccountRecord, error) {
	return []*repository.BrokerAccountRecord{r.rec}, nil
}

func (r *fixedAccountRepo) UpdateCredentials(context.Context, string, []byte) error {
	r.writes++
	return nil
}

func (r *fixedAccountRepo) UpdateCredentialStatus(context.Context, string, int32, time.Time) error {
	r.writes++
	return nil
}

func (r *fixedAccountRepo) UpdateHaltStatus(context.Context, string, bool, string, *time.Time, int32) error {
	r.writes++
	return nil
}

func TestBrokerAccountRefusals_OnTheWire(t *testing.T) {
	setup := func(t *testing.T) (*fixedAccountRepo, tradingv1.TradingServiceClient) {
		t.Helper()
		accounts := &fixedAccountRepo{rec: &repository.BrokerAccountRecord{
			ID: "acct-b", UserID: "user-b", BrokerType: int32(commonv1.BrokerType_BROKER_TYPE_OFFLINE), IsActive: true,
		}}
		_, repo := newMockRepo(t)
		return accounts, ownerScopeClient(t, service.NewOwnerScopeTestService(repo, accounts))
	}
	update := &tradingv1.UpdateBrokerAccountCredentialsRequest{AccountId: "acct-b", CredentialsJson: "{}"}
	deregister := &tradingv1.DeregisterBrokerAccountRequest{AccountId: "acct-b"}

	t.Run("non-owner Deregister", func(t *testing.T) {
		accounts, client := setup(t)
		_, err := client.DeregisterBrokerAccount(callCtx(t, "user-a", "3"), deregister)
		wantCode(t, err, codes.PermissionDenied)
		if accounts.writes != 0 {
			t.Errorf("writes = %d, want 0", accounts.writes)
		}
	})
	t.Run("non-owner UpdateCredentials", func(t *testing.T) {
		accounts, client := setup(t)
		_, err := client.UpdateBrokerAccountCredentials(callCtx(t, "user-a", "3"), update)
		wantCode(t, err, codes.PermissionDenied)
		if accounts.writes != 0 {
			t.Errorf("writes = %d, want 0", accounts.writes)
		}
	})
	t.Run("owner UpdateCredentials on OFFLINE", func(t *testing.T) {
		_, client := setup(t)
		_, err := client.UpdateBrokerAccountCredentials(callCtx(t, "user-b", "3"), update)
		wantCode(t, err, codes.FailedPrecondition)
	})
	for _, bt := range []commonv1.BrokerType{
		commonv1.BrokerType_BROKER_TYPE_ALPACA, commonv1.BrokerType_BROKER_TYPE_IBKR, commonv1.BrokerType_BROKER_TYPE_OFFLINE,
	} {
		t.Run("headerless Register "+bt.String(), func(t *testing.T) {
			accounts, client := setup(t)
			_, err := client.RegisterBrokerAccount(callCtx(t, "", ""),
				&tradingv1.RegisterBrokerAccountRequest{DisplayName: "x", BrokerType: bt, CredentialsJson: "{}"})
			wantCode(t, err, codes.PermissionDenied)
			if accounts.writes != 0 {
				t.Errorf("writes = %d, want 0 (nothing persisted)", accounts.writes)
			}
		})
	}
	t.Run("headerless UpdateCredentials", func(t *testing.T) {
		_, client := setup(t)
		_, err := client.UpdateBrokerAccountCredentials(callCtx(t, "", ""), update)
		wantCode(t, err, codes.PermissionDenied)
	})
	t.Run("headerless ListBrokerAccounts", func(t *testing.T) {
		_, client := setup(t)
		resp, err := client.ListBrokerAccounts(callCtx(t, "", ""), &tradingv1.ListBrokerAccountsRequest{})
		wantCode(t, err, codes.PermissionDenied)
		if len(resp.GetAccounts()) != 0 {
			t.Errorf("listed %d accounts, want none", len(resp.GetAccounts()))
		}
	})
	t.Run("headerless Deregister", func(t *testing.T) {
		accounts, client := setup(t)
		_, err := client.DeregisterBrokerAccount(callCtx(t, "", ""), deregister)
		wantCode(t, err, codes.PermissionDenied)
		if accounts.writes != 0 {
			t.Errorf("writes = %d, want 0", accounts.writes)
		}
	})
}
