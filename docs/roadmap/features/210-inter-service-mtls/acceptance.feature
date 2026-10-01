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

  @AC-3 @FR-2 @descoped
  # DESCOPED at /sdd-design (4-round debate, operator sign-off in context.md 2026-10-01). Per-RPC
  # identity-scoped authorization bound to the verified peer cert SAN was descoped: it would be a
  # C-16 CHANGE to features 147/154 (x-internal-caller gates). This feature ships native chain+SAN
  # mutual-handshake verification (see @AC-2) but leaves those app-layer gates header-only. The
  # per-RPC impersonation defense is a documented follow-up. ID retained (C-15 append-only — never
  # renumbered); NO covering test step — exempt from the C-15 coverage check by this descope note.
  Scenario: A service cannot impersonate a different service's identity
    Given a caller presenting a valid platform-issued cert whose service identity is "xstockstrat-notify"
    When it calls an RPC that a policy restricts to a different named peer identity
    Then the peer identity is verified as "xstockstrat-notify" (not the claimed/other identity)
    And identity-scoped authorization is evaluated against the verified identity, not a forgeable header

  @AC-4 @FR-4
  # Rewritten at /sdd-design for Model B (flag-day, no toggle): dev and prod run IDENTICAL full
  # mutual mTLS — the only difference is which CA/certs load. There is no plaintext listener and no
  # verification-disabling flag in any environment; "fail-closed" is cert-material presence, not a mode.
  Scenario: mTLS is enforced identically in every environment; verification cannot be disabled
    Given docker-compose using dev certs from scripts/gen-dev-certs.sh (dev self-signed CA)
    When the stack is brought up locally
    Then inter-service gRPC works end to end over full mutual TLS for development
    And a service started without its MTLS_CERT/MTLS_KEY/MTLS_CA_CERT material fails to start (fail-closed)
    And no env var or flag exists in any configuration that disables peer verification or accepts plaintext
    And the production app spec loads production-CA certificates

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
