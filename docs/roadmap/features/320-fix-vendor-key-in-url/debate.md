# Debate Register: fix-vendor-key-in-url

**State**: in-debate
**Mode**: full
**Rounds run**: 2 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-11 | /sdd-batch | 3 | 3 | 0 | 6 | 0 | yes |
| 2 | 2026-11-11 | /sdd-batch | 3 | 2 | 6 | 6 | 0 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | Send the vendor key in a per-request header (FMP apikey, Finnhub X-Finnhub-Token), read via c.apiKey() on every call, and remove the params.Set key lines. | fmp_client.go:260, finnhub_client.go:126 (verified by grep); closures at fmp_client.go:79-81, finnhub_client.go:52-55 | settled |
| D-2 | 1 | Set CheckRedirect returning http.ErrUseLastResponse on the default client in both NewClients; refused 3xx flows through the existing secret-free status paths. | fmp_client.go:73,306-309; finnhub_client.go:46,154-157; telemetry/otel.go:362-372 | settled |
| D-3 | 1 | No redactURLError helper (OQ3); keep the 254 url.Error unwrap sites and the errors.As-false tests. | fmp_client.go:268-269,292-295; finnhub_client.go:134-137,143-146; fails.md:3049 | settled |
| D-4 | 2 | Residual (a), the unparseable-Location echo, is closed by D-1 (no key in the query), not by CheckRedirect, and @AC-1 traces to the header-move step. Under a step-0 per-vendor fallback, the R-3 vendor-scoped sanitizer is mandatory for that vendor and is tested with the 302 + bad-Location fixture. | net/http Client.do parses Location (uerr 'failed to parse Location header') before c.checkRedirect; the error leaves via fmp_client.go:290-295 and finnhub_client.go:143-146 | settled |
| D-5 | 2 | D-2's purpose is to stop the custom key header being forwarded on a cross-host redirect and to turn a parseable 3xx into statusError / 'returned HTTP %d'. CheckRedirect lands in the same step as the header move, with the cross-host test written RED first inside that step. | Go strips only Authorization, WWW-Authenticate, Cookie and Cookie2 on redirect; fmp_client.go:73,306-309; finnhub_client.go:46,154-157 | settled |
| D-6 | 2 | Step-0 vendor proof covers all six endpoint paths with 200 and a non-empty payload, passes the key via a header file or an unexported variable, and records no command line containing the key. The step-5 confirmation records before and after values for outcome ok, http_4xx, other and decode per vendor. | fmp_client.go:396,406 (/stable/quote, /stable/ratios-ttm) and the Finnhub /stock/metric, /quote, /stock/profile2 paths; telemetry/otel.go:362-372 maps 3xx to other | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | Header-injecting RoundTripper | Re-injects the key on every redirect hop, including cross-host | locked |
| R-2 | 1 | Shared vendor-HTTP package for the client literals | Two one-line literals; fails C-18 | locked |
| R-3 | 1 | Query key plus redactURLError only (as the primary fix) | Does not close residual (b), the access logs; kept only as a per-vendor fallback if step 0 fails | locked |
| R-4 | 2 | CheckRedirect returning a sentinel error instead of http.ErrUseLastResponse | Turns a 3xx into a transport *url.Error and loses the status code that statusError{path,3xx} keeps | locked |
| R-5 | 2 | Landing CheckRedirect in a later step than the header move | Opens a window where the custom key header follows a cross-host redirect | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | Tests that read the key from the query (main_test.go:165-171,195-196,289,297; finnhub_client_test.go:394; fmp_client_test.go:625-626) must move to header reads in the same step as the header move, or the 295 @AC-16 guard breaks. | yes | closed @ round 2 (The proposal repoints newVendorFake (main_test.go:165,171) and its callers :195,:196,:297, plus finnhub_client_test.go:394 and fmp_client_test.go:625-626, in the header-move step, listed in Files; the adversary verified the lines.) |
| O-2 | 1 | OQ1 vendor header-auth proof must be a numbered pre-merge step 0 recorded in context.md (docs quote, or operator-run 200 with non-empty payload), plus a recorded post-deploy http_4xx check; a dev smoke test cannot gate the merge. | yes | closed @ round 2 (Step 0 is a pre-merge, direct-to-vendor curl gate recorded in context.md with status, payload and docs quote, run outside marketdata so the enabled/snapshot_source defaults do not block it; step 5 is a recorded post-deploy check. Endpoint coverage and outcome set are refined under new non-blocking objections.) |
| O-3 | 1 | Redirect and AC-1 tests must use HTTPClient nil with BaseURL set to httptest; the cross-host test goes RED after the header move. | no | closed @ round 2 (The tests use HTTPClient nil with BaseURL set to httptest and avoid newTestClient/recordingRT; the cross-host test is shown RED inside the combined step.) |
| O-4 | 1 | Confirm the seeded base_url values are canonical (no redirect) as part of step 0. | no | closed @ round 2 (The step-0 curl runs without -L and records %{http_code} %{redirect_url} against the configured staging and production base_url values.) |
| O-5 | 1 | Rewrite or delete about 10 inline comments that claim the URL carries the key. | no | closed @ round 2 (The comment rewrite/delete list (fmp_client.go:254-255,266,308,331,389; finnhub_client.go:120-121,132,156; etf_flags.go:131) is an explicit step, with each rewrite stating the new constraint.) |
| O-6 | 1 | Amend 254 @AC-1 and @AC-2 in place with @feature-320; word the AC-2 Then as 'the request URL received by the vendor endpoint'. | no | closed @ round 2 (Step 4 amends 254 @AC-1 and @AC-2 in place with @feature-320, and the @AC-2 Then reads 'the request URL received by the vendor endpoint'.) |
| O-7 | 2 | D-2's stated reason is wrong: Location is parsed before checkRedirect, so @AC-1 must trace to the header move, the per-vendor fallback sanitizer is mandatory, and the D-2 rationale must read 'blocks cross-host key-header forwarding and turns a parseable 3xx into a statusError'. | yes | open |
| O-8 | 2 | The header move and CheckRedirect must land in one step, with the cross-host test written RED first. | no | open |
| O-9 | 2 | Step 0 must cover all six endpoints and keep the key out of argv, shell history and context.md. | no | open |
| O-10 | 2 | Step 5 must track ok, http_4xx, other and decode per vendor, not http_4xx alone. | no | open |
| O-11 | 2 | Add an HTTPClient field-doc line: callers must refuse redirects; the key travels in a header. | no | open |
| O-12 | 2 | Pin 294 @AC-13, 230 @AC-5 (bounded ErrorClass for a 3xx) and 254 @AC-5/@AC-7 in the spec; add an F-07 note that the header names are vendor protocol constants. | no | open |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
