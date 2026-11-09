package telemetry

import (
	"context"
	"errors"
	"testing"
	"time"

	"go.opentelemetry.io/otel"
)

func TestStopServerFlushesBeforeGracefulStop(t *testing.T) {
	var order []string
	StopServer(
		func(context.Context) error { order = append(order, "flush"); return nil },
		func() { order = append(order, "graceful") },
		func() { order = append(order, "force") },
		time.Second, time.Second,
	)
	if len(order) != 2 || order[0] != "flush" || order[1] != "graceful" {
		t.Fatalf("call order = %v, want [flush graceful] and no force", order)
	}
}

func TestStopServerForcesWhenGracefulNeverReturns(t *testing.T) {
	release := make(chan struct{})
	t.Cleanup(func() { close(release) })
	forced := make(chan struct{})
	start := time.Now()
	StopServer(
		func(context.Context) error { return nil },
		func() { <-release },
		func() { close(forced) },
		time.Second, 50*time.Millisecond,
	)
	select {
	case <-forced:
	default:
		t.Fatal("force was not called after gracefulTimeout")
	}
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Fatalf("StopServer took %s, want about the 50ms graceful timeout", elapsed)
	}
}

func TestStopServerToleratesNilForceFlush(t *testing.T) {
	called := false
	StopServer(nil, func() { called = true }, func() {}, time.Second, time.Second)
	if !called {
		t.Fatal("graceful was not called when forceFlush is nil")
	}
}

func TestStopServerReportsFailedFlushThroughOTelErrorHandler(t *testing.T) {
	var got error
	otel.SetErrorHandler(otel.ErrorHandlerFunc(func(err error) { got = err }))
	t.Cleanup(func() { useStdlibLogErrorHandler(t) })

	want := errors.New("flush failed")
	graceful := false
	StopServer(
		func(context.Context) error { return want },
		func() { graceful = true },
		func() {},
		time.Second, time.Second,
	)
	if !errors.Is(got, want) {
		t.Fatalf("error handler received %v, want %v", got, want)
	}
	if !graceful {
		t.Fatal("a failed flush must not skip the graceful stop")
	}
}
