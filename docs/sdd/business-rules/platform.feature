# Cross-cutting / platform-wide business rules — the behavioral sibling of the PLAT-* structural
# invariants in docs/context-constitution.md. Rules that span more than one service live here;
# single-service rules live in services/xstockstrat-<svc>/acceptance/*.feature.
#
# Populated by scenario PROMOTION when a launched feature's acceptance.feature carries a cross-cutting
# guarantee (Constitution C-16). No scenarios yet — the first cross-cutting promotion seeds this file.

Feature: Platform-wide guarantees
  Cross-service behavioral rules the platform must preserve across features.
  (Empty until the first cross-cutting scenario is promoted here on launch.)
