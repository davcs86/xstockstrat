# sdd-execute — REPO CONVENTIONS

Conventions from `docs/runbooks/feature-workflow.md` that govern execution. Load this during a
step when you touch proto, migrations, config keys, lint, header propagation, or frontend
test mocks.

- **Branch model**: `**Development Branch**` in `feature.md` is the integration branch (PR target).
  Per-step work happens on `feature-steps/<slug>-step-<N>` sub-branches created by BRANCH SYNC. Boot
  Step B4 validates the current branch context.
- **Proto edits**: after any `.proto` change, run from `packages/proto/`:
  ```bash
  buf lint && buf breaking --against ".git#branch=<dev-branch>"
  ```
  where `<dev-branch>` is the `**Development Branch**` value from `feature.md` (parsed in Boot Step B4).
  If `buf` is not installed: fall back to `grpc_tools.protoc` (precedent:
  docs/roadmap/phase3-deviations.md) and document as deviation.
- **Migrations**: naming is `NNN_description.up.sql` + `NNN_description.down.sql`. NNN is the next
  integer after the last file found by `ls services/<name>/migrations/ | sort | tail -1`.
  **Verify a migration step offline — never start a database.** Confirm both `.up.sql` and `.down.sql`
  exist with the correct `NNN` and that `.down` reverses `.up` by inspection; the live apply/rollback
  is CI's job at deploy. A step whose `**Verification**` names `docker run postgres` / `migrate` /
  `psql`-against-a-live-DB gets the offline check substituted (logged as a deviation) — do not hang
  waiting on a container (SKILL.md Phase 3 / HARD CONSTRAINTS).
- **After proto changes**: run `./scripts/buf-gen.sh` to regenerate stubs; include generated files in
  the commit.
- **Config keys**: format is `<service-short-name>.<category>.<key>` — verify before writing.
- **Never edit applied migrations**: any applied `.up.sql` file (committed to main-dev) is immutable;
  add a new numbered migration for corrections.
- **Lint gate**: a `service` step's `**Verification**` (or its paired `test` step's) includes the
  language's lint command — Go `GOWORK=off golangci-lint run --modules-download-mode=mod`, Python
  `ruff check . && ruff format --check .`, Node/Next `pnpm run lint` (sdd-spec step-constraints §B).
  Phase 3 runs it like any other Verification; a lint/format failure on the step's own code must be
  fixed (see HARD CONSTRAINTS carve-out) and re-run before the step is marked `done`.
- **Header propagation**: any new outbound gRPC call added by a step must forward `x-user-id` /
  `x-access-scope` / `x-trace-id` via the service's existing mechanism
  (`docs/patterns/header-propagation.md`). Confirm in Phase 1 discovery; do not introduce a bare client
  that drops them.
- **Frontend test mocks (C-12)**: a step that adds/modifies `xstockstrat-ui` tests imports its
  mocked domain objects from the test-data inventory (`services/xstockstrat-ui/e2e/fixtures/`,
  auth helpers from `e2e/helpers/auth.ts`) instead of inline literals; a new domain object gets a
  fixture module + `INVENTORY.md` catalog row in the same step
  (`docs/patterns/test-data-inventory.md`; `/sdd-qa` skill).
- **Test data elsewhere (C-13)**: the same rule in any language, materialized lazily. A domain
  literal may stay inline while it has exactly **one** consumer; the **second** consumer moves it to
  the service's canonical home — Python `tests/conftest.py`, Go `internal/testdata/`, Node
  `src/__tests__/fixtures/` — in the same step. Do not create a home before a second consumer
  exists; most services should create none.

> Sequential-mode verification fallbacks live in `reference/sequential-mode.md`.
