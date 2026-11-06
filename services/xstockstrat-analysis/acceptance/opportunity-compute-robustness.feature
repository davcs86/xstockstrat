# Promoted from docs/roadmap/features/185-opportunity-compute-robustness/acceptance.feature at
# code-completion (Constitution C-16). Source-feature provenance on every scenario's `@feature-185` tag.
# Durable business rules xstockstrat-analysis guarantees for the opportunities compute + surgical
# read-time recovery: a data-unavailable symbol carries an explicit terminal sentinel distinct from an
# evaluated-quiet 0/N, the sentinel survives persistence, a background recompute never starves an
# interactive read, a cold read is non-blocking with a "computing" signal, a persistently-failing cold
# compute lands a terminal error, and a stale unavailable row self-heals surgically (readiness cache
# refreshed success-only). (AC-3 is the /insights render → promoted to the ui suite; AC-10 is the
# list_opportunities MCP projection → promoted to the agent suite.)

Feature: opportunity-compute-robustness (analysis-service guarantees)
  What xstockstrat-analysis guarantees for opportunity compute robustness: data-unavailable symbols are
  explicitly marked (never a misleadingly-quiet 0/0), the sentinel is persistence-stable, interactive
  reads stay responsive under a concurrent background recompute, cold/failed compute states are
  distinguishable and bounded, and unavailable rows self-heal via a surgical, cooldown-gated recompute.

  @AC-1 @FR-1 @feature-185
  Scenario: A data-unavailable symbol is marked unavailable, not evaluated-0/0
    # C-16 CHANGE (feature 289, signed off 2026-11-05): a formula-visibility refusal (NOT_FOUND / PERMISSION_DENIED)
    # is not a failed fetch; it marks formula_unreadable. Outages stay data-unavailable (@AC-4 @feature-289).
    Given a candidate symbol whose bars/indicator fetch fails during an opportunities compute
    When the queue is materialized and ListOpportunities is read
    Then that symbol's row carries the terminal data-unavailable sentinel
    And it is distinguishable from a symbol that was evaluated with 0 of N conditions passing

  @AC-2 @FR-1 @feature-185
  Scenario: An evaluated-but-not-passing symbol is NOT marked unavailable
    # C-16 CHANGE (feature 215, signed off 2026-10-09): rescoped to symbols with fundamentals available
    # (or strategies not requiring them); a fundamentals-gated strategy on an ETF/no-filings symbol is the skip row instead.
    Given a candidate symbol with fundamentals available (or a strategy not requiring them) whose bars are available and 0 of 3 conditions pass
    When the queue is materialized
    Then that symbol is classified quiet/0-of-3 (evaluated), not data-unavailable

  @AC-4 @FR-3 @feature-185
  Scenario: A background recompute does not starve an interactive read
    Given a background opportunities recompute is running its bars-fetch fan-out
    When an interactive ListOpportunities read enriches live quotes at the same time
    Then the interactive read's bars-fetch concurrency is governed by a semaphore separate from the background compute's
    And the two do not contend on the same semaphore permits

  @AC-5 @FR-1 @feature-185
  Scenario: The sentinel survives the materialization round-trip
    Given a data-unavailable candidate is written to analysis.opportunities during a compute
    When the row is read back by a later ListOpportunities without recompute
    Then the data-unavailable sentinel is still present on the row (not lost through persistence)

  @AC-6 @FR-4 @feature-185
  Scenario: A cold read is non-blocking and distinguishable from an empty universe
    Given a user who has never had opportunities materialized
    When ListOpportunities is called
    Then it returns an empty page with the "computing" pending signal set (not a synchronous compute wait)
    And a background recompute is kicked
    And a user whose universe is legitimately empty returns an empty page with "computing" NOT set

  @AC-7 @FR-4 @feature-185
  Scenario: A persistently-failing cold compute renders a terminal error, not an infinite spinner
    Given a cold user whose background recompute keeps failing
    When ListOpportunities is polled repeatedly
    Then after the bounded attempts it returns a terminal compute-failed state (not "computing" forever)

  @AC-8 @FR-5 @feature-185
  Scenario: A data-unavailable row self-heals via a surgical read-time recompute
    Given a served data-unavailable row older than the 300s retry cooldown
    When ListOpportunities is read and market data has recovered
    Then only that symbol's rows are re-fetched and re-evaluated (not the full universe)
    And the row heals in place with both conviction and signal_axis restored (signal_axis re-drained, not left 0)
    And a still-unavailable symbol has its computed_at re-stamped so it does not re-kick before the next 300s

  @AC-9 @FR-5 @feature-185
  Scenario: A recovered watchlist-entry symbol also refreshes the readiness cache
    Given a recovered symbol that participates in a watchlist x strategy entry-rule readiness
    When the surgical recovery re-evaluates it successfully
    Then the fresh readiness rows for that (symbol, strategy, entry) subset are upserted to analysis.readiness_cache
    And a symbol whose re-fetch still fails is NOT written to the readiness cache (success-only)

  # Promoted from docs/roadmap/features/289-fix-analysis-admin-formula-refusal/acceptance.feature
  # (Constitution C-16). Every @feature-289 scenario below assumes that feature's Background:
  #   Given admin user "admin-1" (x-access-scope admin) owns live strategies "s-1" and "s-2", both bound to symbol "MYSZ" (and "s-2" also to symbol "AAPL")
  #   And a component formula "f-9" of "s-1" is authored by user "user-2", while all components of "s-2" are readable by "admin-1"
  #   And the entry rule of "s-1" references "f-9"
  # "the unreadable-formula marker" is the bool formula_unreadable (Opportunity field 25, SymbolReadiness field 6; provenance token and readiness_json key "formula_unreadable").
  # (@AC-12 is not promoted: OVERLAP with @AC-8 @FR-5 @feature-185, the heal on recovery.)

  @AC-1 @FR-1 @FR-2 @regression @feature-289
  Scenario: An unreadable component formula is flagged on the opportunity row, not reported as a data outage
    Given indicators ExecuteFormula for "f-9" fails with PERMISSION_DENIED "admins cannot execute another user's formula"
    When "admin-1" computes opportunities and then lists them with the default min_conviction
    Then the "s-1" row for "MYSZ" carries the unreadable-formula marker, is not data-unavailable, and is present in the list
    And the "s-2" row for "MYSZ" is evaluated normally and is not data-unavailable
    And no log line "indicator RPC failed for MYSZ" is written

  @AC-9 @FR-3 @regression @feature-289
  Scenario: The 300-second heal does not re-stamp an unreadable row as unavailable or retry it endlessly
    Given the "MYSZ" row for "s-1" is data-unavailable and older than 300 seconds
    And the watchlist of "admin-1" holds "MYSZ" (bound to "s-1"), so its readiness verdict is also refreshed by the heal
    And indicators now answers ExecuteFormula for "f-9" with PERMISSION_DENIED
    When a read triggers the surgical per-symbol heal
    Then the row now carries the unreadable-formula marker and is no longer data-unavailable
    And the persisted watchlist readiness entry for "MYSZ" under "s-1" carries the unreadable-formula marker
    And the row is not selected by the heal on the next read (no endless 300-second retry)

  @AC-4 @FR-4 @characterization @feature-289
  Scenario: A genuine indicators outage still yields a data-unavailable row
    Given indicators ExecuteFormula for "f-9" fails with UNAVAILABLE
    When "admin-1" computes opportunities
    Then the "s-1" row for "MYSZ" has data_unavailable true and no unreadable-formula marker

  @AC-10 @FR-5 @characterization @feature-289
  Scenario: A formula execution timeout still fails the opportunities recompute
    Given indicators ExecuteFormula for a component of "s-2" responds success=false with error "Formula execution timed out after 5000ms" (not an RPC deadline)
    When "admin-1" computes opportunities
    Then the recompute fails (warning "opportunity recompute failed"), and the previously stored rows are retained, exactly as before feature 289

  @AC-15 @FR-1 @FR-6 @regression @feature-289
  Scenario: A NOT_FOUND refusal of a referenced formula also yields the marker
    Given indicators ExecuteFormula for "f-9" fails with NOT_FOUND
    When "admin-1" computes opportunities
    Then the "s-1" row for "MYSZ" carries the unreadable-formula marker, is 0 of 0, and is not data-unavailable
    And exactly one log line "formula f-9 not readable by owner" is written

  @AC-16 @FR-6 @characterization @feature-289
  Scenario: An unreferenced refused component is skipped as before
    Given indicators ExecuteFormula for "f-9" fails with NOT_FOUND and the entry rule of "s-1" does not reference "f-9"
    When "admin-1" computes opportunities
    Then the "s-1" row for "MYSZ" is evaluated normally with that component skipped, carries no unreadable-formula marker and is not data-unavailable
    And exactly one log line "formula f-9 not readable by owner" is written

  @AC-18 @FR-2 @FR-6 @regression @feature-289
  Scenario Outline: A held row keeps its signal action; an exit rule that references the refused formula never fabricates a REDUCE
    Given "admin-1" holds a position in "MYSZ" and the exit rule of "s-1" references "f-9"
    And indicators ExecuteFormula for "f-9" fails with PERMISSION_DENIED
    And the signal for "MYSZ" is <signal>
    When "admin-1" computes opportunities
    Then the "s-1" row for "MYSZ" carries the unreadable-formula marker, is 0 of 0 and has conviction 0
    And its action is <action>, its signal axis is <axis> and its composite is <composite>

    Examples:
      | signal | action | axis                     | composite    |
      | sell   | REDUCE | greater than 0 (kept)    | signal-only  |
      | none   | ADD    | 0                        | NULL         |

  @AC-21 @FR-1 @FR-2 @regression @feature-289
  Scenario: The marker round-trips storage and a sibling's outage does not flip the row
    Given the "s-1" row for "MYSZ" is computed with the unreadable-formula marker
    And a third live strategy "s-3" of "admin-1" bound to "MYSZ" shares the refused formula "f-9" while indicators is UNAVAILABLE for another component of "s-2" on "MYSZ"
    When "admin-1" lists opportunities
    Then the "s-1" and "s-3" rows for "MYSZ" carry the unreadable-formula marker and are not data-unavailable regardless of completion order
    And exactly one log line "formula f-9 not readable by owner" is written for the compute

  @AC-24 @FR-1 @FR-7 @regression @feature-289
  Scenario Outline: With the fundamentals gate on, the opportunity compute and the heal yield the marker, not data-unavailable
    Given analysis.backtest.fundamentals.enabled is true and GetFormula and ExecuteFormula for "f-9" fail with NOT_FOUND for "admin-1"
    When <path>
    Then the "s-1" row for "MYSZ" carries the unreadable-formula marker and is not data-unavailable
    And the row is not selected by the heal on the next read

    Examples:
      | path                                          |
      | "admin-1" computes opportunities               |
      | a read triggers the surgical per-symbol heal   |

  @AC-25 @FR-4 @FR-7 @characterization @feature-289
  Scenario: With the fundamentals gate on, a GetFormula outage is still data-unavailable
    Given analysis.backtest.fundamentals.enabled is true and GetFormula for "f-9" fails with UNAVAILABLE
    When "admin-1" computes opportunities
    Then the "s-1" row for "MYSZ" has data_unavailable true, no unreadable-formula marker and its action kept

  @AC-26 @FR-3 @characterization @feature-289
  Scenario: Once the formula becomes readable the next recompute evaluates the row normally
    Given the "s-1" row for "MYSZ" carries the unreadable-formula marker
    And indicators now answers ExecuteFormula for "f-9" successfully
    When the next opportunity recompute runs
    Then the "s-1" row for "MYSZ" is evaluated normally with no unreadable-formula marker
