Feature: extract-tool-ssrf-hardening (SSRF egress controls on the agent extract_* tools)
  As a platform operator, I want the agent's content-extraction tools to refuse fetches to non-public
  addresses and resist DNS-rebinding and hostile redirects, so that a prompt-injected agent session
  cannot reach internal infrastructure or exfiltrate private-network data.

  @AC-1 @FR-1
  Scenario: A fetch to the cloud-metadata address is blocked
    Given an authenticated agent session
    When it calls extract_website_content with url "http://169.254.169.254/latest/meta-data/iam/security-credentials/"
    Then the tool returns a fail-closed egress error and no HTTP request is sent to 169.254.169.254
    And no metadata content is returned to the model

  @AC-2 @FR-1
  Scenario: A fetch to an RFC1918 / loopback target is blocked
    Given an authenticated agent session
    When it calls extract_website_content with url "http://10.0.0.5:50060/" and separately "http://127.0.0.1:50051/"
    Then each call returns a fail-closed egress error before any socket is opened
    And neither internal service receives a connection

  @AC-3 @FR-2
  Scenario: A public hostname that resolves to an internal address is blocked (DNS-rebinding safe)
    Given a hostname "evil.example.com" whose DNS A record resolves to 10.1.2.3
    When the agent calls extract_website_content with url "https://evil.example.com/"
    Then the tool validates the resolved address 10.1.2.3, rejects it as non-public, and connects to nothing
    And the connection (if any is attempted on a later re-check) targets only the pinned validated address, never a re-resolved one

  @AC-4 @FR-3
  Scenario: A non-http(s) scheme is rejected
    Given an authenticated agent session
    When it calls extract_website_content with url "file:///etc/passwd" and separately "gopher://127.0.0.1:50051/_"
    Then each call is rejected fail-closed with a scheme-not-allowed error and no fetch is performed

  @AC-5 @FR-4
  Scenario: A redirect from a public URL to an internal address is blocked mid-chain
    Given a public URL "https://public.example.com/r" that returns a 302 redirect to "http://169.254.169.254/"
    When the agent calls extract_website_content with url "https://public.example.com/r"
    Then the redirect target is re-validated, rejected as non-public, and the redirect is not followed
    And the tool returns an egress error rather than metadata content

  @AC-6 @FR-4
  Scenario: A legitimate public URL is still fetched and extracted
    Given a reachable public URL "https://example.com/article" that resolves only to a public address and returns HTML within the size limit
    When the agent calls extract_website_content with that url
    Then the content is fetched and the extracted text is returned as before this feature
    And behavior for well-formed public requests is unchanged

  @AC-7 @FR-6
  Scenario: A blocked fetch does not leak internal targets and is recorded
    Given a blocked extract_* call to an internal address
    When the tool returns its error to the caller
    Then the error message contains no internal hostname, resolved IP, or port detail
    And the block is recorded on the agent's telemetry/audit path
