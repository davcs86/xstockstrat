module github.com/xstockstrat/trading

go 1.23

require (
	connectrpc.com/connect v1.16.2
	github.com/google/uuid v1.6.0
	golang.org/x/net v0.25.0
	google.golang.org/grpc v1.65.0
	google.golang.org/protobuf v1.34.1
)

require (
	golang.org/x/sys v0.20.0 // indirect
	golang.org/x/text v0.15.0 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20240528184218-531527333157 // indirect
)

replace github.com/xstockstrat/contracts => ../../packages/proto
