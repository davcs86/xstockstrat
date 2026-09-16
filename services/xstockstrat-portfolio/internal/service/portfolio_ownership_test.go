package service

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	portfoliov1 "github.com/xstockstrat/contracts/gen/go/portfolio/v1"
)

// TestGetSnapshot_RejectsCrossUser proves H-3: a snapshot's portfolio_id is the owning user_id
// (snapshots are written as InsertSnapshot(userID, userID, …)), so a caller may not read another
// user's snapshot by passing that user's id as portfolio_id.
func TestGetSnapshot_RejectsCrossUser(t *testing.T) {
	s := &PortfolioService{}
	_, err := s.GetSnapshot(ctxWithUser(t, "attacker"), &portfoliov1.GetSnapshotRequest{PortfolioId: "victim"})
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Errorf("cross-user GetSnapshot: got code %v, want PermissionDenied", connect.CodeOf(err))
	}
}

// TestGetSnapshot_RejectsMissingCaller proves the fail-closed half: no x-user-id yields
// InvalidArgument (requireUserID) rather than returning any snapshot.
func TestGetSnapshot_RejectsMissingCaller(t *testing.T) {
	s := &PortfolioService{}
	_, err := s.GetSnapshot(context.Background(), &portfoliov1.GetSnapshotRequest{PortfolioId: "victim"})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Errorf("GetSnapshot with no caller: got code %v, want InvalidArgument", connect.CodeOf(err))
	}
}
