# Context Log: fix-vendor-key-in-url

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-10 (/sdd-triage)

- Bug reported via defect report (Issues disabled): docs/reports/2026-10-29-marketdata-vendor-key-url-residuals-defect.md — "marketdata vendor API keys still ride in the request URL (redirect-parse residual + access logs)"
- Cluster rationale: single report (feature 254's accepted residuals); both paths close with one fix — the key leaves the query string.
- Severity: SEV-2 (secret-disclosure)
- Routed to SDD path (Track C); prod-impacting SEV-2 routed to C by operator decision 2026-11-10
- Created: feature.md, product-spec.md, acceptance.feature (regression scenarios @AC-1..2), context.md
- Affected services (from report): xstockstrat-marketdata
- Root cause hypothesis: key in query string; recommended class fix is header auth (vendor support unverified) + optional shared `redactURLError`
- Recommended design depth: full → `/sdd-design fix-vendor-key-in-url` (rationale: SEV-2 security / secret-disclosure escalation signal; vendor header-auth support is an unverified design fork)
- Development branch: feature/fix-vendor-key-in-url

## Session 2026-11-10 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: bug-template conventions (no FR-N/@FR tags; no Consumer Surface section); AC-2 only attainable if vendors support header auth (resolve OQ1/OQ2 first)
- Overlap findings: none
- Recommended design depth: quick (single service, no proto/migration, clean overlap)
- Tree: ccr-500a9eb9-nvk45x (origin/main-dev 0fecb24d + triage/docs commits; no feature branch yet)

## Session 2026-11-11 — sdd-batch design gate (round 2)

/sdd-design full debate halted at its approval gate after round 2 (gate policy: halt). design.md is not written and status.md is unchanged, per the grilling protocol. The register is in `debate.md`.

## Open Threads

- **Approach:** move the vendor key out of the query string into a per-request header: FMP `apikey`, Finnhub `X-Finnhub-Token`. The key is still read through `c.apiKey()` on every call (D-1). In the same step, set `CheckRedirect` → `http.ErrUseLastResponse` on the default client (D-2, with the purpose corrected by D-5). Add no general sanitizer (D-3). Every test that reads the key from the query is repointed in the header-move step. Step 0 is a hard pre-merge gate: the operator curls the vendors directly, outside marketdata, covering all six endpoint paths with the key kept out of argv and records (D-6). If a vendor fails step 0, it keeps its query key under a signed acceptance, and a vendor-scoped R-3 sanitizer becomes mandatory for it (D-4). Step 5 is a recorded post-deploy check of outcomes ok, http_4xx, other and decode per vendor.
- **Strongest open objection (O-7, blocking):** D-2's stated reason is wrong. `net/http` parses `Location` before it calls `checkRedirect`, so the unparseable-Location residual leaves through the `Do`-error branch (`fmp_client.go:290-295`, `finnhub_client.go:143-146`). Three changes are required. @AC-1 must trace to the header move (D-1). The per-vendor fallback sanitizer must be mandatory. The D-2 rationale must read "blocks cross-host key-header forwarding and turns a parseable 3xx into a statusError". The synthesis already includes all three, but O-7 stays open until the proposer adopts them in round 3. O-8 to O-12 are non-blocking refinements and are already folded into the approach.
- **Floor status:** no Floor breaches.
- **Uncovered @AC changes (none covered by an operator decision):** EXTEND @AC-1 and @AC-2. The 254 @AC-1/@AC-2 are amended in place with `@feature-320`. PRESERVE 295 @AC-16, 294 @AC-13, 230 @AC-5, 254 @AC-5 and 254 @AC-7.

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "Move the vendor key out of the URL into a per-request header (D-1). Refuse redirects on the default client (D-2), in the same step as the header move. Add no general sanitizer (D-3). Repoint every test that reads the key from the query.\n\n**Step 0: hard pre-merge gate recorded in context.md. It blocks step 2.**\n- The operator calls each vendor directly with curl, from outside marketdata, using the staging key. Each call sends the key in the header only, with no query key, and does not use `-L`. Cover every endpoint path the clients call:\n  - FMP (`apikey: <key>`): `/stable/quote`, `/stable/ratios-ttm`, `/stable/profile`\n  - Finnhub (`X-Finnhub-Token: <key>`): `/stock/metric`, `/quote`, `/stock/profile2`\n- Record for each endpoint: HTTP 200, a non-3xx `%{http_code} %{redirect_url}`, a summary showing the payload is non-empty, and the vendor docs URL with a quoted passage where one exists.\n- The key must never reach argv, shell history or a transcript. Pass it with `-H @hdrfile` (mode 0600, deleted afterwards) or an unexported variable. context.md records results only, never a command line that contains the key.\n- Record the staging and production `fmp.base_url` and `finnhub.base_url` values from config-ui. Defaults are at `services/xstockstrat-marketdata/CLAUDE.md:87,90`. Check any override the same way, which closes O-4.\n- Staging reachability does not matter. The proof runs outside marketdata, so the `fmp.enabled`/`finnhub.enabled` and `snapshot_source` defaults do not block it.\n- **Fallback if a vendor fails step 0:** that vendor keeps its query key under a user-signed residual acceptance (product-spec OQ2). A vendor-scoped R-3 sanitizer then becomes **mandatory**, not optional, because D-2 does not cover residual (a). Test the sanitizer with the same 302 + unparseable-`Location` fixture and the 254 `errors.As`-false form.\n\n**Step 1: RED tests.**\n- @AC-2: one `httptest.NewServer` per vendor records `r.URL.RawQuery` and `r.Header`. Assert the key is absent from the query and present in the header.\n- @AC-1: the server returns a 302 whose unparseable `Location` echoes `r.URL.RawQuery`. Build the client with `fmp.NewClient` / `finnhub.NewClient`, `HTTPClient: nil` and `BaseURL` set to the server, and assert with `assertNoKeyLeak` (`internal/fmp/fmp_client_test.go:230`). Do not use `newTestClient` or `recordingRT` (`fmp_client_test.go:60,29`).\n- **C-15 traceability:** @AC-1 goes GREEN in step 2 because of D-1, not because of CheckRedirect. In `net/http`, `Client.do` parses `Location` before it calls `checkRedirect`. The parse error therefore leaves through the `Do`-error branch (`fmp_client.go:290-295` `stageError{\"transport\"}`, `finnhub_client.go:143-146`), and the only reason it carries no key is that the query no longer holds one.\n\n**Step 2: header move, refused redirects and test repoint, all in one step.**\n1. Write the cross-host redirect test first. Use `HTTPClient: nil`. The first host answers 302 to a second httptest host, and the second host must never receive the key header. Show it RED once the header lands.\n2. Delete `params.Set` at `fmp_client.go:260` and `finnhub_client.go:126`.\n3. After the build-request error branch, add `req.Header.Set(\"apikey\", c.apiKey())` and `req.Header.Set(\"X-Finnhub-Token\", c.apiKey())`. The key is still read on every call through the closures at `fmp_client.go:79-81` and `finnhub_client.go:52-55`, so 295 @AC-16 holds.\n4. In the same step, add `CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }` on the default client at `fmp_client.go:73` and `finnhub_client.go:46`.\n   - This is the corrected reason for D-2. Go copies custom headers to every redirect hop, including a cross-host one; it strips only Authorization, WWW-Authenticate, Cookie and Cookie2. Refusing redirects stops the key header reaching a foreign host.\n   - A parseable 3xx also becomes FMP `statusError{path,3xx}` (`fmp_client.go:306-309`) or Finnhub \"returned HTTP %d\" (`finnhub_client.go:154-157`).\n   - Telemetry records it as outcome `other` (`internal/telemetry/otel.go:362-372`).\n   - Because the header and CheckRedirect land together, there is no window in which the key header follows a redirect.\n5. Same step, listed in **Files** (O-1):\n   - `cmd/server/main_test.go:165,171`: `newVendorFake(t, keyHeader, body)` reads `r.Header.Get(keyHeader)`. Its callers at `:195` and `:297` pass `\"apikey\"`; the caller at `:196` passes `\"X-Finnhub-Token\"`.\n   - `internal/finnhub/finnhub_client_test.go:394` becomes `r.Header.Get(\"X-Finnhub-Token\")`.\n   - `internal/fmp/fmp_client_test.go:625-626` asserts `symbol=AAPL`, no `apikey` in the query, and the header equal to `SECRET123`.\n   - Re-grep at spec time for any other test that reads the key from the query.\n6. Add one line to the `HTTPClient` field doc (`fmp_client.go:38`, `finnhub_client.go:28`): \"callers must refuse redirects; the key travels in a header\". Only tests inject a client today, and grep shows no production setter.\n\n**Step 3: comments and pinned guarantees.**\n- Rewrite or delete the comments that become false: `fmp_client.go:254-255,266,308,331,389`, `finnhub_client.go:120-121,132,156`, `internal/service/etf_flags.go:131`. Each rewrite states the constraint that is now true: the key travels only in the header, and the URL and errors are key-free.\n- Leave the `etf_flags_test.go:390-392` synthetic `apikey=SECRET` fixtures unchanged. They test class-only logging (230 @AC-5).\n- Pin these in the spec:\n  - 294 @AC-13: the header never reaches a span or log. Keep `fmp_client_test.go:636-645` and `finnhub_client_test.go:413-415`.\n  - 230 @AC-5: a refused 3xx yields a bounded `ErrorClass` (`fmp_client.go:390`, via `enrichmentClass`), and the class-only log at `etf_flags.go:170` is unchanged.\n  - 254 @AC-5 and @AC-7 hold through the existing unwrap.\n- Spec note for F-07: the header names `apikey` and `X-Finnhub-Token` are vendor protocol constants, like the path literals at `fmp_client.go:396`. They are not config values.\n\n**Step 4: docs and acceptance.**\n- Add one line to marketdata `CLAUDE.md` § Fundamentals Integration: the vendor key is sent only in a request header, never in the URL.\n- Turn `docs/context-constitution-findings.md:39-40` into a hard invariant.\n- Amend 254 @AC-1 and @AC-2 in place with `@feature-320` (`acceptance/fix-marketdata-secret-exposure.feature:9,17`). The @AC-2 Then reads \"the request URL received by the vendor endpoint\".\n\n**Step 5: post-deploy confirmation, recorded.**\n- Record dev's `fmp.enabled`, `finnhub.enabled` and `fundamentals.snapshot_source`.\n- If a vendor path is live: record before and after values of `marketdata.vendor.requests{vendor, outcome ∈ {ok, http_4xx, other, decode}}` over a window. Pass condition: the `ok` share does not fall, and none of `http_4xx`, `other` or `decode` rises.\n- If a vendor path is off on dev: the operator turns it on for the window (the flags are live-read), or records \"not exercised on dev\" and repeats the check at the first environment where it is live.\n- Step 0 is the merge gate; step 5 only confirms.",
    "open_objections": [
      {
        "text": "[C-01/C-15] The stated reason for D-2 is wrong. In Go's Client.do, the Location header is parsed before checkRedirect runs, so ErrUseLastResponse never intercepts an unparseable Location. That error goes out through the Do-error branch (fmp_client.go:290-295, finnhub_client.go:143-146), not the status paths. Required: (1) @AC-1 traceability points to the header move (D-1), not to CheckRedirect; (2) under the step-0 per-vendor fallback, the R-3 vendor-scoped sanitizer is mandatory and is tested with the 302 + bad-Location fixture; (3) the D-2 rationale reads 'blocks cross-host forwarding of the key header and turns a parseable 3xx into a statusError'. The synthesized approach includes all three. This stays open until the proposer adopts it.",
        "blocking": true
      },
      {
        "text": "The header move and CheckRedirect must land in the same step, with the cross-host test written RED first inside that step. Otherwise, between the two steps, a vendor 3xx would forward the custom key header to a foreign host.",
        "blocking": false
      },
      {
        "text": "Step 0 must cover all six endpoint paths (/stable/quote, /stable/ratios-ttm, /stable/profile, /stock/metric, /quote, /stock/profile2) with 200 and a non-empty payload each. The key must never appear in argv, shell history or context.md: use -H @hdrfile or an unexported variable.",
        "blocking": false
      },
      {
        "text": "Step-5 signal: 3xx maps to outcome 'other' and a 200 error body maps to 'decode', so watching http_4xx alone misses both. Record before and after values for ok, http_4xx, other and decode per vendor; pass if the ok share does not fall and none of the other three rises.",
        "blocking": false
      },
      {
        "text": "Add a field-doc line on HTTPClient (fmp_client.go:38, finnhub_client.go:28): 'callers must refuse redirects; the key travels in a header'. An injected client bypasses CheckRedirect.",
        "blocking": false
      },
      {
        "text": "Pin the preserved guarantees in the spec: 294 @AC-13 span/log checks (fmp_client_test.go:636-645, finnhub_client_test.go:413-415); 230 @AC-5 bounded ErrorClass for a 3xx statusError and an unchanged class-only log at etf_flags.go:170; 254 @AC-5/@AC-7 through the existing unwrap. Note under F-07 that the header names are vendor protocol constants.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "@AC-1",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "@AC-2",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "295 @AC-16",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "294 @AC-13",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "230 @AC-5",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "254 @AC-5",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "254 @AC-7",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Keep the query key and add only redactURLError as the primary fix (R-3, locked): it does not close residual (b), the access logs. It survives only as the mandatory per-vendor fallback when step 0 fails.",
      "Header-injecting RoundTripper (R-1, locked): it re-injects the key on every redirect hop, including cross-host.",
      "Shared vendor-HTTP package (R-2, locked): two one-line literals do not justify a package (C-18).",
      "CheckRedirect returning a sentinel error instead of ErrUseLastResponse: the 3xx becomes a transport *url.Error and the status code is lost, which is harder to diagnose than statusError{path,3xx}.",
      "A sanitizer at all four unwrap sites as defence in depth: it only covers a vendor echoing the header value into Location, which is far-fetched. It contradicts D-3 and C-18 once D-1 holds.",
      "CheckRedirect in a later step than the header move: this leaves a window where the custom key header follows a cross-host redirect.",
      "Applying CheckRedirect to an injected cfg.HTTPClient as well: no production code injects a client (grep finds only fmp_client.go:39,71 and finnhub_client.go:29,44). A field-doc constraint is enough.",
      "Allowing same-host redirects and refusing only cross-host ones: extra mechanism with no demonstrated need. Revisit only if step 0 finds a redirecting base_url.",
      "A dev smoke test as the OQ1 merge gate: dev deploys on a push to main-dev, so the test would run after the merge it is meant to gate."
    ],
    "open_risks": [
      "The vendor header contract cannot be verified from the repo. If a header name is wrong, every production call returns 401/403 while unit tests stay green. Step 0 across all six endpoints mitigates this.",
      "A curl from the operator's host is assumed to stand in for marketdata's egress. This holds only if header-auth acceptance does not depend on the source IP.",
      "A redirecting configured base_url becomes a hard, secret-free failure (statusError 3xx / outcome other).",
      "A secret stored with a trailing CR/LF now fails as an invalid header value (a transport stage error that does not leak the key). Trimming is not added (YAGNI).",
      "If one vendor fails step 0, it runs on a query key with a vendor-scoped sanitizer. The access-log residual (b) remains for that vendor under a signed acceptance.",
      "Other test fakes or recordingRT responders may still read the key from the query. Re-grep at spec time.",
      "The test file for the @AC-1 gRPC-status and log assertions on GetFundamentalsMulti (near marketdata_service_test.go:4405) is still to be confirmed at spec time."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-11",
      "C-15",
      "C-16",
      "C-18",
      "P-03",
      "P-06",
      "F-04",
      "F-07",
      "F-08"
    ],
    "rationale": "The proposer concretely adopted both round-1 blocking fixes.\n- O-1: every test that reads the key from the query is repointed to a header read in the header-move step, listed by line. The call sites main_test.go:195,196,297 were confirmed by grep; :289 is a line inside the rotation test, not a call.\n- O-2: step 0 is now a pre-merge, direct-to-vendor curl gate recorded in context.md, and staging reachability is resolved by running it outside marketdata.\n- O-3 through O-6 are also concretely answered: nil HTTPClient with BaseURL set to httptest, base_url canonicity via the curl without -L, the listed comment rewrites, and the in-place amendment of the 254 ACs.\n\nThe adversary's new blocking point holds. I checked it against net/http's redirect loop: req.URL.Parse(loc) runs and returns a uerr before c.checkRedirect is called. So D-2 does not intercept the unparseable-Location residual. @AC-1 is closed by D-1, and under a vendor fallback the R-3 sanitizer is mandatory.\n\nPer the register guardrails, I did not reopen or rewrite D-2; the decision itself stands. The approach keeps CheckRedirect and records the corrected purpose as a new, non-contradicting decision. That purpose is blocking cross-host forwarding of the custom key header (Go strips only Authorization, WWW-Authenticate, Cookie and Cookie2) and producing a statusError for a parseable 3xx.\n\nI folded the adversary's non-blocking corrections into the approach:\n- CheckRedirect lands in the same step as the header move.\n- Step 0 covers all six endpoints and keeps the secret out of argv and records.\n- Step 5 watches the wider outcome set.\n- The HTTPClient field doc states the redirect constraint.\n- The spec pins 294 @AC-13, 230 @AC-5 and 254 @AC-5/@AC-7, plus an F-07 note.\n\nI confirmed that ErrorClass delegates to enrichmentClass (fmp_client.go:390) and that HTTPClient is set only through its field (fmp_client.go:39,71; finnhub_client.go:29,44). The new blocking objection stays open until the proposer adopts it in the next round.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "Residual (a), the unparseable-Location echo, is closed by D-1 (no key in the query), not by CheckRedirect, and @AC-1 traces to the header-move step. Under a step-0 per-vendor fallback, the R-3 vendor-scoped sanitizer is mandatory for that vendor and is tested with the 302 + bad-Location fixture.",
          "evidence": "net/http Client.do parses Location (uerr 'failed to parse Location header') before c.checkRedirect; the error leaves via fmp_client.go:290-295 and finnhub_client.go:143-146"
        },
        {
          "text": "D-2's purpose is to stop the custom key header being forwarded on a cross-host redirect and to turn a parseable 3xx into statusError / 'returned HTTP %d'. CheckRedirect lands in the same step as the header move, with the cross-host test written RED first inside that step.",
          "evidence": "Go strips only Authorization, WWW-Authenticate, Cookie and Cookie2 on redirect; fmp_client.go:73,306-309; finnhub_client.go:46,154-157"
        },
        {
          "text": "Step-0 vendor proof covers all six endpoint paths with 200 and a non-empty payload, passes the key via a header file or an unexported variable, and records no command line containing the key. The step-5 confirmation records before and after values for outcome ok, http_4xx, other and decode per vendor.",
          "evidence": "fmp_client.go:396,406 (/stable/quote, /stable/ratios-ttm) and the Finnhub /stock/metric, /quote, /stock/profile2 paths; telemetry/otel.go:362-372 maps 3xx to other"
        }
      ],
      "new_rejected": [
        {
          "text": "CheckRedirect returning a sentinel error instead of http.ErrUseLastResponse",
          "why": "Turns a 3xx into a transport *url.Error and loses the status code that statusError{path,3xx} keeps"
        },
        {
          "text": "Landing CheckRedirect in a later step than the header move",
          "why": "Opens a window where the custom key header follows a cross-host redirect"
        }
      ],
      "new_objections": [
        {
          "text": "D-2's stated reason is wrong: Location is parsed before checkRedirect, so @AC-1 must trace to the header move, the per-vendor fallback sanitizer is mandatory, and the D-2 rationale must read 'blocks cross-host key-header forwarding and turns a parseable 3xx into a statusError'.",
          "blocking": true
        },
        {
          "text": "The header move and CheckRedirect must land in one step, with the cross-host test written RED first.",
          "blocking": false
        },
        {
          "text": "Step 0 must cover all six endpoints and keep the key out of argv, shell history and context.md.",
          "blocking": false
        },
        {
          "text": "Step 5 must track ok, http_4xx, other and decode per vendor, not http_4xx alone.",
          "blocking": false
        },
        {
          "text": "Add an HTTPClient field-doc line: callers must refuse redirects; the key travels in a header.",
          "blocking": false
        },
        {
          "text": "Pin 294 @AC-13, 230 @AC-5 (bounded ErrorClass for a 3xx) and 254 @AC-5/@AC-7 in the spec; add an F-07 note that the header names are vendor protocol constants.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-1",
          "how": "The proposal repoints newVendorFake (main_test.go:165,171) and its callers :195,:196,:297, plus finnhub_client_test.go:394 and fmp_client_test.go:625-626, in the header-move step, listed in Files; the adversary verified the lines."
        },
        {
          "id": "O-2",
          "how": "Step 0 is a pre-merge, direct-to-vendor curl gate recorded in context.md with status, payload and docs quote, run outside marketdata so the enabled/snapshot_source defaults do not block it; step 5 is a recorded post-deploy check. Endpoint coverage and outcome set are refined under new non-blocking objections."
        },
        {
          "id": "O-3",
          "how": "The tests use HTTPClient nil with BaseURL set to httptest and avoid newTestClient/recordingRT; the cross-host test is shown RED inside the combined step."
        },
        {
          "id": "O-4",
          "how": "The step-0 curl runs without -L and records %{http_code} %{redirect_url} against the configured staging and production base_url values."
        },
        {
          "id": "O-5",
          "how": "The comment rewrite/delete list (fmp_client.go:254-255,266,308,331,389; finnhub_client.go:120-121,132,156; etf_flags.go:131) is an explicit step, with each rewrite stating the new constraint."
        },
        {
          "id": "O-6",
          "how": "Step 4 amends 254 @AC-1 and @AC-2 in place with @feature-320, and the @AC-2 Then reads 'the request URL received by the vendor endpoint'."
        }
      ],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-13 — sdd-batch design gate (round 3)

/sdd-design full debate halted at its approval gate after round 3 (gate policy: halt). design.md is not written and status.md is unchanged, per the grilling protocol. The register is in `debate.md` (round 3 adds D-7, D-8, R-6, R-7, O-13 to O-16, and closes O-7 to O-12).

## Open Threads

- **Approach:** unchanged from round 2. The vendor key moves out of the query string into a per-request header: FMP `apikey`, Finnhub `X-Finnhub-Token` (D-1). `CheckRedirect` → `http.ErrUseLastResponse` lands in the same step, with the cross-host test written RED first (D-2, D-5). No general sanitizer is added (D-3). Step 0 is the pre-merge vendor proof across all six paths, with the key kept out of argv, history and context.md (D-6). It now also records `%{http_version}` and, on HTTP/1.1, runs a probe with the Go-canonical `Apikey:` spelling. A vendor that fails step 0 keeps its query key under a signed OQ2 residual, with a mandatory vendor-scoped sanitizer (D-4). Round 3 corrects two citations:
  - A refused 3xx is pinned as `ErrorClass == http_<code>` (for example `http_302`) plus telemetry outcome `other` (D-7).
  - The findings edit targets `services/xstockstrat-marketdata/docs/context-constitution-findings.md:39` (D-8).

  Round 3 also folds in three test and acceptance refinements:
  - a Finnhub @AC-1 case through single-symbol `GetFundamentals`;
  - a CR/LF header-validation leak test through `newLeakClient`;
  - an in-place `@feature-320` amendment of 294 @AC-13's Given, so the key is sent in the `apikey` header.

  Step 5 is the recorded post-deploy check of ok, http_4xx, other and decode per vendor.
- **Strongest open objection (O-13, non-blocking):** 294 @AC-13's Given (`acceptance/signal-map-instrumentation.feature:15`) names an `apikey=SECRET123` URL that the client can no longer produce once `fmp_client_test.go:625-626` is rewritten. It needs an in-place `@feature-320` amendment, the Given becomes "key SECRET123 sent in the apikey header" and the no-SECRET123 Then stays. "Unchanged" is dropped from the step-3 pin. O-14 (Finnhub @AC-1 through `GetFundamentals`), O-15 (CR/LF test) and O-16 (`%{http_version}` probe) are also non-blocking. All four are already folded into the approach and stay open until the proposer adopts them. No objection blocks approval. O-7, the round-2 blocker, is closed.
- **Floor status:** no Floor breaches.
- **Uncovered @AC changes (none covered by an operator decision):**
  - EXTEND: 254 @AC-1, 254 @AC-2 and 294 @AC-13, each amended in place with `@feature-320`.
  - PRESERVE: 295 @AC-16, 230 @AC-5, 254 @AC-5 and 254 @AC-7.
  - Changed since round 2: 294 @AC-13 moves from PRESERVE to EXTEND.

```sdd-batch-design-state
{
  "round": 3,
  "synth": {
    "approach": "Round 3 keeps the round-2/round-3 approach. It fixes two citations the adversary showed were wrong (ErrorClass literal, findings path) and adds four non-blocking refinements. Nothing from R-1 to R-5 comes back.\n\n**Step 0: pre-merge vendor proof (D-6). It blocks step 2.**\n- The operator curls each vendor directly, from outside marketdata, with the key in the header only and without `-L`. Cover all six paths:\n  - FMP (`apikey`): `/stable/quote`, `/stable/ratios-ttm`, `/stable/profile`\n  - Finnhub (`X-Finnhub-Token`): `/stock/metric`, `/quote`, `/stock/profile2`\n- Keep the key out of argv, history and context.md. Use `-H @hdrfile` (mode 0600, deleted afterwards) or an unexported variable. context.md records results only.\n- Record per path:\n  - `%{http_code} %{redirect_url} %{http_version}`: must be 200 with no redirect.\n  - A summary showing the payload is non-empty.\n  - The vendor docs URL with a quoted passage where one exists.\n  - If the negotiated protocol is HTTP/1.1, also run one `--http1.1` probe whose hdrfile sends the Go-canonical `Apikey:` spelling.\n- Check the staging and production `fmp.base_url` / `finnhub.base_url` overrides the same way.\n- **Per-vendor fallback (D-4).** A vendor that fails step 0 keeps its query key under a user-signed OQ2 residual. For that vendor a vendor-scoped R-3 sanitizer wrapped around the `Do` unwrap is mandatory. Test it with the 302 + unparseable-`Location` fixture and the 254 `errors.As(*url.Error)`-false form.\n\n**Step 1: RED tests.**\n- **@AC-2.** One `httptest.NewServer` per vendor records `r.URL.RawQuery` and `r.Header`. Assert the key is absent from the query and present in the header.\n- **@AC-1, both vendors.** The server answers 302 with an unparseable `Location` that echoes `r.URL.RawQuery`. Use `HTTPClient: nil` with `BaseURL` set to the server, and assert with `assertNoKeyLeak` (`internal/fmp/fmp_client_test.go:230`).\n  - FMP: also assert the `GetFundamentalsMulti` gRPC status and the log line. The test file is confirmed at spec time, near `marketdata_service_test.go:4405`.\n  - Finnhub: drive the case through `GetFundamentals` (`internal/finnhub/finnhub_client.go:67-69`), which returns the error unwrapped. `GetFundamentalsMulti` swallows per-symbol errors (`finnhub_client.go:80-85`), so a test through it would pass without testing anything. Assert there is no `k-secret` and no `token=`, and that `errors.As(*url.Error)` is false.\n- **CR/LF.** Through `newLeakClient` (`fmp_client_test.go:247`) with `APIKey: \"k-secret\\n\"`, assert `assertNoKeyLeak` on the resulting header-validation transport error. Header validation is a new key-bearing path this design creates.\n- **Traceability.** @AC-1 goes GREEN because of D-1, not CheckRedirect. `net/http` `Client.do` parses `Location` before `checkRedirect`, and the error leaves through `fmp_client.go:289-295` and `finnhub_client.go:140-146`.\n\n**Step 2: one atomic step (D-5).**\n1. Write the cross-host redirect test first: host A answers 302 to host B, and host B never sees the key header. Show it RED once the header lands.\n2. Delete `params.Set` at `fmp_client.go:260` and `finnhub_client.go:126`.\n3. After the build-request branch, add `req.Header.Set(\"apikey\", c.apiKey())` (FMP, after `fmp_client.go:272`) and `req.Header.Set(\"X-Finnhub-Token\", c.apiKey())` (Finnhub, after `finnhub_client.go:138`).\n4. Add `CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }` at `fmp_client.go:73` and `finnhub_client.go:46`.\n5. Repoint the tests that read the key from the query: `cmd/server/main_test.go:165,171,195,196,297`, `finnhub_client_test.go:394`, `fmp_client_test.go:625-626`. Re-grep at spec time.\n6. Add an `HTTPClient` field-doc line at `fmp_client.go:38` and `finnhub_client.go:28`: \"An injected client must refuse redirects; the key travels in a request header.\"\n\n**Step 3: comments and pinned guarantees.**\n- Rewrite these comments to state the new constraint: `fmp_client.go:254-255,266,308,331,389`, `finnhub_client.go:120-121,132,156`, `internal/service/etf_flags.go:131`. This includes the `ErrorClass` doc at `fmp_client.go:389`, which says \"can carry apikey=\".\n- Spec pins:\n  - **294 @AC-13** keeps the `fmpOp`/`finnhubOp` and outcome constants, with no URL or header attribute (`fmp_client_test.go:636-645`, `finnhub_client_test.go:413-415`). Its scenario text is amended in step 4, so the pin does not say \"unchanged\".\n  - **230 @AC-5** uses two separate assertions for a refused 302:\n    - `ErrorClass` == `http_302`, the `http_<code>` form produced by `enrichmentClass` (`fmp_client.go:380`).\n    - The telemetry outcome is `other` (`HTTPErrorOutcome`, `internal/telemetry/otel.go:375-384`).\n  - The class-only log at `etf_flags.go:170` is unchanged, and the `etf_flags_test.go:390-392` fixtures are left alone.\n  - **254 @AC-5 / @AC-7** hold through the unchanged unwrap.\n- **F-07 note:** `apikey` and `X-Finnhub-Token` are vendor protocol constants, like the path literals at `fmp_client.go:396,406`. They are not config.\n\n**Step 4: docs and acceptance.**\n- Add one line to marketdata `CLAUDE.md` § Fundamentals Integration.\n- Promote the open question at `services/xstockstrat-marketdata/docs/context-constitution-findings.md:39` (the service-scoped file, not root `docs/`) to a hard invariant: the key is header-only and URLs and errors are key-free.\n- Amend these scenarios in place with `@feature-320`:\n  - 254 @AC-1 and @AC-2 (`acceptance/fix-marketdata-secret-exposure.feature:9,17`). The @AC-2 Then reads \"the request URL received by the vendor endpoint\".\n  - 294 @AC-13 (`acceptance/signal-map-instrumentation.feature:13-15`). The Given becomes an FMP 429 for `https://fmp.example/stable/profile?symbol=AAPL` with key SECRET123 sent in the `apikey` header. The Then \"no metric attribute, span attribute or log line contains SECRET123\" stays.\n- Leave `fix-etf-flag-fill.feature:55` (synthetic error text) unchanged.\n\n**Step 5: post-deploy confirmation.**\n- Record, per vendor, the before and after values of `marketdata.vendor.requests{outcome ∈ ok, http_4xx, other, decode}`.\n- Pass if the `ok` share does not fall and none of the other three rises.\n- A vendor path that is off on dev is either enabled for the window or recorded as \"not exercised\" and checked again at the first environment where it is live.",
    "open_objections": [
      {
        "text": "[C-16/C-15] 294 @AC-13's Given (services/xstockstrat-marketdata/acceptance/signal-map-instrumentation.feature:15) names a key-bearing URL the client can no longer produce once fmp_client_test.go:625-626 is rewritten. Amend it in place with @feature-320 (Given: key SECRET123 sent in the apikey header; keep the no-SECRET123 Then), and drop 'unchanged' from the step-3 pin. Leave fix-etf-flag-fill.feature:55 alone.",
        "blocking": false
      },
      {
        "text": "[C-08] @AC-1 RED coverage is FMP-only. Add a Finnhub 302 + unparseable-Location case through single-symbol GetFundamentals (finnhub_client.go:67-69), not GetFundamentalsMulti, which swallows per-symbol errors (finnhub_client.go:80-85) and would pass without testing anything. Assert no k-secret/token= and errors.As(*url.Error) false.",
        "blocking": false
      },
      {
        "text": "[C-08] The header move creates a new key-bearing path: header-value validation inside Do. Add one test with APIKey \"k-secret\\n\" through newLeakClient (fmp_client_test.go:247), asserted with assertNoKeyLeak, so the key-free error text is pinned against future Go versions.",
        "blocking": false
      },
      {
        "text": "[D-6 refinement, not a reopen] Step 0 should send what Go sends. Record %{http_version}, and if it is HTTP/1.1 run one --http1.1 probe with a hdrfile containing the canonical 'Apikey:' spelling.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "254 @AC-1",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "254 @AC-2",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "294 @AC-13",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "295 @AC-16",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "230 @AC-5",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "254 @AC-5",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "254 @AC-7",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Query key plus redactURLError only, as the primary fix (R-3, locked): does not close residual (b), the access logs. It survives only as the mandatory per-vendor fallback (D-4).",
      "Header-injecting RoundTripper (R-1, locked): re-injects the key on every redirect hop, including cross-host.",
      "Shared vendor-HTTP package (R-2, locked): two one-line literals fail C-18.",
      "CheckRedirect returning a sentinel error (R-4, locked): loses the status code that statusError{path,3xx} keeps.",
      "CheckRedirect in a later step than the header move (R-5, locked): opens a window where the key header follows a cross-host redirect.",
      "A general redactURLError at all four unwrap sites as defence in depth (D-3): once D-1 lands, no key-bearing URL is left to redact. The CR/LF test covers the only new key-bearing path.",
      "Wrapping http.DefaultTransport in a tripwire that rejects any request with apikey/token in the query: one more moving part (C-18). The @AC-2 httptest tests already guard the same invariant at merge time.",
      "A Finnhub @AC-1 error test through GetFundamentalsMulti: Multi swallows per-symbol errors (finnhub_client.go:80-85), so the test would pass without testing anything.",
      "Pinning ErrorClass as the literal 'http_3xx': enrichmentClass produces http_<code> (fmp_client.go:380), so the test could never pass.",
      "Applying CheckRedirect to an injected cfg.HTTPClient: no production code injects one. The field-doc constraint is enough.",
      "Refusing only cross-host redirects: extra mechanism with no demonstrated need.",
      "A dev smoke test as the OQ1 merge gate: dev deploys after the merge it would gate."
    ],
    "open_risks": [
      "The vendor header contract cannot be verified from the repo. A wrong header name means 401/403 on every production call while unit tests stay green. Step 0 across six paths, with protocol and case fidelity, is the only pre-merge gate.",
      "Step 0 assumes the operator's host stands in for marketdata's egress, which holds only if header acceptance does not depend on the source IP. Header handling may also differ between staging and production vendor plans.",
      "A redirecting configured base_url becomes a hard, key-free failure (statusError 3xx, outcome other).",
      "A secret stored with a trailing CR/LF now fails as an invalid header value. The error is key-free and pinned by a test, but the request fails and no trimming is added.",
      "If one vendor fails step 0, that vendor keeps the query key with a vendor-scoped sanitizer, and residual (b), the access logs, remains under a signed acceptance.",
      "Other test fakes or recordingRT responders may still read the key from the query. Re-grep at spec time.",
      "The test file for the FMP @AC-1 gRPC-status and log assertions is still to be confirmed at spec time."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-08",
      "C-11",
      "C-15",
      "C-16",
      "C-18",
      "P-03",
      "P-06",
      "F-04",
      "F-07",
      "F-08"
    ],
    "rationale": "The round-3 proposal concretely adopts every round-2 objection, and the adversary found no Floor breach.\n- O-7 (the only blocking one) is met: @AC-1 traces to the D-1 header move, the fallback sanitizer is mandatory and tested with the bad-Location fixture, and the corrected D-2 purpose is carried by D-5 without rewriting D-2.\n- O-8 to O-11 are adopted as written.\n- O-12 is adopted, except that its http_3xx literal was wrong. That is corrected here as a settled fact rather than kept open.\n\nI spot-checked the adversary's new claims and all of them hold:\n- enrichmentClass returns fmt.Sprintf(\"http_%d\") (fmp_client.go:380).\n- HTTPErrorOutcome returns Other for a 3xx (otel.go:375-384).\n- signal-map-instrumentation.feature:15 still names an apikey=SECRET123 URL under @AC-13 @feature-294.\n- Finnhub GetFundamentalsMulti silently skips per-symbol errors (finnhub_client.go:80-85), while GetFundamentals returns them (:67-69).\n- The OQ open question lives in services/xstockstrat-marketdata/docs/context-constitution-findings.md, and a root file with the same name exists.\n\nThe synthesized approach folds in all four remaining refinements. They stay recorded as non-blocking open objections until the proposer adopts them. No objection blocks approval.\n\nRegister check: the approach honours D-1 to D-6, does not reintroduce R-1 to R-5, and keeps the sanitizer vendor-scoped per D-4. No petitions were filed and none were reopened.",
    "register_delta": {
      "new_decisions": [
        {
          "text": "A refused 3xx is pinned with two separate assertions: ErrorClass equals http_<code> (for example http_302), not a literal 'http_3xx', and the telemetry outcome is 'other'.",
          "evidence": "enrichmentClass returns fmt.Sprintf(\"http_%d\", se.code) at services/xstockstrat-marketdata/internal/fmp/fmp_client.go:380; HTTPErrorOutcome returns Other for codes outside 4xx/5xx at internal/telemetry/otel.go:375-384"
        },
        {
          "text": "The step-4 findings edit targets the service-scoped file services/xstockstrat-marketdata/docs/context-constitution-findings.md:39, not the root docs/context-constitution-findings.md.",
          "evidence": "The open 'never include the URL in errors' question is at services/xstockstrat-marketdata/docs/context-constitution-findings.md:39; a separate root docs/context-constitution-findings.md exists"
        }
      ],
      "new_rejected": [
        {
          "text": "Wrapping http.DefaultTransport in a runtime tripwire that rejects any request whose query holds apikey/token",
          "why": "One more moving part (C-18); the @AC-2 httptest tests already guard the same invariant at merge time"
        },
        {
          "text": "A Finnhub @AC-1 error-text test driven through GetFundamentalsMulti",
          "why": "Multi swallows per-symbol errors (finnhub_client.go:80-85), so the test would pass without testing anything; use single-symbol GetFundamentals (:67-69)"
        }
      ],
      "new_objections": [
        {
          "text": "[C-16/C-15] Amend 294 @AC-13 (signal-map-instrumentation.feature:13-15) in place with @feature-320: the Given sends key SECRET123 in the apikey header rather than in the URL, and the no-SECRET123 Then stays. Drop 'unchanged' from the step-3 pin, and leave fix-etf-flag-fill.feature:55 alone.",
          "blocking": false
        },
        {
          "text": "[C-08] Add a Finnhub @AC-1 case (302 + unparseable Location) through single-symbol GetFundamentals (finnhub_client.go:67-69), asserting no k-secret/token= and errors.As(*url.Error) false.",
          "blocking": false
        },
        {
          "text": "[C-08] Add a test with APIKey \"k-secret\\n\" through newLeakClient, asserted with assertNoKeyLeak, to pin the key-free header-validation error against future Go versions.",
          "blocking": false
        },
        {
          "text": "[D-6 refinement] Step 0 records %{http_version}. If it is HTTP/1.1, add a --http1.1 probe that sends the Go-canonical 'Apikey:' spelling.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-7",
          "how": "The round-3 proposal adopts all three parts: @AC-1 traces to the D-1 header move, the per-vendor fallback sanitizer is mandatory and tested with the 302 + bad-Location fixture, and the corrected D-2 purpose is recorded via D-5. The adversary confirmed that Location is parsed before checkRedirect."
        },
        {
          "id": "O-8",
          "how": "Step 2 lands the header move and CheckRedirect in one step, with the cross-host test written RED first."
        },
        {
          "id": "O-9",
          "how": "Step 0 covers all six paths. The key travels by a 0600 hdrfile or an unexported variable and never reaches argv, history or context.md."
        },
        {
          "id": "O-10",
          "how": "Step 5 records before and after values for ok, http_4xx, other and decode per vendor, with an explicit pass condition."
        },
        {
          "id": "O-11",
          "how": "An HTTPClient field-doc line at fmp_client.go:38 and finnhub_client.go:28. The adversary confirmed that no non-test code sets HTTPClient."
        },
        {
          "id": "O-12",
          "how": "Step 3 pins 294 @AC-13, 230 @AC-5 and 254 @AC-5/@AC-7 and adds the F-07 note. The http_3xx literal is corrected to http_<code> plus outcome 'other' by this round's decision."
        }
      ],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-13 — sdd-design

- Phase 0 Recon: recon.md was written earlier (2026-11-11). Services: xstockstrat-marketdata. Patterns reused: the 254 `*url.Error` unwrap and the per-request `c.apiKey()` read.
- Phase 1 Grilling: 3 rounds (full), approved by the operator at the gate after round 3. Chosen approach: send the vendor key in a per-request header (FMP `apikey`, Finnhub `X-Finnhub-Token`), with `CheckRedirect` → `http.ErrUseLastResponse` landing in the same step. Step 0 is the pre-merge vendor proof, and a vendor that fails it keeps a signed residual with a mandatory vendor-scoped sanitizer. Rejected: R-1 to R-7 (RoundTripper, shared package, query key + redaction as the primary fix, sentinel `CheckRedirect`, split steps, transport tripwire, a Finnhub test through `GetFundamentalsMulti`).
- Constitution rules touched: C-01, C-08, C-11, C-15, C-16, C-18, P-03, P-06, F-04, F-07, F-08. Floor breaches: none.
- Business rules (C-16): EXTEND 254 @AC-1, 254 @AC-2 and 294 @AC-13, each in place with `@feature-320`. PRESERVE 295 @AC-16, 230 @AC-5, 254 @AC-5 and 254 @AC-7. There is no CHANGE, so no operator sign-off is needed, and no operator decisions were recorded.
- debate.md: State is approved. No reopen petitions were filed, so none needed a decline. O-13 to O-16 remain open and non-blocking, and are folded into design.md.
- Status: spec-ready → design-approved.

### Decisions

- D-1 to D-8 as settled in debate.md. In short:
  - header auth (D-1);
  - same-step `CheckRedirect`, with the cross-host test RED first (D-2, D-5);
  - no general sanitizer (D-3);
  - @AC-1 traces to the header move, plus the mandatory per-vendor fallback sanitizer (D-4);
  - a six-path step-0 proof and a step-5 outcome check (D-6);
  - a refused 3xx is pinned as `http_<code>` plus outcome `other` (D-7);
  - the findings edit targets the service-scoped `context-constitution-findings.md:39` (D-8).

### Open Threads

- [ ] The vendor header contract is unverifiable in the repo. A wrong header name means 401/403 on every call while the unit tests stay green. Target: step 0 (pre-merge proof across all six paths, with protocol and header-case fidelity).
- [ ] Step 0 assumes the operator's host behaves like marketdata's egress (no source-IP dependence), and vendor plans may differ between staging and production. Target: step 0 (both `base_url` overrides) and step 5.
- [ ] A redirecting configured `base_url` becomes a hard, key-free failure (`statusError` 3xx, outcome `other`). Target: step 0 (no-redirect check) and step 5.
- [ ] A secret stored with a trailing CR/LF now fails as an invalid header value. The error is key-free and test-pinned, and no trimming is added. Target: step 1 (CR/LF test) and step 5.
- [ ] If one vendor fails step 0, it keeps the query key with a vendor-scoped sanitizer, and residual (b) stays under a signed OQ2 acceptance. Target: step 0 (D-4 fallback).
- [ ] Other test fakes or `recordingRT` responders may still read the key from the query. Target: `/sdd-spec` re-grep, then step 2.
- [ ] The test file for the FMP @AC-1 gRPC-status and log assertions is not yet confirmed (near `marketdata_service_test.go:4405`). Target: `/sdd-spec` (step 1).
- [ ] O-13 to O-16 (the 294 @AC-13 Given amendment, the Finnhub @AC-1 test via `GetFundamentals`, the CR/LF test, the `%{http_version}` probe) are still open in debate.md. Target: `/sdd-spec` carries each as a concrete step item.

## Session 2026-11-13 — sdd-spec

- Generated implementation-spec.md with 6 steps. Status: design-approved → implementation-ready.
- Tree: detached@b2a6744d ≡ origin/feature/fix-vendor-key-in-url (clean).
- Step layout:
  - Step 1 (docs) is the operator's pre-merge vendor header proof (design step 0, D-6, O-16). It is a hard gate before any code.
  - Steps 2-5 are one atomic unit, U1 (D-5, F-08): FMP service, FMP test, Finnhub service, Finnhub test.
  - Step 6 (docs) covers CLAUDE.md, the new MARKETDATA-18, the resolved finding and the in-place `@feature-320` amendments (O-13).
  - Design step 5 (the post-deploy outcome check) is a `## Post-Deploy Confirmation` section, not an execute step.
- Key codebase findings:
  - The key sites are confirmed as `fmp_client.go:260` (`params.Set("apikey", …)`, nil guard `:257-259`) and `finnhub_client.go:126` (nil guard `:123-125`). The default clients are at `:73` and `:46`. No production code injects an `HTTPClient` (`cmd/server/main.go:221-229,263-275`).
  - The re-grep of tests that read the key from the query found only the known sites: `fmp_client_test.go:616,625-626`, `finnhub_client_test.go:394,402`, and `cmd/server/main_test.go:171`, through callers at `:195,196,297` with assertions at `:221,318,328,363`. No other fake or `recordingRT` responder reads the key (Open Thread closed).
  - The FMP @AC-1 service-level test home is confirmed as `internal/service/marketdata_service_test.go`, next to `TestFundamentals_TransportErrorStatusIsKeyFree_feature254` (`:4393-4417`). That file has no `bytes` import, so the log capture uses a `strings.Builder` (Open Thread closed).
  - Citation correction: `telemetry.HTTPErrorOutcome` is at `internal/telemetry/otel.go:362-372`, not `:375-384` as the design says. A 3xx still maps to `Other`.
  - Next free marketdata migration: not needed (recon: none).

### Decisions

- **U1 spans both vendors (4 steps, the cap).** The design makes step 2 one atomic step over both clients, their tests and `cmd/server/main_test.go`. The shared `newVendorFake` serves both vendors.
- **Cross-host redirect test RED twice.** Inside U1 it is recorded RED against the pre-unit tree (host B is hit) and again after the header move but before `CheckRedirect` (host B receives the key header). Both runs go in this log (D-5, P-06).
- **D-4 fallback is not pre-written.** If a vendor fails Step 1, execute stops. The operator signs an OQ2 residual for that vendor, and `/sdd-spec` re-runs to replace that vendor's U1 members with the query-key plus vendor-scoped sanitizer shape. Its shape depends on which vendor fails (P-03, F-09).
- **The `params == nil` guards are deleted with the `params.Set` lines.** Their only job was to make `Set` safe on a nil map, and the change would otherwise leave them orphaned.
- **Spec-time precision on the C-16 amendments.** The design lists the Finnhub redirect case under 254 `@AC-1`, but `@AC-1` is the FMP scenario. The Finnhub redirect case lands in the Finnhub scenario 254 `@AC-2`, and each vendor scenario gains both its redirect line and its "request URL carries no key" line. This is still EXTEND only, and every 254 line is kept.
- **The Security role is added as a reviewer on Steps 2-5.** The registry's Security scope covers API keys and secrets.
- O-13 → Step 6; O-14 → Step 5; O-15 → Step 3; O-16 → Step 1.

### Open Threads

- [ ] Step 1: the operator runs the vendor header proof (six paths plus both `base_url` overrides) and records it here. It gates U1.
- [ ] After the dev deploy: the Post-Deploy Confirmation (ok, http_4xx, other and decode per vendor, with a non-zero `ok` positive control).

## Session 2026-11-13 — sdd-review impl-spec (advisory)

- Result: 0 failures, 8 warnings (advisory, did not block). Overlap: PASS. Lifecycle is unchanged (`implementation-ready`).
- Tree: `7e637a28` → `2cd3bf5f` (the implementation-spec.md edits).
- Overlap findings:
  - `marketdata_service_test.go` with `fix-grpc-status-mapping` (326) is low risk: 326 only reads `:4281`.
  - `cmd/server/main_test.go` has no overlap.
  - If 326 lands first, re-anchor Step 3 by symbol. The spec already says this in § Step Dependencies.

### Addressed (implementation-spec.md edited)

- [x] W1, unverified line numbers in Steps 2-5. I re-read every client citation, plus `etf_flags.go:131`, `marketdata_service.go:1856`, `marketdata_service_test.go:4417`, `main_test.go:157-363` and the two repointed AC-13 tests. All hold. A `**Review re-check**` header line records this.
- [x] W2, MARKETDATA-17 and the `:5` log.
  - Rule rows run `:17-32`, and MARKETDATA-17 is the highest. MARKETDATA-15 is only a `(candidate)` at `:55`, so 18 is the next free ID, and nothing uses 18 yet.
  - The `:5` line ends in `).`. Step 6 now says to insert the amendment before the closing `.`, and to re-check the highest ID at execute time.
- [x] W3, Steps 2 and 4 were not linted. Both step-local Verifications now run `golangci-lint run --modules-download-mode=mod`, matching CI `ci.yml:310-317`.
- [x] W5, the "do not edit by hand" `.feature` header.
  - No CI or hook reads `services/*/acceptance/`.
  - The only `.feature`-aware guard, `check-otel-produced-signals.sh`, keeps `.feature` files outside its glob (`.test.sh:402`).
  - This is now recorded in Step 6, item 5.
- [x] W6, the DRY check.
  - The real tool is `scripts/check-duplication.sh`, which is report-only for Go.
  - The active pre-commit hook calls `scripts/check-duplication.py`, and that file does not exist in this tree. This is why the check "did not run".
  - Step 5's union now runs the `.sh` check. A pairing of the two `CheckRedirect` literals is the accepted R-2/C-18 trade-off, to be logged here; any other clone gets fixed.
- [x] W7, the CR/LF header-validation text.
  - Verified on Go 1.27.0: `transport.go` `validateHeaders` names only the header name.
  - A probe with `apikey: k-secret\n` gave `net/http: invalid header field value for "Apikey"` with 0 server hits. The evidence is now in Step 3.

### Still open (carried into /sdd-execute)

- [ ] W4: Step 1 is the operator gate that blocks all code. A FAIL for FMP or Finnhub invalidates Steps 2-5 for that vendor. Execute then stops, the operator signs an OQ2 residual, and `/sdd-spec` re-runs (D-4; P-03/F-09). This is a recorded decision, not a defect. Step 1 now states that the FAIL invalidates Steps 2-5.
- [ ] W8: the product spec and the design cite the Finnhub redirect scenario under 254 `@AC-1`, but the spec moves it to 254 `@AC-2`. At integration, check that the traceability matrix cites `@AC-2` for the Finnhub redirect case. A note was added under § Scenario Coverage.
- [ ] Tooling drift, outside this feature's scope: the active husky hook invokes the missing `scripts/check-duplication.py`, so the pre-commit DRY check is a no-op in this tree. Surface this to the operator. It is not fixed here.

## Session 2026-11-13 — sdd-execute sequential (sdd-batch-execute)

- Up-front confirmation: the operator approved the plan with this record (binding, verbatim):

  `{"mainDev":"d5de836b1a99591c992a17b46a688469f5b1ae98","dev":"4947a43c175f10ebe203726c515ac7783b62a5b9","specHash":"2683f5581a966a114adfc834eff2862ef1e8efe2","directive":"conditional","pending":[1,2,3,4,5,6],"mismatches":[{"n":2,"detail":"Line drift only; the code and the Files paths still match. `HTTPErrorOutcome` is now at services/xstockstrat-marketdata/internal/telemetry/otel.go:375-385, not :362-372. The merged peer commits added hostProvider/hostlabel to otel.go. The behavior is unchanged: a 3xx still returns `Other`. The CI golangci-lint citation `.github/workflows/ci.yml:310-317` is now :352-357 (`args: --modules-download-mode=mod` at :357). Every other Step 2 anchor holds: fmp_client.go :38, :69, :70, :73, :79, :93, :254-255, :257-260, :263-272, :266, :289-296, :308, :319-329, :331, :380, :389-390, :396/:406/:419; etf_flags.go:131 and :170-175; no non-test `HTTPClient:`; main.go :263-275/:266 and :224. Tooling advisory, not a spec mismatch: the host golangci-lint is v2.5.0 built with go1.25.1, not the pinned v2.14.0/go1.27. The documented tooling-setup install (`GOTOOLCHAIN=go1.27.0 go install ...golangci-lint@v2.14.0`) is needed before this step's lint check and Steps 4 and 5."},{"n":4,"detail":"The cited `internal/telemetry/otel.go:362-372` for `HTTPErrorOutcome` is now at :375-385. The behavior is unchanged: a 3xx still gives outcome `other`. Every finnhub_client.go anchor holds: :28, :42, :43, :46, :52-55, :58, :120-121, :123-126, :129-138, :132, :140-147, :155-157, :167-173, :181-184, :192-194, :200/:204, and :67-69, :80-85, :92-104 for R-7. main.go:221-229 holds."},{"n":5,"detail":"The Verification command runs `DUP_REPORT_ONLY=1 bash scripts/check-duplication.sh services/xstockstrat-marketdata/internal`, but scripts/check-duplication.sh no longer exists. Commit c87c084c ported it to Python, and `.husky/pre-commit` now calls `python3 scripts/check-duplication.py`. The spec's note \"`scripts/check-duplication.py` does not exist\" is now the reverse of the truth. The DRY step should be `DUP_REPORT_ONLY=1 python3 scripts/check-duplication.py services/xstockstrat-marketdata/internal`. Separately, the `.github/workflows/ci.yml` citation has drifted: COVERPKGS/coverpkg are now at :374-375 and lint at :352-357. Every other Step 5 anchor holds: finnhub_client_test.go :26-27, :245-250, :261-276, :278-280, :283/:289/:295, :312, :333, :385, :394, :402-404, :406-416; main_test.go :81-91, :157, :165, :171, :195, :196, :221, :289, :297, :318, :328, :363, :377. The only `URL.Query().Get(` hits are :171 and finnhub :394, both of which the step repoints."},{"n":6,"detail":"Several anchors for this step no longer exist after the merge (main-dev context refresh 5c4cc935 / #1539). (a) services/xstockstrat-marketdata/CLAUDE.md:194-200: CLAUDE.md § Fundamentals Integration (:107-109) is now a one-line pointer to docs/fundamentals.md. The vendor-secret paragraph ending \"Every other knob (`enabled`, `base_url`, cache/quota settings) remains an ordinary config key.\" now lives at services/xstockstrat-marketdata/docs/fundamentals.md:66-72. As written, Instruction 1, its Verification (`grep -n \"X-Finnhub-Token\" CLAUDE.md`, `grep -n \"feature 320\" CLAUDE.md`) and the Files entry target the wrong file; docs/fundamentals.md is not listed in Files. The Execution Summary deploy-file audit cites the same stale CLAUDE.md:194-200. (b) docs/context-constitution.md: the `:5` amendment log line (\"…added MARKETDATA-17 …; `~L` hints re-stamped throughout).\") is gone. The header now reads \"last refreshed 2026-11-13 (`main-dev` @ `52f6d5a`)\", and :5 is a description line. Instruction 2's last bullet and the Verification `grep -n \"amended 2026-11-13 (feature 320\"` have no anchor. Other line drift: the row format is at :13 (not :15), rule rows at :15-30, MARKETDATA-17 at :30 (not :32), `## Norms` at :32 (not :34), and the MARKETDATA-15 candidate at :50 (not :55). MARKETDATA-18 is still free (`grep -c` = 0). (c) docs/context-constitution-findings.md: the fmp.getJSON open question is now one bullet at :40, not :39. The combined \"(carried above) — and\" clause that Instruction 3 says to drop from :40 no longer exists; the `newFundamentalsSource` fail-open question is its own bullet at :41, still **open**. `## Resolved` is at :47 (not :46). (d) The acceptance anchors hold: fix-marketdata-secret-exposure.feature :9-15/:17-23, signal-map-instrumentation.feature :1, :13, :15, :19 and fix-etf-flag-fill.feature:55."}]}`

- Merge: `origin/main-dev` @ `d5de836b` merged into `feature/fix-vendor-key-in-url` (`01b6ce32`). The one conflict, `docs/roadmap/ledger/fails.md`, was resolved by `merge-train-resolve` (union); `ledger-guard` was clean.
- Re-spec (directive conditional, sequential-mode §5.3), step bodies 2, 4, 5 and 6 only:
  - `f27fa725` respec(fix-vendor-key-in-url): align steps 2,4,5,6 with current codebase
- Re-spec decisions:
  - Step 6 now targets `docs/fundamentals.md:72` for the vendor-secret sentence; `CLAUDE.md` is no longer edited (it is a pointer).
  - The constitution header no longer keeps a per-feature amendment log, so the "amended 2026-11-13 (feature 320 …)" header entry and its Verification grep were dropped; the MARKETDATA-18 row is the record.
  - The findings edit is now "delete the `:40` bullet"; the `:41` `newFundamentalsSource` bullet stays open and untouched.
  - Step 5's DRY check now runs `python3 scripts/check-duplication.py`. This also closes the earlier "missing `check-duplication.py`" tooling-drift thread: the hook's script exists now.
- Not re-spec'd (outside step bodies): the Execution Summary deploy-file audit still cites `CLAUDE.md:194-200`, and the Step 6 title still says "marketdata CLAUDE.md". Both are stale prose only.
- Tooling setup (steps 1-6): go1.27 ✓ · golangci-lint ✗ v2.5.0/go1.25.1 on the host (install the pinned v2.14.0 with `GOTOOLCHAIN=go1.27.0` at the first lint check, Step 2) · python3 3.13 ✓ · pre-commit hook ✓.
- Status: implementation-ready → in-progress.

```sdd-batch-setup
{"mainDev":"d5de836b1a99591c992a17b46a688469f5b1ae98","date":"2026-11-13"}
```
