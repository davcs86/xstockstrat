package broker

// DeriveBrokerClientOrderID derives the broker-facing client-order-id from the
// platform's own order-intent ID (design.md § "PlaceOrder's intent ID — client nonce").
// Both Alpaca and IBKR receive this value via OrderRequest.ClientOrderID.
func DeriveBrokerClientOrderID(intentID string) string {
	return "xss-" + intentID
}
