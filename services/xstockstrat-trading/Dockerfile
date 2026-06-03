FROM golang:1.25-alpine AS builder
WORKDIR /app
COPY packages/proto/ ../../packages/proto/
COPY services/xstockstrat-trading/go.mod services/xstockstrat-trading/go.sum ./
RUN go mod download
COPY services/xstockstrat-trading/ .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o service ./cmd/server

FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=builder /app/service .
EXPOSE 50051
ENTRYPOINT ["/app/service"]
