package repository

import (
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
)

// fakeNoRowsRow simulates a pgx.Row whose Scan reports no matching row.
type fakeNoRowsRow struct{}

func (fakeNoRowsRow) Scan(dest ...any) error { return pgx.ErrNoRows }

// fakeScanErrRow simulates a genuine scan/DB failure, distinct from "no rows".
type fakeScanErrRow struct{}

func (fakeScanErrRow) Scan(dest ...any) error { return errors.New("connection reset") }

func TestScanPositionRow_NoRows_ReturnsErrPositionNotFound(t *testing.T) {
	_, err := scanPositionRow(fakeNoRowsRow{})
	if !errors.Is(err, ErrPositionNotFound) {
		t.Fatalf("expected ErrPositionNotFound, got %v", err)
	}
}

func TestScanPositionRow_OtherScanError_NotErrPositionNotFound(t *testing.T) {
	_, err := scanPositionRow(fakeScanErrRow{})
	if err == nil {
		t.Fatal("expected an error")
	}
	if errors.Is(err, ErrPositionNotFound) {
		t.Fatal("a generic scan failure must not be classified as ErrPositionNotFound")
	}
}
