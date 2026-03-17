module github.com/xstockstrat/trading

go 1.22

require (
	connectrpc.com/connect v1.16.2
	github.com/google/uuid v1.6.0
	github.com/xstockstrat/contracts v0.0.0
	golang.org/x/net v0.25.0
	google.golang.org/grpc v1.63.2
	google.golang.org/protobuf v1.34.1
)

replace github.com/xstockstrat/contracts => ../../packages/proto/gen/go
