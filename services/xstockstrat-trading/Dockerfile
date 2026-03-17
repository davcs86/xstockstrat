FROM golang:1.22-alpine AS builder
WORKDIR /app
# Copy proto gen first for caching
COPY ../../packages/proto/gen/go /proto/gen/go
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o service ./cmd/server

FROM gcr.io/distroless/static-debian12
WORKDIR /app
COPY --from=builder /app/service .
EXPOSE 50051
EXPOSE 8051
ENTRYPOINT ["/app/service"]
