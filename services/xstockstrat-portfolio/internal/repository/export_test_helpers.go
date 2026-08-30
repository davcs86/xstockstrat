package repository

// ExportedPositionColumns exposes the positionColumns constant for test assertions in
// sibling packages (e.g. service/portfolio_offline_test.go AC-12 read-path parity check).
func ExportedPositionColumns() string { return positionColumns }
