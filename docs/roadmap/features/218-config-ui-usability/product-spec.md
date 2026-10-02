# Product Spec: config-ui-usability

**Created**: 2026-10-02

---

## Problem Statement

Operators editing runtime config in `/config-ui` hit four frictions. Picking a namespace means a
detour through a landing card grid. Key descriptions sit in a column that is hidden below `md` and
show long paragraphs unclamped. There is no indication of when a value last changed. Worst, the
inline editor yanks focus back to the value input on every keystroke typed into the reason field,
so writing a reason is close to impossible.

## User Story

As an operator editing runtime config in the config-ui, I want to switch namespaces from a dropdown
above the keys table, see a brief description and last-updated time on each row, and type into the
edit form without focus jumping, so that reviewing and changing config is fast and error-free.

## Functional Requirements

FR-1. `/config-ui` renders the env switcher, scope control, a namespace **Select** (above the keys
table), and the keys table for the selected namespace directly. There is no card grid. With no
namespace given, the default is `platform`.
FR-2. Choosing a different namespace in the Select navigates to `/config-ui/<namespace>` and keeps
the current `env` and `user` query params. The `/config-ui/[namespace]` route stays valid for deep
links and shows the same Select with that namespace pre-selected.
FR-3. Each key row shows its `description` under the key name: muted text, clamped to 2 lines, full
text available via the `title` tooltip, visible at every breakpoint. An empty description renders
no element. The separate Description column is removed.
FR-4. `config.v1.ConfigKeyMeta` gains `google.protobuf.Timestamp updated_at = 10`. `ListKeys`
populates it from `config.config_values.updated_at` of the **resolved** row (the caller's per-user
row when one exists for that key, else the global row). The change is additive and non-breaking.
FR-5. Each key row in the config-ui displays its last-updated time, formatted in the viewer's locale
with the absolute ISO timestamp in a tooltip. A row with no timestamp renders `—`.
FR-6. While editing a key, typing into the value input or the reason input never moves focus to the
other input or remounts either one. Focus stays where the operator put it until they move it.
FR-7. After a successful save, the row's displayed value and last-updated time reflect the write
(via the existing `config-keys` query invalidation). No full page reload is needed.

## Out of Scope

- Agent MCP `list_config_keys` response mapping — it stays unchanged (no `updated_at` exposure). If
  wanted, that is a separate follow-up.
- Who made the last change (the audit log page already covers history).
- Any change to `SetConfig`, `GetConfig`, `WatchConfig`, secret handling, or the DB schema.
- Fixing the namespace list itself (`KNOWN_NAMESPACES` contents) beyond moving it into a shared
  module the Select can use.

## Affected Services

- `xstockstrat-config` — `ListKeys` selects and maps `updated_at` onto `ConfigKeyMeta`.
- `xstockstrat-ui` — `/config-ui` landing page and `[namespace]` editor: Select, description
  rendering, timestamp column, focus fix.
- `packages/proto` — additive field on `ConfigKeyMeta`, plus regenerated stubs.

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui` segment `/config-ui`: the landing page becomes the namespace editor
  (Select + table), the `[namespace]` route gains the Select, and rows gain description and
  last-updated rendering. Both routes are already reachable via `PLATFORM_SUBNAV.config` (C-10).
- [ ] **Agent** — not changed (see Out of Scope).
- [ ] **None**

## Proto Contract Changes

- `packages/proto/config/v1/config.proto` — `ConfigKeyMeta`: add
  `google.protobuf.Timestamp updated_at = 10;` (additive; next free field number after
  `current_value = 9`). Regenerate stubs with `./scripts/buf-gen.sh`.

## Config Key Changes

- [x] No new config keys

## Database Changes

- [x] No schema changes. `config.config_values.updated_at` already exists (migration 001) and is
  maintained by the update trigger.

## Feature Workflow Notes

Branch to create: `feature/config-ui-usability` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking proto or config change)
- [ ] 2 service owners + platform lead (breaking proto change)
- [ ] DBA review + service owner (schema migration)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`), the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] Known trap (ledger `fails.md` 2026-08-09 shadcn-migration): wrapping full-navigation controls
  in a role-asserting Radix primitive changes their ARIA role. The namespace Select is a real
  `combobox` that triggers `router.push`, which is fine. But `e2e/config-ui/namespace-nav.spec.ts`
  asserts the card grid and must be rewritten against the Select, not deleted.
- [ ] Known trap (ledger `fails.md`, Connect-JSON fixtures): the e2e mock backend's `ListKeys`
  fixtures must encode `updatedAt` as an RFC3339 string, never epoch, and the protobuf-es browser
  type is `Timestamp {seconds: bigint, nanos}` (UI constitution).
- [ ] What happens to rows whose `updated_at` is just the seed-migration time? Proposed: show it
  as-is. It is the truthful row timestamp.
