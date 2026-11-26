# Context Log: fix-a-filtered-listopportunities

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-25 (/sdd-triage)

- Bug reported via defect report `docs/reports/2026-11-25-analysis-filtered-empty-opportunity-read-kicks-full-recompute-defect.md` (GitHub Issues disabled): a filtered ListOpportunities read with no matches kicks a full recompute
- Severity: SEV-3
- Routed to SDD path (Track C)
- Created: feature.md, product-spec.md, acceptance.feature (regression scenarios), context.md
- Affected services (from report): xstockstrat-analysis
- Root cause hypothesis: the no-rows branch tests the filtered fresh read and sets kick_full unconditionally (servicer.py:4765-4788)
- Recommended design depth: skip → `/sdd-spec fix-a-filtered-listopportunities` (rationale: SEV-3, single service, no proto/migration/config, clear root cause)
- Development branch: feature/fix-a-filtered-listopportunities
- Note: the behavior was used deliberately on 2026-11-25 as a no-DB lever to force a homelab queue recompute (`list_opportunities(min_conviction=1.01)`); the fix removes that lever, so a manual-recompute path should be considered at /sdd-spec (none exists today — no refresh/invalidate RPC).

## Session 2026-11-26 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings (criteria verdict PASS WITH WARNINGS; no fails, no floor breaches):
  - Criterion 8 (C-15): AC-3's Then stated an internal step — **resolved**: AC-3 now asserts a follow-up read returns `computing` false once the background compute finishes. AC-1's "no background recompute starts" is backed by the observable unchanged `valid_until`; AC-4 asserts `valid_until` advancing.
  - Criterion 8: the filtered-empty case where fresh rows exist but all are muted/snoozed is excluded only by an AC-1 Given; the `has_fresh` gate covers it but no scenario asserts it — design decides whether a scenario is warranted.
  - Criterion 9: no Open Questions section; the manual-recompute lever decision is deferred to design (Out of Scope already states it).
  - Criterion 11: Consumer Surface(s) not in checkbox form; clear, not a violation — no change.
  - Caller passed a doubled-prefix spec path; the real files are under `docs/roadmap/features/365-fix-a-filtered-listopportunities/`.
- Overlap findings (WARN only; no config-key, proto or migration collision):
  - `services/xstockstrat-analysis/app/handlers/servicer.py` `_read_opportunity_queue` (4758-4820) shared with 330-fix-live-enrich-ttl-seed (in-progress): 330's cited reader line 4819 is stale and now sits inside the function 365 rewrites; 330 expects no reader code change — low risk, possible merge conflict; re-verify at merge.
  - Same file vs 366-opportunity-live-only-rotation (spec-ready): 366 changes `_compute_opportunities` step 2b (~5359) and queue `replace_for_user`; semantic coupling on per-row `valid_until` — 365 AC-1/AC-4 `valid_until` fixtures and assertions must stay consistent with 366.
  - Same file vs 308-fix-analysis-per-symbol-isolation (implementation-ready, ~5742/5824/5916) and 327-fix-analysis-evidence-dry (implementation-ready, ~7282): distant lines, low risk.
  - 364-fix-gapsonly-backfill-is: no collision (draft; marketdata/ingest only).
  - Merge-order: no entries for 364/365/366/330 in `merge-order.md`; no blocking row required. Coordination note: merge 365 before or with 366; re-verify 330's reader-line reference at merge time.
- Recommended design depth: full (rubric default full; WARN-level overlap findings rule out quick; operator's /sdd-batch runs the full debate — keep it proportionate).

### OPERATOR DECISIONS (binding, recorded 2026-11-26)

- Operator 2026-11-25: SEV-3, Track C. Triage recommended design depth 'skip'; operator chose the /sdd-batch workflow, which runs a full design debate — keep the design proportionate (single service, clear root cause).
- Root cause evidence: services/xstockstrat-analysis/app/handlers/servicer.py _read_opportunity_queue no-rows branch sets q.kick_full=True after a FILTERED fresh read (min_conviction/sources/action_filter/symbol), so a filtered-empty read kicks a full recompute despite fresh rows; repo already has has_fresh (app/repositories/opportunities.py). UI /trader/positions/[symbol] polls with a symbol filter every 15s.
- The fix removes the only no-DB lever used on 2026-11-25 to force a recompute (list_opportunities(min_conviction=1.01)); there is no refresh/invalidate RPC. Design must state whether a deliberate manual-recompute path is in or out of scope (default: out of scope; record the decision).
- Cross-feature: 366-opportunity-live-only-rotation changes _compute_opportunities and queue persistence in the same servicer; coordinate merge order.

## Session 2026-11-26 — sdd-batch design gate (round 2)

Full debate (/sdd-design via /sdd-batch) halted at the approval gate after round 2 (gate policy: halt). design.md is not written and status.md is unchanged (still spec-ready). The register is in `debate.md` (D-1..D-6, R-1..R-6, O-1..O-8).

## Open Threads

- **Approach (converged, adversary SOUND):** a one-line production change in `_read_opportunity_queue` (`services/xstockstrat-analysis/app/handlers/servicer.py`). The bare `else:` at servicer.py:4790 becomes `elif not await opps.has_fresh(user_id):`, with no re-indent (D-1/D-5). A constraint comment of at most 2 lines on the elif line names the fresh-but-filtered-empty fall-through (no kick, empty page, FR-1). The now-false comment at 4792 is dropped or reworded. When fresh rows exist but the filter matches nothing, the read returns an empty page, makes no kick, and keeps `served_include_expired=False`, so the feature-190 O7 facet pairing holds (AC-1/AC-2). Cold and all-stale reads run the existing body byte-for-byte, with `kick_full` still set before the state read (AC-3/AC-4). The single test-first step names in its Files list (a) the deadline kick-spy tests, (b) the `_opp_svc` has_fresh stub, (c) the `test_opportunities_repo.py` stub, (d) the `conftest.py:298` `"has_fresh": "fetchval"` mapping, (e) a real_pg `has_fresh` test in `tests/test_opportunities_repo.py`, (f) the `docs/opportunities.md:7` sentence, and (g) this context.md. There are no proto, migration, config or cross-service changes.
- **Strongest open objection (O-6, non-blocking, C-15):** kick-spy tests replace the kick with a MagicMock, so they cannot check the `valid_until` and follow-up-read Then clauses of AC-1..AC-4. Either add one real-kick test for AC-3/AC-4 (pattern at test_opportunity_compute_state.py:76-98), or record in Verification that kick-called is the accepted proxy. Also open and non-blocking: O-7 (confirm has_fresh routes via fetchval so the fetchrow timeout injection still targets the state read; optionally pin has_fresh timeout gives UNAVAILABLE with no kick) and O-8 (item (e) names its target file; label the fresh-plus-DISMISSed case a D-3 pin or drop it). The r2 correction that `_FakeOppRepo` does filter (include_expired, min_conviction, DISMISS/SNOOZE) is folded in as D-6: use seeded-fake tests, and patch the read only for AC-2. O-1..O-5 closed in round 2.
- **Floor status:** no Floor breaches.
- **Uncovered @AC changes:** none. AC-1 and AC-2 are CHANGEs covered by the operator decision. AC-3, AC-4 and feature 185 @AC-6/@AC-7 are PRESERVE.
- **Decisions to carry:** D-2 says a manual recompute or invalidate path is out of scope; the `min_conviction=1.01` lever is removed deliberately and any replacement is a separate /sdd-story. D-4 sets merge order 365 before 366 and a cross-feature constraint: one compute stamps a single `valid_until` on every row it writes. **Flagged as an input for 366's design**: if 366 breaks that constraint, D-3 (mixed freshness) must be re-evaluated, and 366's rebase must keep the elif fall-through.
- **Open risks:** mixed freshness (D-3): a symbol whose only row is a stale leftover shows "no opportunity" until the heal or the daily refresh. All-dismissed or all-snoozed fresh rows no longer kick (accepted). There is no longer any no-DB way to force a recompute. Merge coupling with 366. A has_fresh timeout on a cold read drops the kick, and no test pins this unless the optional O-7 test is added.
- **Next:** the operator approves the gate, or the next /sdd-batch run resumes from the state block below.

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "The production change is one line in _read_opportunity_queue, in services/xstockstrat-analysis/app/handlers/servicer.py. The bare 'else:' at servicer.py:4790 becomes 'elif not await opps.has_fresh(user_id):'. This has the same meaning as D-1; the elif form keeps the cold and all-stale body at its current indentation. The new constraint comment, at most 2 lines, goes ON the elif line and names the case that falls through: \"fresh-but-filtered-empty falls through deliberately: no kick, empty page (365 FR-1); reached only when the user has no fresh row.\" The comment at 4792 ('every no-rows branch revalidates in the background') is now false, so drop it or reword it to \"cold or all-stale: revalidate in the background\".\n\nResulting behaviour:\n- Fresh rows exist but the filter matches nothing: rows stays the empty filtered fresh read (q.rows = rows, 4820) and every q flag keeps its default. No kick, computing is false, and served_include_expired is False, so the facet read stays on include_expired=False and the feature-190 O7 pairing holds (FR-1, AC-1/AC-2).\n- No fresh row: the existing body runs byte-for-byte. That is count_for_user (4791), then q.kick_full=True set before the state read (4798), then the cold path (4793-4806) or the all-stale path (4807-4819) (FR-2, AC-3/AC-4).\n- has_fresh (app/repositories/opportunities.py:340-348) runs before count_for_user, not instead of it. On the pooled path it uses the same budgeted connection: the adversary confirmed OpportunitiesRepository(bc) is built at servicer.py:611/4703 and BudgetedConn.fetchval exists at app/repositories/read_budget.py:52.\n\nThe single step is test-first. Its Files list must name every file below.\n\n(a) tests/test_list_opportunities_deadlines.py: kick-spy tests on both the pool and no-pool paths.\n- Correction to the r2 proposal: _FakeOppRepo is not filter-blind. It applies include_expired, the min_conviction floor and DISMISS/SNOOZE, and it ignores only sources, action_filter and symbol (tests/test_analysis_servicer.py:4531-4557). Its has_fresh is a real implementation (:4515-4517).\n- Run AC-1 (fresh rows, min_conviction=1.01), AC-3 (no rows) and AC-4 (stale rows only, min_conviction=1.01) over the unpatched fake, seeding rows with _row(fresh=True/False) (test_list_opportunities_deadlines.py:40-52).\n- Patch only the include_expired=False read, and only for AC-2 (symbol filter, which the fake ignores). Override has_fresh only where the seeded rows cannot express the case.\n- The all-dismissed/snoozed case needs no patch: seed fresh rows plus DISMISS/SNOOZE actions in fake.actions, and assert no kick.\n- Kick-spy tests (_record_kicks, :91-104) never run a recompute. So either cover AC-3/AC-4 with one real-kick test (stub _compute_opportunities and drain _opportunity_recomputing, as test_opportunity_compute_state.py:76-98 does), or state in the step's Verification that \"kick called / not called\" is the accepted proxy for the valid_until and follow-up-read Then clauses of AC-1..AC-4.\n\n(b) tests/test_opportunity_compute_state.py:45-53 _opp_svc(): add 'svc._opportunities_repo.has_fresh = AsyncMock(return_value=False)'. This keeps the feature-185 @AC-6/@AC-7 guards green.\n\n(c) tests/test_opportunities_repo.py:657-668 stub: add 'has_fresh = AsyncMock(return_value=False)'. The stub is a plain MagicMock, so without this the await raises TypeError.\n\n(d) tests/conftest.py:298: set _BC_METHOD_FOR = {\"count_for_user\": \"fetchval\", \"get\": \"fetchrow\", \"has_fresh\": \"fetchval\"}. This makes has_fresh go through fetchval, so the raise_on={\"fetchrow\": ...} injection in test_compute_state_timeout_kicks_once_then_unavailable (:331-337) still hits the state read and not has_fresh. Optionally add one test that a has_fresh timeout gives UNAVAILABLE with no kick, matching today's count_for_user-timeout behaviour.\n\n(e) tests/test_opportunities_repo.py: add one real_pg test of OpportunitiesRepository.has_fresh. A fresh row gives True; only expired rows gives False. The fresh-plus-DISMISSed case is labelled as a D-3 pin (the SQL never reads opportunity_actions), not as a behaviour test.\n\n(f) services/xstockstrat-analysis/docs/opportunities.md:7: change the feature-215 symbol-filter sentence to say the stale (include_expired=True) read runs only when the user has no fresh row.\n\n(g) This feature's context.md: record D-2 (manual recompute/invalidate is out of scope) and the D-4 constraint (one compute stamps a single valid_until on every row it writes). Also flag that constraint as an input for 366's design.\n\nThere are no proto, migration, config or cross-service changes. Merge order is 365 before 366; 366 rebases over one elif line plus its comment.",
    "open_objections": [
      {
        "text": "[C-15/P-06, adversary r2] The proposal said _FakeOppRepo does not filter, which is wrong: it applies include_expired, min_conviction and DISMISS/SNOOZE (test_analysis_servicer.py:4531-4557, verified). Patching the fresh read to [] and overriding has_fresh in every scenario risks a vacuous green (fails.md:801/1649/2656). The fix is folded into (a): use the unpatched seeded fake for AC-1, AC-3, AC-4 and the dismissed/snoozed case, and patch the read only for AC-2. It stays open until the proposer adopts it.",
        "blocking": false
      },
      {
        "text": "[C-15, adversary r2] Kick-spy tests cannot check the valid_until and follow-up-read Then clauses of AC-1..AC-4 (_record_kicks replaces the kick with a MagicMock). Either add one real-kick test for AC-3/AC-4 (pattern at test_opportunity_compute_state.py:76-98), or record in Verification that kick-called is the accepted proxy.",
        "blocking": false
      },
      {
        "text": "[C-18, adversary r2] The no-kick case is a silent fall-through after 'if rows: ... elif not has_fresh:'. Put the constraint comment (at most 2 lines) on the elif line, naming the fresh-but-filtered-empty fall-through, so 366's rebase cannot break it unnoticed.",
        "blocking": false
      },
      {
        "text": "[C-08, adversary r2] has_fresh adds one statement before the kick on the cold path. Confirm that (d) maps has_fresh to fetchval, so the fetchrow injection in test_compute_state_timeout_kicks_once_then_unavailable (:331-337) still targets the state read. Optionally pin 'has_fresh timeout gives UNAVAILABLE with no kick'.",
        "blocking": false
      },
      {
        "text": "[F-08/C-18, adversary r2] Item (e) must name tests/test_opportunities_repo.py as its target file. Its fresh-plus-DISMISSed case passes by construction (the SQL never reads opportunity_actions), so label it a D-3 pin or drop it.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "AC-1",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-2",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-3",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-4",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "opportunity-compute-robustness @AC-6 (feature 185)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "opportunity-compute-robustness @AC-7 (feature 185)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "An explicit 'if await opps.has_fresh(...): pass' with the body moved under 'else:' (the proposer's runner-up). It makes the no-kick branch visible, but it re-indents about 30 lines and enlarges 366's rebase. 'elif' with a comment on the same line gets both benefits.",
      "Blanket test patching: fresh read forced to [] and has_fresh overridden in every scenario. It gives up the fake's real include_expired, conviction and disposition filtering and risks a vacuous green; seeded-fake tests are the default.",
      "Locked from round 1 (R-1..R-4), restated for completeness only: a fused (has_fresh, count) method; gating on filter presence; a filtered include_expired=True fallback; a production 'is True' guard."
    ],
    "open_risks": [
      "Mixed freshness (D-3): a symbol whose only row is a stale healed leftover now shows 'no opportunity' on /trader/positions/[symbol], with no revalidation until the per-symbol heal or the daily refresh (servicer.py:5204-5217, 5311-5320). The window is rare only while one compute stamps a single valid_until (D-4).",
      "Fresh rows that are all dismissed or snoozed no longer kick. This is accepted, because a recompute cannot clear a disposition.",
      "Removing the min_conviction=1.01 lever leaves no no-DB way to force a recompute, and there is no replacement RPC (D-2).",
      "Merge coupling with 366, which edits _compute_opportunities and queue persistence in the same servicer. 365 lands first; 366 must preserve the elif fall-through and the single-valid_until-per-compute constraint.",
      "A has_fresh timeout on a cold read drops the kick, the same as a count_for_user timeout today. It is currently unpinned by any test unless the optional test in (d) is added."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-08",
      "C-11",
      "C-13",
      "C-15",
      "C-16",
      "C-18",
      "P-05",
      "P-06",
      "F-04",
      "F-06",
      "F-08",
      "ANALYSIS-14"
    ],
    "rationale": "Round 2 converged. The adversary returned SOUND with no Floor breach. The proposal implements D-1..D-4 and reintroduces none of R-1..R-4.\n\nI checked the code directly:\n- servicer.py:4790-4820 has the bare else, then count_for_user, then kick_full set before the state read, exactly as cited.\n- conftest.py:298 lacks has_fresh, so it falls back to 'fetch'.\n- _FakeOppRepo filters on include_expired, conviction and disposition, and has a real has_fresh. That confirms the adversary's correction of the proposal's 'fake does not filter' claim.\n\nThe proposer concretely adopted O-1..O-5 into the step's Files list as (b)/(c), (e), (d), (f) and (g), so all five close.\n\nThe new adversary objections are all non-blocking test-plan refinements and are folded into the approach:\n- seeded-fake tests instead of blanket patching;\n- an explicit proxy, or one real-kick test, for the valid_until Then clauses;\n- the constraint comment on the elif line;\n- confirming fetchval routing for the timeout test;\n- naming (e)'s target file.\n\nThey stay open only until the proposer adopts them. None blocks approval. The manual recompute path stays out of scope per the operator default (D-2).",
    "register_delta": {
      "new_decisions": [
        {
          "text": "Implement D-1 as a one-line change: 'elif not await opps.has_fresh(user_id):' replaces the bare 'else:' at servicer.py:4790 (no re-indent). The at-most-2-line constraint comment goes on the elif line and names the fresh-but-filtered-empty fall-through (no kick).",
          "evidence": "servicer.py:4786-4820 (verified r2); proposal r2; adversary r2 C-18 objection"
        },
        {
          "text": "Test realism: AC-1, AC-3, AC-4 and the all-dismissed/snoozed case run over the unpatched, seeded _FakeOppRepo. Only AC-2 (symbol, which the fake ignores) patches the include_expired=False read, and has_fresh is overridden only where seeding cannot express the case.",
          "evidence": "tests/test_analysis_servicer.py:4515-4557 (verified r2: the fake applies include_expired, min_conviction and DISMISS/SNOOZE, and ignores only sources, action_filter and symbol)"
        }
      ],
      "new_rejected": [
        {
          "text": "Explicit 'if await opps.has_fresh(...): pass' with the body under 'else:'",
          "why": "Re-indents about 30 lines and enlarges 366's rebase; 'elif' plus an on-line comment gives the same visibility"
        },
        {
          "text": "Blanket test patching (fresh read forced to [] and has_fresh overridden in every scenario)",
          "why": "Gives up the fake's real filtering and risks a vacuous green (fails.md:801/1649/2656)"
        }
      ],
      "new_objections": [
        {
          "text": "Kick-spy tests cannot check the valid_until and follow-up-read Then clauses of AC-1..AC-4. Add one real-kick test for AC-3/AC-4 (pattern at test_opportunity_compute_state.py:76-98), or record kick-called as the accepted proxy in Verification.",
          "blocking": false
        },
        {
          "text": "Confirm that has_fresh routes via fetchval (conftest.py:298), so the fetchrow injection in test_compute_state_timeout_kicks_once_then_unavailable (:331-337) still targets the state read. Optionally pin 'has_fresh timeout gives UNAVAILABLE with no kick'.",
          "blocking": false
        },
        {
          "text": "Item (e) must name tests/test_opportunities_repo.py as its target (F-08). Its fresh-plus-DISMISSed case passes by construction, so label it a D-3 pin or drop it.",
          "blocking": false
        }
      ],
      "closed_objections": [
        {
          "id": "O-1",
          "how": "Proposer r2 adopted the has_fresh=AsyncMock(return_value=False) stubs in _opp_svc (test_opportunity_compute_state.py:45-53) and in the test_opportunities_repo.py:657-668 stub, as Files items (b)/(c). The adversary confirmed no other site reaches _read_opportunity_queue."
        },
        {
          "id": "O-2",
          "how": "Adopted as Files item (e): a real_pg has_fresh test."
        },
        {
          "id": "O-3",
          "how": "Adopted as Files item (d): '\"has_fresh\": \"fetchval\"' added to _BC_METHOD_FOR at conftest.py:298."
        },
        {
          "id": "O-4",
          "how": "Adopted as Files item (f): the docs/opportunities.md:7 sentence is updated."
        },
        {
          "id": "O-5",
          "how": "Adopted as Files item (g): the D-4 constraint is recorded in context.md and flagged for 366's design."
        }
      ],
      "reopen_petitions": [],
      "reopened": []
    }
  },
  "floor_breaches": []
}
```

## Session 2026-11-26 — sdd-design

- Phase 0 Recon: wrote recon.md (services: xstockstrat-analysis). Key reuse patterns: the existing `OpportunitiesRepository.has_fresh` (opportunities.py:340-348) and the `tests/test_list_opportunities_deadlines.py` kick-spy and `read_path` fixtures.
- Phase 1 Grilling: 2 rounds (full). The operator approved at the gate on 2026-11-26, and no reopen petitions were filed.
  - Chosen approach: the bare `else:` at servicer.py:4790 becomes `elif not await opps.has_fresh(user_id):`, with no re-indent and a constraint comment of at most 2 lines on the elif line. A fresh-but-filtered-empty read falls through: no kick, empty page.
  - Rejected: R-1..R-6, in short a fused method, filter-presence gating, a filtered stale fallback, a production `is True` guard, the `if ...: pass` re-indent, and blanket test patching.
- Constitution rules touched: C-01, C-08, C-11, C-13, C-15, C-16, C-18, P-05, P-06, F-04, F-06, F-08, ANALYSIS-14. Floor breaches: none.
- Business rules: AC-1/AC-2 are CHANGEs, covered by the operator decisions above. AC-3/AC-4 and feature 185 @AC-6/@AC-7 are PRESERVE.
- **Decision D-2 (recorded per design item (g)):** a deliberate manual recompute or invalidate path is OUT of scope. Removing the `list_opportunities(min_conviction=1.01)` lever is intended; any replacement is a separate /sdd-story.
- **Constraint D-4 (recorded per design item (g); input for 366's design):**
  - Merge 365 before 366.
  - One compute stamps a single `valid_until` on every row it writes.
  - If 366 breaks this, D-3 (mixed freshness) must be re-evaluated.
  - 366's rebase must keep the elif fall-through.
- Correction to recon.md:43: `_FakeOppRepo` is not filter-blind. It applies include_expired, min_conviction and DISMISS/SNOOZE, and ignores only sources, action_filter and symbol (D-6).
- Status: spec-ready → design-approved.

### Open Threads (from design.md Open Risks)

- [ ] **Mixed freshness (D-3):** a symbol whose only row is a stale leftover from a heal shows "no opportunity" until the heal or the daily refresh. Target: the step-1 Verification, pinned by (e); re-evaluate in 366's design if D-4 breaks.
- [ ] **All-dismissed or all-snoozed fresh rows no longer kick** (accepted). Target: step 1, test (a), the dismissed/snoozed no-kick case.
- [ ] **No no-DB way to force a recompute** (D-2). Target: out of scope; a separate /sdd-story if wanted.
- [ ] **Merge coupling with 366.** Target: merge time, with 365 first and 366 keeping the elif fall-through and D-4.
- [ ] **A has_fresh timeout on a cold read drops the kick,** and no test pins it. Target: step 1, item (d), optional test.
- [ ] **Open non-blocking objections O-6..O-8** (kick-spy proxy or a real-kick test; fetchval routing; (e)'s target file and D-3 pin label). Target: /sdd-spec step 1, Files and Verification.

## Session 2026-11-26 — sdd-spec

- Generated implementation-spec.md with 3 steps. Status → implementation-ready.
  - Steps 1+2 are one atomic unit (`**Lands with**`):
    - Step 1 (service): the servicer `elif not await opps.has_fresh(user_id):` gate.
    - Step 2 (test): RED regression tests plus the harness stubs (b)/(c)/(d) and the real_pg `has_fresh` test (e).
  - Step 3 (docs) updates the `docs/opportunities.md` symbol-filter sentence (f).
  - Item (g) was already recorded in the sdd-design session above (D-2, D-4), so no further entry is needed.
- Key codebase findings (re-verified at origin/feature/fix-a-filtered-listopportunities@2f120ed3; the analysis tree is unchanged against main-dev@34f68c57):
  - Bug site: bare `else:` at servicer.py:4790, `q.kick_full = True` at 4792, `state_repo.get` at 4798. `has_fresh` is at opportunities.py:340-348 (fetchval; no production caller today).
  - Atomic-unit trigger: three test harnesses break on the new await until Step 2's stubs land.
    - `tests/test_opportunities_repo.py:657` plain `MagicMock`: the await raises TypeError.
    - `tests/test_opportunity_compute_state.py:45` `_opp_svc` `AsyncMock()`: returns a truthy MagicMock, so the cold kick disappears.
    - `tests/conftest.py:298` `_BC_METHOD_FOR`: has no `has_fresh` entry.
  - No other harness is affected. The other `AsyncMock()` opportunity repos (loop_supervision, tick_telemetry, owner_scoped_completeness, owner_header_guard, opportunity_refresh) never call ListOpportunities (grep).
  - Line correction: design item (f) cites `docs/opportunities.md:7`, but the sentence to change ("filters both the fresh and the stale read") is at L9 (L8-10). Recorded in Step 3's evidence.
  - O-6 resolution: real-kick tests (stub `_compute_opportunities`, drain `_opportunity_recomputing`) cover the `valid_until` and follow-up Then clauses of AC-1, AC-3 and AC-4. AC-2's `valid_until` clause uses the kick-spy proxy, stated in Step 2's Verification.
  - Not run in this session: the analysis venv lacks dev deps here (`asyncpg` missing), so the test baseline was not executed. Execute must run `uv sync --extra dev` first.

## Session 2026-11-26 — sdd-review impl-spec (advisory)

- Result: 0 failures, 4 warnings (criteria PASS, no Floor breaches); overlap WARN (rebase-only). Advisory: lifecycle unchanged (still implementation-ready).
- Addressed (edited implementation-spec.md):
  - [x] Step 2 item 10 (DRY guard rail, C-13): it no longer adds a local `_drain`. It reuses the existing module-level `_drain_opportunity_recompute(svc, user_id, *, budget=20000)` at `tests/test_analysis_servicer.py:4875`, imported through the deadlines file's existing `from tests.test_analysis_servicer import (...)` block (L25-31). Verification now greps for no `def _drain` in that file. The evidence line now cites the nested `_drain` at `test_opportunity_compute_state.py:84` correctly.
  - [x] Overlap with 308-fix-analysis-per-symbol-isolation (servicer.py, test_opportunities_repo.py, test_analysis_servicer.py, test_opportunity_compute_state.py): Step Dependencies now has a rebase-only note. Whichever lands second rebases and re-runs Step 2's Verification.
- Still open (carried into /sdd-execute; no spec change needed, the spec already states each one):
  - [ ] Step 2: the real_pg `has_fresh` test (item 11) skips locally when no PostgreSQL binary is present, so it runs for real only under `CI=true`. Execute should not treat a local skip as GREEN evidence for item 11.
  - [ ] Step 2: AC-2's `valid_until` Then clause is verified only through the kick-spy proxy (O-6, accepted trade-off, C-15).
  - [ ] Step 3 (docs) is verified by grep only, with no ruff or pytest run. This is adequate for a docs edit.
  - [ ] Overlap: 366-opportunity-live-only-rotation edits `_compute_opportunities` in the same servicer.py and has no impl-spec yet. Merge 365 first (D-4); 366's rebase keeps the elif fall-through.
  - [ ] Overlap: re-verify 330-fix-live-enrich-ttl-seed's reader-line citation at merge time (carried from the product-spec review).
