# Promoted from feature 326 (fix-grpc-status-mapping) at launch, C-16. Do not hand-edit; scenarios are verbatim.
Feature: fix-grpc-status-mapping (bug fix)
  Regression guard: marketdata toGRPCError preserves distinct error codes instead of collapsing them to INTERNAL.

  # guards: docs/reports/2026-10-19-marketdata-togrpcerror-collapses-codes-defect.md
  @AC-1 @regression @feature-326
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
  @AC-2 @regression @feature-326
  Scenario: a raw context deadline on GetSectorHistory reaches the caller as DEADLINE_EXCEEDED
    Given the classification store returns the caller's expired context error for a non-empty symbol set
    When the GetSectorHistory gRPC handler is called with that expired context
    Then the GetSectorHistory handler returns gRPC status DEADLINE_EXCEEDED, not INTERNAL
