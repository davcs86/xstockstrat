Feature: fix-grpc-status-mapping (bug fix)
  Regression guard for defect reports: marketdata toGRPCError collapses codes to INTERNAL;
  CreateWatchlist returns INTERNAL on a duplicate name.

  # guards: docs/reports/2026-10-19-marketdata-togrpcerror-collapses-codes-defect.md
  @AC-1 @regression
  Scenario Outline: marketdata preserves the connect error code on the gRPC boundary
    Given a marketdata handler error connect.NewError(connect.Code<connect_code>, err)
    When it is translated for the gRPC response
    Then the gRPC status code is <grpc_code>, not INTERNAL

    Examples:
      | connect_code     | grpc_code         |
      | DeadlineExceeded | DEADLINE_EXCEEDED |
      | Canceled         | CANCELLED         |
      | AlreadyExists    | ALREADY_EXISTS    |
      | Unimplemented    | UNIMPLEMENTED     |
      | Unauthenticated  | UNAUTHENTICATED   |
      | Aborted          | ABORTED           |

  # guards: docs/reports/2026-10-19-marketdata-togrpcerror-collapses-codes-defect.md
  @AC-2 @regression
  Scenario: a raw context deadline on GetSectorHistory reaches the caller as DEADLINE_EXCEEDED
    Given the GetSectorHistory service call returns context.DeadlineExceeded
    When a client calls GetSectorHistory over gRPC
    Then the client receives gRPC status DEADLINE_EXCEEDED, not INTERNAL

  # guards: docs/reports/2026-10-19-portfolio-watchlist-duplicate-returns-internal-defect.md
  @AC-3 @regression
  Scenario: creating a duplicate non-system watchlist name returns ALREADY_EXISTS
    Given user U already has a non-system watchlist named "A"
    When user U calls CreateWatchlist with name "A"
    Then the call fails with gRPC status ALREADY_EXISTS, not INTERNAL

  # guards: docs/reports/2026-10-19-portfolio-watchlist-duplicate-returns-internal-defect.md
  @AC-4 @regression
  Scenario: a non-unique-violation insert failure still returns INTERNAL
    Given the watchlist insert fails with a database error other than SQLSTATE 23505
    When user U calls CreateWatchlist with name "B"
    Then the call fails with gRPC status INTERNAL
