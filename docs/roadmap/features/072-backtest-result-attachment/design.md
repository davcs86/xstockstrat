# Design: backtest-result-attachment

**Created**: 2026-07-27
**Rounds**: 3 (round 1 quick; rounds 2–3 full proposer+adversary, 2026-07-27 — gzip swap and
content-trimming both proposed and **rejected**, chosen approach unchanged in all three; corrections
adopted each round)
**Approved by**: user @ 2026-07-27
**Grounded in**: recon.md

---

## Chosen Approach

`run_backtest` returns **a list of content blocks** — a `TextContent` summary followed by **one**
`EmbeddedResource` carrying the complete result as compact JSON. The split lives entirely in
`app/tools.py` plus one new pure module; `client.run_backtest` is untouched.

### 1. Mechanism — `structured_output=False`, not `CallToolResult`

```python
@server.tool(structured_output=False)
async def run_backtest(...) -> list:
    ...
    return [TextContent(type="text", text=json.dumps(summary, indent=2)), *blocks]
```

Verified in-tree against the installed SDK (`mcp == 1.27.1`, `uv.lock:439-440`):

- `structured_output=False` short-circuits metadata construction —
  `func_metadata.py:264-265` returns `FuncMetadata(arg_model=arguments_model)`, so there is no
  output schema and no return-value validation.
- `_convert_to_content` passes a `ContentBlock` through verbatim (`func_metadata.py:521-522`) and
  flattens a list of them (`:530-536`).

The `CallToolResult` return-annotation route also works (`func_metadata.py:295,309-310`;
`:114-118`; `lowlevel/server.py:540-541`) but is **rejected**: it buys only `structuredContent`,
which with no `outputSchema` is never validated (`lowlevel/server.py:560` never fires), and it makes
the whole feature depend on a newer, harder-to-justify SDK behavior. The summary already travels as
`content[0]`.

### 2. Attachment — one compact-JSON `TextResourceContents`

```python
EmbeddedResource(
    type="resource",
    annotations=Annotations(audience=["user"], priority=0.1),   # types.py:761-764
    resource=TextResourceContents(                              # types.py:871
        uri="xstockstrat:///backtest/<backtest_id>/result.json",
        mimeType="application/json",
        text=json.dumps(full_result, separators=(",", ":")),
    ),
)
```

`full_result` **is** the dict `client.run_backtest` already returns — today's inline payload,
verbatim. FR-3 fidelity is therefore true *by construction*: there is no re-serialization, no
reassembler, and no type-reconstruction table to get wrong. AC-2's round-trip test is
`json.loads(block.resource.text) == client_result`.

**No base64, no `BlobResourceContents`.** The URI scheme `xstockstrat:///…` was executed against
`AnyUrl` and accepted, so no `file:///` fallback is needed.

**Attach only when there is content.** `INSUFFICIENT_DATA` runs carry no `diagnostics` and no
`trades`, so `blocks == []` — summary-only, `coverage_gaps` inline. AC-4 falls out of the general
rule rather than a special case (recon.md § Risks 1).

### 3. Summary — `app/backtest_view.py` (new, pure, no I/O)

`summarize(result: dict) -> dict` over the dict from `client.run_backtest`, never over a proto — so
the feature-064 flag pair (`preserving_proto_field_name=True`,
`always_print_fields_with_no_presence=True`, `client.py:200-204`) cannot drift out from under it
(recon.md § Patterns to REUSE).

Retains (FR-2): `backtest_id`, `strategy_id`, `status`, `completed_at`; the headline metrics
(`total_return`, `annualized_return`, `sharpe_ratio`, `max_drawdown`, `win_rate`, `total_trades`,
`profit_factor`, `initial_capital`); `coverage_gaps` verbatim; and **per symbol**
`{symbol, no_trade_reason, bars_total, warmup_bars}` — the `bars` array dropped. Plus an
`attachments` list naming each block's `uri`/`mime_type` so a client that renders nothing still tells
the user detail exists (FR-5a).

Must be **total over partial dicts** — `tests/test_tools.py:288,303` mock `client.run_backtest` with
`{"backtest_id": "bt-2"}` only, so `.get(...)` throughout or the feature-071 window tests break.

**The serializer's string mapping is documented, not incidental.** `MessageToDict` maps int64 to a
JSON **string** and non-finite doubles to `'NaN'` / `'Infinity'` / `'-Infinity'` — executed and
confirmed. That is the contract that killed CSV.

> **Round 3 correction — the original text here asserted a producer fact that is false.** It claimed
> `profit_factor` is `+Inf` on zero-losing-trade runs and that the summary "legitimately carries the
> string `Infinity`". The producer clamps: `(gross_profit / gross_loss) if gross_loss > 0 else
> (1.0 if gross_profit == 0 else 999.0)` (`servicer.py:2202-2208`), the `<2`-equity-point path
> returns `1.0` (`:2176-2183`), and a green test has pinned `999.0` all along
> (`services/xstockstrat-analysis/tests/test_analysis_helpers.py:77-82`). Extending the check:
> **no `double` in `BacktestResult` is reachable as non-finite** — `initial_equity > 0`
> (`servicer.py:321`), returns are `np.isfinite`-filtered (`:2187`), `std_r` floored at `1e-9`
> (`:2195`), and `cummax ≥ initial_equity > 0`.
>
> The *serializer* fact stands and still decides the format. Its **reachable** instances are:
> in the summary, `CoverageGap.bars_have`/`bars_need` (`int64`, `analysis.proto:55-56`) → strings
> `"120"`/`"504"`; in the attachment, `volume` → `'51234567'` while `bar_index` stays an `int`.
> `total_trades` is `int32` → a JSON number and cannot demonstrate the mapping.
>
> This is a producer-vs-serializer confusion: executing `MessageToDict` on a hand-built proto proves
> what the serializer does with `inf`, not that anything ever produces `inf`. Same shape as
> fails.md 2026-07-21, one layer up.

### 4. Degradation (FR-5)

| Case | Behavior |
|---|---|
| Client renders no attachment | `content[0]` is the summary and stands alone; `summary["attachments"]` names what exists. No code — the docstring states it. |
| Attachment construction raises | `try/except` → `log.warning`, `summary["attachments_error"]`, summary-only, **not** an error result. A presentation failure must not fail a backtest that succeeded. Precedent: `app/tools.py:212-215`. |
| Nothing to attach | `blocks == []`. |

### 5. Dependency pin

`pyproject.toml:6` `mcp>=1.0.0` → `mcp>=1.27.1`; `uv lock` re-run and `uv.lock` committed in the same
PR (root CLAUDE.md § Python uv lock rule; the `python-lint` job runs `uv lock --check` per service —
that gate did not exist when this design was written and was added 2026-07-27).

**Stated honestly:** this is *not* because a type requires it. `EmbeddedResource` and
`TextResourceContents` long predate the floor. The pin exists because `>=1.0.0` unbounded is a latent
hazard — a fresh resolve could produce content-block handling whose behavior nobody has checked — and
1.27.1 is the only version whose behavior was verified in-tree. Naming a floor we verified beats
naming one we guessed.

### 6. Documentation surfaces (C-10, FR-6/FR-6a)

- `app/tools.py` docstring — **also** a third consumer surface: `app/main.py:84-95` publishes it via
  `GET /api/tools`, which powers the UI `/accounts/mcp-tools` page. No UI fixture pins the text (zero
  `run_backtest` matches under `services/xstockstrat-ui`), so nothing breaks — but the rewrite does
  change rendered UI.
- `docs/runbooks/mcp-tools.md` § `run_backtest` **Return** block — already stale on trunk (documents
  `{ "backtest_id": … }`, superseded by feature 064), so this repairs pre-existing drift.
- Agent `CLAUDE.md` — one line noting `run_backtest` returns content blocks.
- **No resources section needed**: this design registers no MCP resource, so FR-6a is discharged by
  *not creating* the surface.
- Tool **count** statements are untouched — no tool added (AC-6).

### 7. AC-1 amendment (approved)

FR-2 (per-symbol inline fields) and AC-1 ("bounded regardless of … symbol count") are strictly
incompatible. FR-2 wins — it is what protects the feature-064 0-trade diagnosis. **AC-1 is reworded
to "independent of window length; linear in symbol count."** The summary is O(symbols), not
O(symbols × bars): **measured 1.0 KB at 5 symbols (~200 B/symbol), so ~10 KB at 50** — against a
payload that today grows without bound in *both* dimensions.

> Round 1 estimated ~2 KB / ~19 KB here without measuring. Corrected 2026-07-27 (round 2). The
> conclusion is unchanged and the amendment stands; the numbers were ~2× pessimistic.

## Rejected Alternatives

- **`ResourceLink` backed by feature-068 `GetBacktest`** — rejected on failure asymmetry. Its worst
  case is unrecoverable (the agent is stateless, recon.md § Risks 7, so once a dangling link is
  returned the bytes are gone and the user re-runs the backtest); `EmbeddedResource`'s worst case is
  merely verbose. And the agent **cannot know at emit time whether the link will resolve**: nothing
  in `BacktestResult` reports whether the detail row landed (recon.md § Risks 4), the write is
  best-effort and no-ops without a pool (§ Risks 2), eviction is count-based at 20 per strategy —
  one tuning session (§ Risks 3) — and `GetBacktest` collapses evicted / never-persisted / DB-down
  into one NOT_FOUND (§ Risks 6). AC-4 needs a link-free path regardless (§ Risks 1), so the link
  would be *added* complexity, never substituted complexity. Closing that gap means editing
  `servicer.py:527-528`, which the product spec forbids and which sits inside the `RunBacktest` span
  feature 071 restructured (§ Risks 10).
- **CSV per-bar table** — rejected on fidelity, *verified by execution*. `csv.DictReader` returns
  every cell as `str`, but the source dict has `volume` as `'51234567'` (str), `bar_index` as `7`
  (int), and `vwap` as `'NaN'` (str). Two numeric-looking columns must reconstruct to different
  types, and `json_format` explicitly rejects `'nan'` on parse ("use 'NaN' instead"). A CSV round-trip
  would be a hand-written reassembler pretending to be fidelity. Direct repeat of ledger fail
  2026-07-21 in the encode direction.
- **CSV + JSON as two blocks** — rejected with CSV: neither block round-trips alone, so AC-2 would
  test a bespoke two-block join on `symbol` + `bar_index` rather than the payload.
- **`BlobResourceContents` (base64)** — rejected. It encodes binary-vs-text, not audience;
  `Annotations.audience`/`priority` (`types.py:761-764`) is the actual audience signal and is set.
  Base64 costs +33% for nothing and tokenizes near-worst-case.
- **gzip blob (measured 103 KB, 13.7× — not the ~53 KB round 1 estimated)** — rejected for v1 and
  recorded as the **designated escalation**. Re-argued in full at round 2 (2026-07-27) and rejected
  again, on stronger grounds than round 1's:
  - **It inverts this feature's own failure-asymmetry rule** (`insights.md` 2026-07-27), the rule
    used to reject `ResourceLink` one day earlier. A truncated gzip stream has no trailer and no
    CRC, and a host that drops an unknown mime yields nothing — so the worst case stops being
    "merely verbose" and becomes **unrecoverable**, which is precisely what disqualified the link.
    Compact JSON truncates to a readable head.
  - **The measured numbers weaken the case.** The summary is 1.0 KB, so in both branches where the
    feature works — connector honors the attachment, or drops it — the encoding is irrelevant.
    gzip matters only in the unobserved inline branch, at ~6–7× on tokens (not the ~9× claimed on
    the 53 KB figure): "context blown" becomes "a fifth of the window burned with undecodable
    base64."
  - **It needs two unobserved behaviors to pay off** (the connector inlines **and** offers a
    download affordance the user can `gunzip`), where round 1 needs one to fail.
  - `mtime=0` is required for timestamp-freedom but does **not** give cross-environment byte
    reproducibility — it routes to `zlib.compress(..., wbits=31)` (`/usr/lib/python3.12/gzip.py:609-612`),
    so output depends on the linked zlib. Any future golden-blob assertion would be flaky.
  Still additive later — no rewrite needed.
- **Protobuf-binary blob (~460 KB)** — smallest faithful option, rejected because it is readable only
  via this platform's generated stubs, defeating "open the detail when I actually need it."
- **Returning `CallToolResult`** — see § 1: buys an unvalidated `structuredContent` at the cost of a
  harder-to-justify SDK floor.
- **Threshold variant ("attach only above N bars")** — foreclosed by the product spec and would
  introduce a config key (F-07) plus two response shapes to test.

## Open Risks

- [ ] **The client may inline the attachment anyway** (or drop it silently). Neither
  `audience=["user"]` nor any MCP mechanism — including `ResourceLink` — *guarantees* context
  exclusion; no in-repo evidence of Claude.ai connector rendering behavior exists, and this design
  does not verify it. Accepted with eyes open: even fully inlined it is a measured 827 KB compact vs
  1410 KB pretty-printed today (`func_metadata.py:539` uses `indent=2`), with the summary first.
  **Observable that would disconfirm it:** a real connector run whose context still balloons.
  **Escalation (trigger sharpened at round 2):** gzip blob — but only once **both** are observed,
  because gzip helps in neither of the other branches and costs readability in both: (a) the
  connector inlines the attachment, **and** (b) it offers a download affordance the user can
  `gunzip`. If (a) holds but (b) does not, gzip makes the artifact unreachable rather than large,
  and trimming the attachment's *content* (e.g. dropping pure warm-up/HOLD bars — round 2's
  untested fourth option) should be priced first. — revisit after the first real-world run.
> **Measured 2026-07-27** (realistic 5 symbols × 504 bars, 2 indicators/bar, all 15
> `BarDiagnostic` fields populated — replaces the round-1 estimates, which were ~2× off):
>
> | Variant | Measured | vs today |
> |---|---|---|
> | Today — pretty JSON (`indent=2`, `func_metadata.py:539`) | 1410 KB | — |
> | Compact JSON — **this design's attachment** | 827 KB | 1.71× |
> | protobuf + base64 | 433 KB | 3.26× |
> | gzip + base64 | 103 KB | 13.7× |
> | **FR-2 summary alone** | **1.0 KB** | **1366×** |

- [ ] **`app/backtest_view.py` must tolerate partial dicts** or the feature-071 window tests
  (`test_tools.py:288,303`) break. — target: step 1, with a paired test.
- [ ] **Non-echoing fixtures required** (insights 2026-07-27, recon.md § Risks). AC-2's fixture must
  contain per-bar content that appears **only** in the attachment; AC-1 must assert boundedness across
  **two** symbol counts, not one. — target: steps 1 and 3.
- [ ] **Intra-feature line drift** — `product-spec.md:180,188,32-33` cite `servicer.py:507-511`,
  `:1295-1296` and `test_tools.py:485-527`; the real lines are `servicer.py:527`, `:1412-1413` and
  `test_tools.py:535-577` (recon is correct). `/sdd-spec` reads both files. — target: fix the spec
  citations at /sdd-spec.
- [ ] **AC-1 reworded** (§ 7) — a recorded amendment to an approved product spec, not a silent
  reinterpretation. — target: apply to product-spec.md at /sdd-spec.

## Constitution Rules Touched

- **`F-04`** — honored: every codebase claim traces to a `codebase-discovery` digest recorded in
  `recon.md`; the three SDK mechanism claims and the `MessageToDict` type mapping were **executed**,
  not inferred. Unfound items stayed in `## Not found`.
- **`F-07`** — honored: no hardcoded operational config. The mimeType, URI scheme and
  `priority=0.1` are presentation constants, not `WatchConfig`-served values. The threshold variant
  that *would* cross F-07 is explicitly rejected; the split stays unconditional.
- **`F-11`** — honored: the adversary reported **no Floor breach**; the verdict was NEEDS WORK on
  major objections, all of which are resolved above (O1/O2 by dropping CSV, O3/O4/O5 by dropping
  base64, O6 by recording the risk explicitly, O7 by `structured_output=False`, O8–O11 accepted).
- **`C-01`** — honored: every design claim carries `path:line` or an executed result.
- **`C-05`** — honored: no new config key.
- **`C-08` / `P-06`** — honored: each step pairs with tests; AC-1/AC-2 fixtures are specified as
  *non-echoing* so they can actually fail.
- **`C-09`** — n/a: no proto change.
- **`C-10`** — honored: the three consumer surfaces move in the same PR (tool docstring — which is
  also the `/api/tools` → UI surface — `mcp-tools.md`, agent `CLAUDE.md`); no MCP resource surface is
  created, so FR-6a is discharged by omission rather than left open.
- **`C-11`** — honored: the FR-2/AC-1 contradiction and the OQ-1 unverified premise were surfaced to
  the user and decided, not papered over.
- **`C-12`** — n/a: no frontend fixture change (no `xstockstrat-ui` code in scope).
- **`P-03`** — honored: the serializer's contract was verified *before* designing on it — which is
  exactly what killed CSV. The one premise that cannot be verified in-repo (connector rendering) is
  recorded as an accepted open risk with a named disconfirming observable, not closed silently.
- **`P-05`** — honored: recorded in `context.md` as it happened.
