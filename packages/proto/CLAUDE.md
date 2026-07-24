# packages/proto — CLAUDE.md

<!-- context-forge:constitution-pointer:start -->
> **Constitution:** non-obvious contract-governance invariants (`common/v1`-only cross-import, deprecate-don't-delete / no `reserved`, `_UNSPECIFIED=0` as runtime "no filter", the `oneof` that distinguishes 0-from-unset) live in [`docs/context-constitution.md`](docs/context-constitution.md); defects (dead `Decimal`/`Error` types, stalled timeframe migration, closed-set strings) in [`docs/context-constitution-findings.md`](docs/context-constitution-findings.md). Inherits the root [`PLAT-*` constitution](../../docs/context-constitution.md).
<!-- context-forge:constitution-pointer:end -->

The single source of truth for all gRPC/Protobuf contracts. Governance (enum-over-string,
`_UNSPECIFIED=0`, PR + `buf lint`/`buf breaking`, `./scripts/buf-gen.sh`, the `proto-freshness` CI
gate) is documented in the root `CLAUDE.md` §Proto Contract Governance and `docs/runbooks/proto-versioning.md`.
Never Read/Grep the generated stubs under `gen/` — read the `.proto` source instead.
