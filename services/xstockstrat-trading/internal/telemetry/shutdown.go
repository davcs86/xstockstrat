package telemetry

import (
	"context"
	"time"

	"go.opentelemetry.io/otel"
)

// StopServer flushes telemetry first, then stops the server gracefully, falling back to force when
// graceful does not return within gracefulTimeout. Open server streams otherwise block GracefulStop
// forever, which would starve the flush and the deferred shutdown.
func StopServer(forceFlush func(context.Context) error, graceful func(), force func(), flushTimeout, gracefulTimeout time.Duration) {
	if forceFlush != nil {
		ctx, cancel := context.WithTimeout(context.Background(), flushTimeout)
		// ForceFlush returns export errors instead of reporting them, so route a failed final flush
		// through the OTel error handler (stdout-only once WrapLogHandler is installed).
		if err := forceFlush(ctx); err != nil {
			otel.Handle(err)
		}
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
