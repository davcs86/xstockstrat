FROM golang:1.25-alpine AS builder
WORKDIR /app
COPY packages/proto/ ../../packages/proto/
COPY services/xstockstrat-portfolio/go.mod services/xstockstrat-portfolio/go.sum ./
RUN go mod download
COPY services/xstockstrat-portfolio/ .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o service ./cmd/server

# hadolint ignore=DL3007
FROM gcr.io/distroless/static-debian12:latest
WORKDIR /app
COPY --from=builder /app/service .
EXPOSE 50052
ENTRYPOINT ["/app/service"]
