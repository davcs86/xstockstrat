package service

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"google.golang.org/grpc/codes"
	grpcstatus "google.golang.org/grpc/status"

	commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
	tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"

	"github.com/xstockstrat/trading/internal/config"
	"github.com/xstockstrat/trading/internal/repository"
)

// ownerGateAccountRepo adds the two writes/reads a headerless caller would reach past a missing
// gate, so a regression fails on an assertion instead of a nil-interface panic.
type ownerGateAccountRepo struct {
	offlineAccountRepo
	credUpdates []string
	listed      []string
}

func (f *ownerGateAccountRepo) UpdateCredentials(_ context.Context, id string, _ []byte) error {
	f.credUpdates = append(f.credUpdates, id)
	return nil
}

func (f *ownerGateAccountRepo) ListBrokerAccounts(_ context.Context, userID string) ([]*repository.BrokerAccountRecord, error) {
	f.listed = append(f.listed, userID)
	return []*repository.BrokerAccountRecord{{ID: "acct-ownerless", UserID: ""}}, nil
}

func ownerGateService(repo repository.AccountRepository) *TradingService {
	return &TradingService{
		cfg: &config.Config{TradingMode: "paper"}, cfgW: &config.Watcher{}, platformCfgW: &config.Watcher{}, encKey: testEncKeyHex,
		accountRepo: repo, brokers: map[string]brokerPoolEntry{}, credStatus: map[string]int32{},
	}
}

func blockBrokerHTTP(t *testing.T) {
	t.Helper()
	swapDefaultTransport(t, roundTripFunc(func(r *http.Request) (*http.Response, error) {
		t.Errorf("headerless call reached the broker: %s %s", r.Method, r.URL)
		return nil, errors.New("no HTTP allowed")
	}))
}

func assertPermissionDenied(t *testing.T, err error) {
	t.Helper()
	if grpcstatus.Code(err) != codes.PermissionDenied {
		t.Fatalf("code = %v, want PermissionDenied (err: %v)", grpcstatus.Code(err), err)
	}
}

// @AC-2 — a headerless register is rejected for every broker type and nothing is persisted.
func TestRegisterBrokerAccount_HeaderlessRejected(t *testing.T) {
	ibkrBlob := `{"consumer_key":"ck","access_token":"at","access_token_secret":"ats","ibkr_account_id":"U1",` +
		`"signature_key":"sig","encryption_key":"enc","dh_prime":"dh"}`
	cases := []struct {
		name  string
		bt    commonv1.BrokerType
		creds string
	}{
		{"offline", commonv1.BrokerType_BROKER_TYPE_OFFLINE, ""},
		{"alpaca", commonv1.BrokerType_BROKER_TYPE_ALPACA, `{"api_key":"k","api_secret":"s"}`},
		{"ibkr", commonv1.BrokerType_BROKER_TYPE_IBKR, ibkrBlob},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			blockBrokerHTTP(t)
			repo := &ownerGateAccountRepo{}
			svc := ownerGateService(repo)
			_, err := svc.RegisterBrokerAccount(context.Background(), &tradingv1.RegisterBrokerAccountRequest{
				DisplayName: tc.name, BrokerType: tc.bt, CredentialsJson: tc.creds,
			}, "")
			if len(repo.created) != 0 {
				t.Errorf("headerless register persisted %d record(s), first owner %q", len(repo.created), repo.created[0].UserID)
			}
			if len(svc.brokers) != 0 {
				t.Errorf("headerless register added %d broker pool entries", len(svc.brokers))
			}
			assertPermissionDenied(t, err)
		})
	}
}

// O-7 — a headerless credential rewrite on an owner-less row is refused and never re-enters the pool.
func TestUpdateBrokerAccountCredentials_HeaderlessOnOwnerlessRowRejected(t *testing.T) {
	blockBrokerHTTP(t)
	repo := &ownerGateAccountRepo{offlineAccountRepo: offlineAccountRepo{getRec: &repository.BrokerAccountRecord{
		ID: "acct-ownerless", UserID: "", BrokerType: int32(commonv1.BrokerType_BROKER_TYPE_ALPACA), IsPaper: true,
	}}}
	svc := ownerGateService(repo)
	_, err := svc.UpdateBrokerAccountCredentials(context.Background(), "acct-ownerless", "", `{"api_key":"k","api_secret":"s"}`)
	if len(repo.credUpdates) != 0 {
		t.Errorf("headerless update rewrote credentials for %v", repo.credUpdates)
	}
	if _, ok := svc.brokers["acct-ownerless"]; ok {
		t.Error("headerless update put the owner-less account into the broker pool")
	}
	assertPermissionDenied(t, err)
}

func TestListBrokerAccountsSvc_HeaderlessRejected(t *testing.T) {
	repo := &ownerGateAccountRepo{}
	accounts, err := ownerGateService(repo).ListBrokerAccountsSvc(context.Background(), "")
	if len(repo.listed) != 0 || len(accounts) != 0 {
		t.Errorf("headerless list reached the repo (%q) and returned %d account(s)", repo.listed, len(accounts))
	}
	assertPermissionDenied(t, err)
}

func TestDeregisterBrokerAccountSvc_HeaderlessOnOwnerlessRowRejected(t *testing.T) {
	repo := &ownerGateAccountRepo{offlineAccountRepo: offlineAccountRepo{getRec: &repository.BrokerAccountRecord{
		ID: "acct-ownerless", UserID: "", BrokerType: int32(commonv1.BrokerType_BROKER_TYPE_ALPACA),
	}}}
	err := ownerGateService(repo).DeregisterBrokerAccountSvc(context.Background(), "acct-ownerless", "")
	if len(repo.deactive) != 0 {
		t.Errorf("headerless deregister deactivated %v", repo.deactive)
	}
	assertPermissionDenied(t, err)
}

// D-9 — LoadBrokerPool skips an owner-less row with one WARN and still loads the owned row.
func TestLoadBrokerPool_SkipsOwnerlessAccount(t *testing.T) {
	logs := captureLogs(t)
	offline := int32(commonv1.BrokerType_BROKER_TYPE_OFFLINE)
	repo := &fakeAccountRepo{listActiveFn: func(context.Context) ([]*repository.BrokerAccountRecord, error) {
		return []*repository.BrokerAccountRecord{
			{ID: "acct-ownerless", UserID: "", BrokerType: offline, IsPaper: true},
			{ID: "acct-owned", UserID: "user-1", BrokerType: offline, IsPaper: true},
		}, nil
	}}
	svc := &TradingService{
		cfg: &config.Config{}, cfgW: &config.Watcher{}, platformCfgW: &config.Watcher{}, encKey: testEncKeyHex, accountRepo: repo,
		brokers: map[string]brokerPoolEntry{}, credStatus: map[string]int32{},
		halted: map[string]bool{}, haltReasons: map[string]string{},
	}
	if err := svc.LoadBrokerPool(context.Background()); err != nil {
		t.Fatalf("LoadBrokerPool: %v", err)
	}
	if _, ok := svc.brokers["acct-ownerless"]; ok {
		t.Error("owner-less account was loaded into the broker pool")
	}
	if entry, ok := svc.brokers["acct-owned"]; !ok || entry.userID != "user-1" {
		t.Errorf("owned account entry = %+v (present %v), want userID user-1", entry, ok)
	}
	var warns []map[string]any
	for _, r := range logs() {
		if r["level"] == "WARN" {
			warns = append(warns, r)
		}
	}
	if len(warns) != 1 || warns[0]["msg"] != "LoadBrokerPool: account has no owner, skipping account" || warns[0]["account_id"] != "acct-ownerless" {
		t.Fatalf("WARN records = %v, want exactly one owner-less skip for acct-ownerless", warns)
	}
}
