package telemetry

import (
	"context"
	"time"
)

// StopServer flushes telemetry first, then stops the server gracefully, falling back to force when
// graceful does not return within gracefulTimeout. Open server streams otherwise block GracefulStop
// forever, which would starve the flush and the deferred shutdown.
func StopServer(forceFlush func(context.Context) error, graceful func(), force func(), flushTimeout, gracefulTimeout time.Duration) {
	if forceFlush != nil {
		ctx, cancel := context.WithTimeout(context.Background(), flushTimeout)
		_ = forceFlush(ctx)
		cancel()
	}

	done := make(chan struct{})
	go func() {
		graceful()
		close(done)
	}()

	timer := time.NewTimer(gracefulTimeout)
	defer timer.Stop()
	select {
	case <-done:
	case <-timer.C:
		force()
	}
}
