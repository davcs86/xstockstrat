# packages/proto — Constitution

Derived by `/context-constitution` (context-forge) on 2026-07-24. Captures the **non-obvious**
contract-governance invariants of the proto module (single source of truth for all gRPC/Protobuf
contracts). Does not restate documented/CI-enforced rules (see `## Pointers`).

> Inherits all rules of the root constitution (`../../../docs/context-constitution.md`). This file lists only
> what is specific to **packages/proto**.

## Rules (`PROTO-*`) — binding, easy-to-miss conventions

| ID | Rule | Why | Evidence | Example (canonical `path:line`) |
|---|---|---|---|---|
| **PROTO-1** | **`common/v1` is the only cross-package import — no service proto imports another service's proto.** Shared concepts are duplicated as separate messages or funneled through `common/v1`, never reused across packages. | Cross-service message reuse (e.g. importing `marketdata.Bar` or `trading.OrderSide` elsewhere) is architecturally disallowed here. | all imports are `common/v1` + google well-known (N=all 11); e.g. bespoke `analysis.proto:60` `CoverageGap` vs `common.TimeRange` | `packages/proto/common/v1/common.proto` |
| **PROTO-2** | **Never delete or renumber a field; there are no `reserved` ranges. Deprecate-don't-delete: keep dead members with `[deprecated = true]`.** | Field-number never-reuse is enforced by `buf breaking` + retaining deprecated members (the repo doesn't use `reserved`). Deleting/renumbering, or adding `reserved`, breaks the discipline. | `common.proto:82-83` (Timeframe 1MIN/5MIN kept), `trading.proto:188` (`is_paper`), `marketdata.proto:55,73` (`string timeframe [deprecated=true]`) | `packages/proto/common/v1/common.proto:82-83` |
| **PROTO-3** | **`<NAME>_UNSPECIFIED = 0` is an active runtime convention meaning "no filter / server default"** (mirrored for scalars: empty string / 0 = "no narrowing"). Give a new filter field a zero sentinel; never make UNSPECIFIED an error or a non-zero "all". | Consumers rely on the zero value as the wildcard across ~32 enums. | `trading.proto:127-128`, `portfolio.proto:114-117`, `analysis.proto:56` (`BACKTEST_STATUS_UNSPECIFIED=0`), `indicators.proto:100` | `packages/proto/trading/v1/trading.proto:127-128` |
| **PROTO-4** | **An `optional` numeric field that backs a config-governed platform default is three-way, not two-way**: unset → inherit the `<service>.<category>.default_*` config key; explicit `0` → hard-disable; explicit `N` → override. This is a stronger contract than "unset vs. `""`" (see the `account_id` gotcha below) — don't collapse it to a plain presence check. | A naive `value ?? default` (or Go zero-value) check can't tell "caller wants 0" from "caller wants the config default," silently picking the wrong one for a 0-meaning-disable field. | `analysis.proto:261` (`cooldown_days`), `:273` (`exit_cooldown_days`, "mirrors cooldown_days"), `trading.proto:110` (`confidence`, "Unset → confidence=1.0") | `packages/proto/analysis/v1/analysis.proto:261` |
| **PROTO-5** | **`ConfigKeyMeta.default_value` (field 3) and `.current_value` (field 9) are not interchangeable** — `default_value` is the seed/declared metadata `SetConfig` never touches; `current_value` is the live `value_data`. A consumer reading `default_value` for display/edit-prefill silently shows stale data after every write. | Exactly this bug shipped and was fixed in #901 (config-ui always re-displayed the seed default after a successful save, looking like a silent no-op). | `config.proto:56` (`default_value`), `:127` (`current_value`, added by commit `7b77447`) | `packages/proto/config/v1/config.proto:127` |
| **PROTO-6** | **A nullable scalar *inside a `repeated` field* needs a dedicated per-element wrapper message with a proto3 `optional` scalar** (e.g. `IndicatorValue { optional double value }`) — never a bare `google.protobuf.*Value` element. `*Value` gives presence only for a *singular* optional; as a repeated element an empty wrapper is byte- and JSON-identical to `0.0` (serializes to `0`), silently turning a gap into a real zero. | A warm-up-head / NaN / None point in an indicator series must read as "gap," not `0.0`; `repeated google.protobuf.DoubleValue` cannot express that (feature 125). Distinct from PROTO-4 (singular config-default optional). | `analysis.proto:668-684` (`NamedSeries.values` → `IndicatorValue{optional double}`, with the in-proto rationale comment) | `packages/proto/analysis/v1/analysis.proto:681` |

## Gotchas & scars

- **`#901` — `ConfigKeyMeta.default_value` vs `.current_value` (see PROTO-5).** Root cause of a real production bug: `ListKeys` only ever returned `default_value`, so config-ui's Value column and edit-prefill always re-displayed the untouched seed default after a save. Fixed by adding `current_value` (field 9). A future `ListKeys` consumer reusing the old field name would reintroduce it.
- **The field name `timeframe` denotes three different contracts**: (a) legacy `string timeframe [deprecated]` + sibling `Timeframe timeframe_enum` (marketdata Bar, ingest — 6 sites); (b) newer messages name the *enum* `timeframe`; (c) `indicators ComputeIndicatorRequest.timeframe` is a **plain non-deprecated `string`** that never migrated. Copying a neighbor can read/write the wrong type or a dead field. Evidence: `marketdata.proto:118,153`, `analysis.proto:62`, `indicators.proto:49`.
- **`config.ConfigValue` is the only `oneof` in the module** and *does* distinguish `int_val=0` from unset — so the Python "0 = default" consumer trap is a consumer choice, not a contract limit (CF-N10; see root findings). Evidence: `config.proto:49-55`.
- **`account_id` presence differs by service**: portfolio uses proto3 `optional` (7 messages) to distinguish unset from `""`; trading uses a plain field. Same logical field, different wire-presence contract. Evidence: `portfolio.proto:118,124`; `trading.proto:97,132`.

## Candidate rules (unverified)

| Candidate | Why suspected | What would confirm it |
|---|---|---|
| "Return a bare domain message for a single-object read, a `*Response` wrapper otherwise" | `PlaceOrder→Order`, `GetBackfillStatus→BackfillJob` vs `List*→*Response`; enabled by buf lint exceptions | a maintainer ruling — `ManageStrategy→StrategyDefinition` breaks the pattern |
| Free-text `string` is reserved for genuinely open/runtime-registered sets only | `source`/`event_type`/`category`/`direction` are operator-registered; `side`/`rating`/`time_in_force` are closed sets left as strings | an owner decision (the closed-set strings may be cleanup targets — see findings) |

## Pointers (already documented or CI-enforced — not restated here)

| What | Where |
|---|---|
| Every enum has `_UNSPECIFIED = 0`; prefer enums over strings | root `CLAUDE.md` §Proto Contract Governance |
| PR + `buf lint`/`buf breaking`; run `./scripts/buf-gen.sh`; `proto-freshness` CI | root `CLAUDE.md`; `packages/proto/buf.yaml:6-12` |
| buf lint = STANDARD minus `PACKAGE_DIRECTORY_MATCH`, `RPC_RESPONSE_STANDARD_NAME`, `RPC_REQUEST_RESPONSE_UNIQUE` | `packages/proto/buf.yaml:9-12` |

---
_Forged by [context-forge](https://github.com/davcs86/agent-plugins). It captures the
non-obvious — nothing here is invented; re-run `/context-constitution` to refresh after the code changes._
