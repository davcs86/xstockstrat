"""Built-in formula definitions seeded at startup (feature 063)."""

# Reserved author for platform-managed (built-in/system) formulas. These are seeded at
# startup and depended on by other services (e.g. feature 062 references the fundamentals
# scoring formula by a stable id), so UpdateFormula/DeleteFormula reject mutating them —
# even for admins — and the UI renders them read-only. No real user_id is ever this value.
SYSTEM_AUTHOR = "system"
