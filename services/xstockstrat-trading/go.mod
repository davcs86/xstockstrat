module github.com/xstockstrat/trading

go 1.22

require (
	github.com/xstockstrat/contracts v0.0.0
	google.golang.org/grpc v1.63.2
	google.golang.org/protobuf v1.34.1
)

replace github.com/xstockstrat/contracts => ../../packages/proto/gen/go
