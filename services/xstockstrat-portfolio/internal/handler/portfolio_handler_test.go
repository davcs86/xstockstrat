package handler

import (
	"errors"
	"fmt"
	"testing"

	"connectrpc.com/connect"

	"github.com/xstockstrat/portfolio/internal/repository"
)

func TestClassifyGetPositionError_NotFound(t *testing.T) {
	got := classifyGetPositionError(repository.ErrPositionNotFound)
	if got != connect.CodeNotFound {
		t.Fatalf("got %v, want CodeNotFound", got)
	}
}

func TestClassifyGetPositionError_WrappedNotFound(t *testing.T) {
	wrapped := fmt.Errorf("get position: %w", repository.ErrPositionNotFound)
	got := classifyGetPositionError(wrapped)
	if got != connect.CodeNotFound {
		t.Fatalf("got %v, want CodeNotFound for a wrapped sentinel", got)
	}
}

func TestClassifyGetPositionError_GenericError_IsInternal(t *testing.T) {
	got := classifyGetPositionError(errors.New("db connection reset"))
	if got != connect.CodeInternal {
		t.Fatalf("got %v, want CodeInternal for a non-sentinel error", got)
	}
}
