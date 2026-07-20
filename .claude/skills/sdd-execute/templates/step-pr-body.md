## Step <N> — <title>

Implements step <N> of feature `<slug>`.

**Files changed:** <comma-separated list from step's Files section>

**Verification:** `<verification command>` passed.

**TDD (code-bearing steps only):** red → green.
<!-- For service/test steps, include the two captures: -->
<!-- - red: `<test command>` → FAILED (<one-line: which assertion was unmet>) -->
<!-- - green: `<test command>` → PASSED (<coverage line if applicable>) -->
<!-- For docs/config/proto/proto-gen/migration steps, write: TDD: N/A (non-code-bearing). -->
<!-- For a refactor with no behavior change: red N/A — characterization test added; green passed. -->

<!-- Closing line — pick ONE based on mode: -->
<!-- default modes: --> _Merge this PR, then run `/sdd-execute <slug> next` to continue._
<!-- sequential mode (omit the line above): --> _Stacked on #<prior-step-PR> (`docs/patterns/nextjs-frontends.md §8`); auto-retargets to `<dev-branch>` when its base merges._
