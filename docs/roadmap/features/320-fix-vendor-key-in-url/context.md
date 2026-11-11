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
