package repository

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"
)

const (
	delistedListSQL        = `FROM portfolio\.watchlists w`
	delistedParentLockSQL  = `FROM portfolio\.watchlists WHERE watchlist_id = \$1 FOR NO KEY UPDATE SKIP LOCKED`
	delistedBindingLockSQL = `FROM portfolio\.watchlist_symbols\s+WHERE watchlist_id = \$1 AND symbol = ANY\(\$2\)\s+FOR UPDATE SKIP LOCKED`
	delistedDeleteSQL      = `DELETE FROM portfolio\.watchlist_symbols WHERE watchlist_id = \$1 AND symbol = ANY\(\$2\)\s+RETURNING symbol`
	delistedExpirySQL      = `DELETE FROM portfolio\.watchlist_signal_expiry WHERE watchlist_id = \$1 AND symbol = ANY\(\$2\)`
	delistedTouchSQL       = `UPDATE portfolio\.watchlists SET updated_at = now\(\) WHERE watchlist_id = \$1`
)

var delistedParentCols = []string{"user_id", "name", "system_managed"}

func delistedMock(t *testing.T) pgxmock.PgxPoolIface {
	t.Helper()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	t.Cleanup(mock.Close)
	return mock
}

func delistedTx(t *testing.T, mock pgxmock.PgxPoolIface) pgx.Tx {
	t.Helper()
	mock.ExpectBegin()
	tx, err := mock.Begin(context.Background())
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	return tx
}

func TestDelistedRemoval_EmptyInputIssuesNoQuery(t *testing.T) {
	mock := delistedMock(t)
	got, err := (&WatchlistRepo{db: mock}).RemoveDelistedFromSystemLists(context.Background(), nil)
	if err != nil || len(got) != 0 {
		t.Fatalf("got %+v, %v; want empty, nil", got, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unexpected statement: %v", err)
	}
}

func TestDelistedRemoval_ListQueryErrorIsWrapped(t *testing.T) {
	mock := delistedMock(t)
	boom := errors.New("boom")
	mock.ExpectQuery(delistedListSQL).WithArgs([]string{"KPTI"}).WillReturnError(boom)
	_, err := (&WatchlistRepo{db: mock}).RemoveDelistedFromSystemLists(context.Background(), []string{"KPTI"})
	if !errors.Is(err, boom) || err.Error() == boom.Error() {
		t.Fatalf("err = %v, want boom wrapped", err)
	}
}

func TestDelistedRemoval_ListQueryBindsOnlyGivenSymbols(t *testing.T) {
	mock := delistedMock(t)
	mock.ExpectQuery(delistedListSQL).WithArgs([]string{"KPTI"}).
		WillReturnRows(mock.NewRows([]string{"watchlist_id", "user_id", "name", "held"}))
	got, err := (&WatchlistRepo{db: mock}).RemoveDelistedFromSystemLists(context.Background(), []string{"KPTI"})
	if err != nil || len(got) != 0 {
		t.Fatalf("got %+v, %v; want empty, nil", got, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("list query not issued exactly once with [KPTI]: %v", err)
	}
}

// @AC-6
func TestDelistedRemoval_AC6_RemovesOnlyTheFlaggedSymbol(t *testing.T) {
	mock := delistedMock(t)
	tx := delistedTx(t, mock)
	mock.ExpectQuery(delistedParentLockSQL).WithArgs("wl-1").
		WillReturnRows(mock.NewRows(delistedParentCols).AddRow("u1", "Signals", true))
	mock.ExpectQuery(delistedBindingLockSQL).WithArgs("wl-1", []string{"KPTI"}).
		WillReturnRows(mock.NewRows([]string{"symbol"}).AddRow("KPTI"))
	mock.ExpectQuery(delistedDeleteSQL).WithArgs("wl-1", []string{"KPTI"}).
		WillReturnRows(mock.NewRows([]string{"symbol"}).AddRow("KPTI"))
	mock.ExpectExec(delistedExpirySQL).WithArgs("wl-1", []string{"KPTI"}).
		WillReturnResult(pgxmock.NewResult("DELETE", 1))
	mock.ExpectExec(delistedTouchSQL).WithArgs("wl-1").WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	// The list also holds AAPL, which is not in the removal set and so appears in no bind.
	got, err := removeDelistedInTx(context.Background(), tx,
		delistedList{watchlistID: "wl-1", userID: "u1", name: "Signals", held: []string{"KPTI"}})
	if err != nil {
		t.Fatalf("removeDelistedInTx: %v", err)
	}
	if !reflect.DeepEqual(got.Removed, []string{"KPTI"}) || len(got.Left) != 0 || got.Skipped {
		t.Fatalf("got %+v, want Removed=[KPTI], no Left, not Skipped", got)
	}
	if got.WatchlistID != "wl-1" || got.UserID != "u1" || got.Name != "Signals" {
		t.Fatalf("identity = %+v, want wl-1/u1/Signals", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("statements: %v", err)
	}
}

func TestDelistedRemoval_LockedParentSkipsAndLeavesEverything(t *testing.T) {
	mock := delistedMock(t)
	tx := delistedTx(t, mock)
	mock.ExpectQuery(delistedParentLockSQL).WithArgs("wl-1").WillReturnRows(mock.NewRows(delistedParentCols))

	got, err := removeDelistedInTx(context.Background(), tx,
		delistedList{watchlistID: "wl-1", userID: "u1", name: "Signals", held: []string{"KPTI", "ROKU"}})
	if err != nil {
		t.Fatalf("removeDelistedInTx: %v", err)
	}
	if !got.Skipped || len(got.Removed) != 0 || !reflect.DeepEqual(got.Left, []string{"KPTI", "ROKU"}) || got.Name != "Signals" {
		t.Fatalf("got %+v, want Skipped, Name=Signals, Left=[KPTI ROKU]", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("statements after a locked parent: %v", err)
	}
}

func TestDelistedRemoval_LockedBindingIsLeft(t *testing.T) {
	mock := delistedMock(t)
	tx := delistedTx(t, mock)
	mock.ExpectQuery(delistedParentLockSQL).WithArgs("wl-1").
		WillReturnRows(mock.NewRows(delistedParentCols).AddRow("u1", "Signals", true))
	mock.ExpectQuery(delistedBindingLockSQL).WithArgs("wl-1", []string{"KPTI", "ROKU"}).
		WillReturnRows(mock.NewRows([]string{"symbol"}).AddRow("KPTI"))
	mock.ExpectQuery(delistedDeleteSQL).WithArgs("wl-1", []string{"KPTI"}).
		WillReturnRows(mock.NewRows([]string{"symbol"}).AddRow("KPTI"))
	mock.ExpectExec(delistedExpirySQL).WithArgs("wl-1", []string{"KPTI"}).
		WillReturnResult(pgxmock.NewResult("DELETE", 0))
	mock.ExpectExec(delistedTouchSQL).WithArgs("wl-1").WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	got, err := removeDelistedInTx(context.Background(), tx,
		delistedList{watchlistID: "wl-1", userID: "u1", name: "Signals", held: []string{"KPTI", "ROKU"}})
	if err != nil {
		t.Fatalf("removeDelistedInTx: %v", err)
	}
	if !got.Skipped || !reflect.DeepEqual(got.Removed, []string{"KPTI"}) || !reflect.DeepEqual(got.Left, []string{"ROKU"}) {
		t.Fatalf("got %+v, want Removed=[KPTI] Left=[ROKU] Skipped", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("statements: %v", err)
	}
}

func TestDelistedRemoval_NoLongerSystemManagedIsNotModified(t *testing.T) {
	mock := delistedMock(t)
	tx := delistedTx(t, mock)
	mock.ExpectQuery(delistedParentLockSQL).WithArgs("wl-1").
		WillReturnRows(mock.NewRows(delistedParentCols).AddRow("u1", "Signals", false))

	got, err := removeDelistedInTx(context.Background(), tx,
		delistedList{watchlistID: "wl-1", userID: "u1", name: "Signals", held: []string{"KPTI"}})
	if err != nil {
		t.Fatalf("removeDelistedInTx: %v", err)
	}
	if len(got.Removed) != 0 || got.Skipped {
		t.Fatalf("got %+v, want nothing removed and not Skipped", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("statements after the system_managed re-check: %v", err)
	}
}
