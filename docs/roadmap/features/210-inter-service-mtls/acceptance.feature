Feature: inter-service-mtls (mutual TLS + verified service identity between backends)
  As a platform operator, I want every inter-service gRPC connection mutually authenticated with verified
  per-service identity and encrypted in transit, so that trusted internal headers are honored only for
  calls from an authenticated peer service and inter-service traffic is not readable on the wire.

  @AC-1 @FR-1
  Scenario: A plaintext gRPC caller is refused in production configuration
    Given a backend gRPC server (e.g. xstockstrat-trading on :50051) configured for production mTLS enforcement
    When a client attempts a plaintext h2c connection presenting no client certificate
    Then the connection is refused at the TLS layer before any RPC is dispatched
    And no header trio (x-user-id / x-access-scope / x-trace-id) from that caller is honored

  @AC-2 @FR-1 @FR-2
  Scenario: A mutually-authenticated peer with a valid platform-issued identity is accepted
    Given xstockstrat-ui presenting a client certificate issued by the platform CA for its own service identity
    When it opens a gRPC channel to xstockstrat-trading, which verifies the client cert and presents its own server cert
    Then the handshake succeeds, both certs verify against the platform CA, and the RPC proceeds
    And the propagated x-user-id / x-access-scope / x-trace-id are honored on that authenticated channel

  @AC-3 @FR-2
  Scenario: A service cannot impersonate a different service's identity
    Given a caller presenting a valid platform-issued cert whose service identity is "xstockstrat-notify"
    When it calls an RPC that a policy restricts to a different named peer identity
    Then the peer identity is verified as "xstockstrat-notify" (not the claimed/other identity)
    And identity-scoped authorization is evaluated against the verified identity, not a forgeable header

  @AC-4 @FR-4
  Scenario: Local development runs under a documented relaxed/dev-cert mode, never reachable in prod
    Given docker-compose using the documented dev-cert (or relaxed) mode
    When the stack is brought up locally
    Then inter-service gRPC works end to end for development
    And the production configuration defaults to enforce, with the relaxed mode not selectable in the prod app spec

  @AC-5 @FR-5
  Scenario: Header-propagation semantics are unchanged beneath mTLS
    Given an authenticated mTLS channel from xstockstrat-ui through xstockstrat-trading to xstockstrat-portfolio
    When a request carries x-user-id / x-access-scope / x-trace-id
    Then the trio is propagated across the hop exactly as before mTLS (Go interceptor / Python per-method / Node AsyncLocalStorage)
    And downstream ownership/scope checks observe the same values as before this feature

  @AC-6 @FR-6 @FR-3
  Scenario: A long-lived streaming RPC survives a certificate rotation
    Given an active WatchConfig (or StreamEvents) stream over mTLS
    When the platform rotates the relevant service certificate before its expiry
    Then existing streams continue or transparently re-establish without dropping data
    And new connections use the rotated certificate with no service downtime
