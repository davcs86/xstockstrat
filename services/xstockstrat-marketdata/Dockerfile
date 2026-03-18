FROM golang:1.23-alpine AS builder
WORKDIR /app
COPY ../../packages/proto/gen/go /proto/gen/go
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o service ./cmd/server

FROM gcr.io/distroless/static-debian12
WORKDIR /app
COPY --from=builder /app/service .
EXPOSE 50053
EXPOSE 8053
ENTRYPOINT ["/app/service"]
