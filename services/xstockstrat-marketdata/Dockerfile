FROM golang:1.25-alpine AS builder
WORKDIR /app
COPY packages/proto/ ../../packages/proto/
COPY services/xstockstrat-marketdata/go.mod services/xstockstrat-marketdata/go.sum ./
RUN go mod download
COPY services/xstockstrat-marketdata/ .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o service ./cmd/server

FROM gcr.io/distroless/static-debian12:latest
WORKDIR /app
COPY --from=builder /app/service .
EXPOSE 50053
ENTRYPOINT ["/app/service"]
