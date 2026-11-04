package telemetry

import (
	"context"
	"log/slog"
	"os"
	"time"

	"go.opentelemetry.io/contrib/bridges/otelslog"
	"go.opentelemetry.io/otel"
)

// WrapLogHandler fans every record out to base (stdout, unchanged) and to the OTLP log pipeline.
// It returns base untouched when telemetry is disabled or no LoggerProvider was installed.
//
// Once slog.SetDefault runs, the stdlib log package (the default OTel error sink) routes into the
// default slog handler, so an export failure would be exported again. The OTel error handler is
// therefore pointed at base only: failures reach stdout and never re-enter the OTLP pipeline.
func WrapLogHandler(base slog.Handler) slog.Handler {
	if os.Getenv("OTEL_ENABLED") != "true" || !logProviderInstalled.Load() {
		return base
	}
	otel.SetErrorHandler(otel.ErrorHandlerFunc(func(err error) {
		if err == nil || !base.Enabled(context.Background(), slog.LevelError) {
			return
		}
		rec := slog.NewRecord(time.Now(), slog.LevelError, err.Error(), 0)
		_ = base.Handle(context.Background(), rec)
	}))
	return slog.NewMultiHandler(base, otelslog.NewHandler(serviceName()))
}
