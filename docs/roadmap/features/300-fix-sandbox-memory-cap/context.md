# Context Log: fix-sandbox-memory-cap

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-15 (/sdd-triage)

- Bug recorded as `docs/reports/2026-10-15-indicators-sandbox-memory-cap-not-enforced-defect.md` (Issues disabled). Found by feature 228's post-deploy O-3 dev smoke on staging.
- Severity: SEV-2 (dev observed). Routed to the SDD path (Track C).
- Created: feature.md, product-spec.md (including the Consumer Surface(s) section, a lesson from 228's review),
  acceptance.feature (2 regression scenarios), context.md.
- Affected services: xstockstrat-indicators.
- Root cause hypothesis: the DO runtime accepts but does not enforce `RLIMIT_DATA` (e.g. gVisor). Unconfirmed.
- Production exposure: probably affected (same platform). Not escalated to Track A because production was not
  observed. Noted for the operator.
- Recommended design depth: quick → `/sdd-design fix-sandbox-memory-cap quick`. Rationale: SEV-2, single service, root cause not yet
  confirmed.
- Development branch: feature/fix-sandbox-memory-cap.

## Session 2026-11-09 — sdd-review product-spec

- Operator decisions (this session): FR-1 mechanism is chosen in the design debate but must work on both DO App Platform and homelab (docker-compose); FR-2 startup probe ships first; a non-enforcing runtime is logged loudly (ERROR + OTel gauge) and the service keeps serving (no fail-closed); pipeline runs end to end with one up-front confirmation.
- First review FAILED: unchecked Open Questions / Fix Scope (criterion 9); AC-2 `Then` not observable, no FR-2 negative path (criterion 8, C-15). Fixed: FR-2 pinned, AC-2 rewritten, AC-3 added, open questions deferred to the FR-2 probe output.
- Re-review: PASS WITH WARNINGS. Status: draft → spec-ready.
- Warnings: WARN-1 "production affected?" can only be verified after promotion (heading renamed to Deferred Verification); WARN-2 impl-spec must define how a non-enforcing runtime is simulated in CI, since CI kernels enforce RLIMIT_DATA.
- Overlap findings: soft WARN with draft 304 (config-keys-relative-consumers): both touch `services/xstockstrat-indicators/app/config/watcher.py` (`sandbox_memory_bytes`) and `app/services/sandbox.py` (docstring + RLIMIT_DATA block). 300 must use the namespace-relative spelling once 304 lands; add a soft merge-order row at impl-spec review. No proto/migration/config-key collision.
- Known adjacent defects in the same area (not in scope unless design says): `memory_used_bytes` hardcoded to 0 (`sandbox.py`), `RLIMIT_NPROC` recomputed per call (`services/xstockstrat-indicators/docs/context-constitution-findings.md`).
- Recommended design depth: quick (single service, no proto/DB/config change).

## Session 2026-11-09 — sdd-design Phase 0 (recon)

- Wrote recon.md (Tree: feature/fix-sandbox-memory-cap@be9686b). Services: xstockstrat-indicators; consumers agent/ui unchanged. Key reuse: the `indicators.config.snapshot_age` Gauge pattern, `start_new_session` + `killpg` teardown, baseline-plus-headroom semantics.
- scenario-recon: 23 existing guarantees, 0 CHANGE. Main constraints: no false kill of the 800x800 matmul (228 @AC-1); watchdog measures growth above the child's pre-lockdown baseline (228 @AC-3); SIGKILLed child classifies memory_exceeded (268 @AC-1/2); seccomp allowlist and UID drop not weakened (209).
- Post-recon escalation: the named consumer surfaces (Agent, UI) trip the rubric's >=2-services signal. Operator chose **Upgrade to full** (min 2 debate rounds). Mode: quick -> full.
- Open recon unknowns carried to the debate: child baseline is not visible to the parent; /proc fidelity on DO unverified; how CI fakes a non-enforcing runtime (WARN-2).

## Session 2026-11-09 — sdd-design Phase 1 round 1 gate

- Round 1: proposer = always-on parent VmData watchdog + startup probe; adversary = NEEDS WORK, no Floor breach. Blocker: VmData-only signal, no fallback, so FR-1 not runtime-independent (P-03). Majors: PID-reuse TOCTOU (kill another run), fd-number reuse after join timeout, probe tests mmap not mremap (the repro path), silent fail-open paths, timeout-vs-kill ordering, 228 @AC-1 false-kill unprovable on DO from CI. Minors: group-wide budget instead of per-process, probe placement after init_telemetry, serve() self-check helper for testability, test seam only emulates the favourable runtime.
- Operator steer at the gate (round 2): **put a container memory limit in scope** as defence in depth (previously Out of Scope in product-spec). Reconcile product-spec Out of Scope + acceptance before approval (fails.md 2026-10-14 lesson).
- Round 2 synthesized state: keep parent-side always-on watchdog; add RssAnon as second signal; dirfd reads + one lock for done/killed; watchdog thread owns the pipe fd; group-wide budget; probe tests mmap AND mremap with explicit MAP_PRIVATE, distinct 'probe failed' outcome; probe placed right after init_telemetry via a testable helper; decide pipe vs /proc/<pid>/limits; define behaviour when the watchdog cannot observe; container limit in .do/app*.yaml + compose/homelab.

## Session 2026-11-09 — sdd-design Phase 1 round 2 gate

- Round 2: adversary = NEEDS WORK, no Floor breach. Resolved from round 1: fd reuse, probe path, ordering, probe placement/testable helper, distinct probe-failed/cannot-observe outcomes. New: (BLOCKER) RssAnon-growth trigger can false-kill the 800x800 matmul on an ENFORCING kernel (reserved-but-untouched memory moves VmData->RssAnon; 8 MiB slack invented); (MAJOR) 'unexplained -9 = memory_exceeded' is wrong, RLIMIT_CPU soft=hard ends in SIGKILL; smoke gate unenforceable (no post-deploy step in /sdd-execute, /promote only a manual checkbox; precedent 209 and 228 context.md:57); mem_limit 2g invented + sizing omits overshoot, max_concurrent is live; thread+lock+pidfd stack avoidable via communicate(timeout=tick) in the calling thread; pidfd errno fallback set incomplete (EBADF, EPERM); @AC-9 not testable without render-assert.jq; oom_score_adj better written by the parent.
- Operator decisions at the gate: **Run round 3**. Smoke gate = **honest owned follow-up** (advisory, owner = operator; no /promote change). DO = **no spec change** (basic-s 2 GB per docs/runbooks/infra-cost-reduction.md; homelab gets explicit mem_limit/memswap_limit 2g by parity; fix the basic-xs doc drift in docs/setup/digitalocean.md:252 and infra-cost-reduction.md:18; the FR-2 probe logs memory.max). SIGKILL attribution = **evidence-based via cgroup memory.events oom_kill delta**, else runtime_error 'killed by signal 9'; RLIMIT_CPU and 209 wording untouched (no C-16 CHANGE).
- Round 3 synthesized state: calling-thread sampling loop on communicate(timeout=tick); absolute RssAnon rule (RssAnon > vmdata_base + headroom + stack rlimit) plus VmData rule, so only the VmData baseline is handed over; group-wide budget; parent-side oom_score_adj with a logged failure; log-once unobservable ERROR; shared snippet constants for setuid block/VmData parse; WARN when max_concurrent x (baseline+memory_bytes+overshoot)+parent exceeds memory.max.

## Session 2026-11-09 — sdd-design Phase 1 round 3 gate

- Round 3: adversary = NEEDS WORK, no Floor breach, bottom line "approvable after targeted fixes, no structural change". Resolved: pid/fd-reuse races, RssAnon false-kill (absolute R2), SIGKILL attribution, thread/lock/pidfd stack, calling-thread `communicate(timeout=tick)` loop (valid on CPython 3.13). Open: M1 arming on first finite `Max data size` mis-arms when the container passes down a finite RLIMIT_DATA (compare to the parent's `getrlimit` before Popen); M2 "never armed" per-run trigger fires on every runtime because a fast formula ends inside one tick (fire only on positive evidence: PermissionError, missing `Max data size` line, both VmData and RssAnon absent); M3 R2-only/VmData-evading path has no AC (add AC-11: shared-anon mmap, touch-then-mprotect(PROT_READ), VmData-stripped sampler); M4 probe `watchdog_observable` must check deltas around a 16 MiB mmap+memset, not field presence; M5 sizing WARN overbuilt; M6 AC-1 RED is timing-dependent (hold the allocation until the kill; document that a burst finishing inside one tick goes unreported).
- Operator decisions: **Run round 4**. Sizing WARN (G / FR-4 / AC-10 / fault-rate measurement) = **CUT** (log memory.max + probe-child rss in the probe INFO line, formula in indicators CLAUDE.md, live-key re-check = owned follow-up). Fork budget = **count growth only** for non-leader members (growth beyond the leader's value at fork time), keeping 209 @AC-5 PRESERVE.
- Minors folded in at /sdd-spec: patch a `_monotonic` alias not global `time`; fakes define `returncode = None`; FileNotFoundError silent for fake pids and a fixture resets log-once flags; pin stat parsing (pgrp = token index 2 after the last ')'); render-assert.jq projects mem/swap, compares via tostring, emits only labels, and 279's render-assert guarantees (platform.feature:1235-1239,1262-1292) are EXTENDed; more DO doc drift (digitalocean.md:34,223,252,262; infra-cost-reduction.md:18); probe first-line read uses a selector/communicate timeout; AC-4 phrased as 228 @AC-1 holding with the watchdog active; `_child_headroom` documented as a test seam.

## Session 2026-11-09 — sdd-design Phase 1 round 4 gate

- Round 4: adversary = NEEDS WORK (no blocker, no Floor breach), "approvable with must-fix items folded into design.md, no round 5 needed". Resolved: M1, M2 (fast-formula case), M4 deltas, M5, M6, m1 and the round-3 minors. Open (Majors): (1) zombie leader/member status has no Vm*/Rss* lines and trips "cannot observe" (State Z/X must contribute 0 and emit nothing); (2) the `_child_headroom` seam shifts `base = cap - headroom` so AC-1 never goes green and AC-4/AC-11 prove nothing (pin `base = cap - child_headroom`); (3) the attacker can inflate `r0` by touching shared memory before the arming tick; (4) probe does not verify `/proc/<pid>/limits` reflects setrlimit (a userspace kernel may stub it); (5) no metric for the "blind watchdog" state; (6) AC-11 is structural, add a case with the production default `allowed_imports` reaching mmap/ctypes by attribute traversal (and record native-kernel exposure as a finding if confirmed); (7) FR-1 narrowing needs sign-off and product-spec §Deferred Verification (O-3) text is stale ("runtime-independent", "/sdd-execute's post-deploy smoke"). Minors: inflate-fork-deflate residual bound, arming tuple (soft, hard) compare, mis-cited 228 @AC-5, "cannot fire before RLIMIT_DATA" is empirical not proof, probe I/O pins (name the mremap API incl. the literal numpy repro, MAP_PRIVATE for steps 2-3, os.read raw fds, killpg+reap on timeout), `finally` killpg uses getpgid after reap, AC-6 is a regression guard not a RED, numbering/AC-1 wording.
- Operator decisions: **Run round 5** (hard-cap round). Arming = **child-reported fd handoff** (wrapper writes cap, pre-exec resident-minus-VmData and stack limit to an inherited pass_fds fd right after setrlimit, closes it before seccomp; parent reads it in the calling thread; replaces /proc/<pid>/limits arming, r0-from-sample and the inherited-tuple heuristic). Per-run fail-open when the parent cannot observe = **ACCEPTED** (one ERROR per process; formulas still run under RLIMIT_DATA; FR-1 wording and INDICATORS-2/9 state the residual). Second gauge `indicators.sandbox.memory_watchdog_observable` (0/1, no labels) = **ADD**.

## Session 2026-11-09 — sdd-design (COMPLETION)

- Phase 0 Recon: wrote recon.md (service: xstockstrat-indicators; consumers agent/ui unchanged). Key reuse patterns: the `indicators.config.snapshot_age` Gauge, `start_new_session` + `killpg` teardown, baseline-plus-headroom semantics, the `seed_default_formulas` non-fatal startup.
- Phase 1 Grilling: 5 rounds (full; escalated from quick at the post-recon gate). Chosen approach: parent-side per-run memory watchdog (calling-thread `communicate(timeout=50 ms)` loop, child-reported fd handoff for arming, R1 VmData growth + R2 absolute resident rule over the process group with growth-only members, evidence-based `-9` attribution via cgroup `oom_kill`, parent-written `oom_score_adj`), a parent-run startup probe at `main.py:43` with two gauges, and an explicit 2g homelab container limit; DO spec unchanged. Rejected: container limit as the mechanism, single VmData signal, RssAnon-growth trigger, thread+lock+pidfd, `/proc/<pid>/limits` arming, leader-only watch, RLIMIT_AS fallback, sizing WARN, hard-limit probe ERROR.
- Constitution rules touched: C-01, C-02, C-05, C-08, C-10, C-11, C-13, C-14, C-15, C-16, C-18, P-01..P-06, F-04, F-07, F-11. Floor breaches: none in any round. Business rules: no CHANGE.
- Spec reconciled in this session (fails.md 2026-10-14 lesson): product-spec FR-1..FR-3, Out of Scope, Deferred Verification (O-3); acceptance.feature AC-1..AC-9, AC-11..AC-14 (AC-10 reserved for the cut sizing WARN and never reused; AC-11 = VmData-evading memory, AC-12 = handoff integrity); feature.md.
- Operator decisions are recorded in the round-gate entries above (full depth, container-limit scope, smoke gate advisory, DO unchanged, evidence-based `-9`, child-reported handoff, per-run fail-open accepted, second gauge, sizing WARN cut, growth-only fork budget, probe at `main.py:43` without the hard-limit ERROR).
- Status: spec-ready → design-approved.

### Open Threads (from design.md § Open Risks)

- [ ] DO `/proc` fidelity: FR-1 may be fail-open on DO; answered only by the first staging probe line — advisory checklist (post-deploy).
- [ ] Per-run fail-open residual, tick-burst residual, inflate-fork-deflate bound, fork-bomb now `memory_exceeded` — document in INDICATORS-2/9 and indicators CLAUDE.md (docs step).
- [ ] R2 near-cap false-kill margin on an enforcing kernel — record AC-4 peaks and per-run slack here at execute (watchdog step).
- [ ] `oom_kill` delta can mislabel a concurrent run's `-9` (docs step).
- [ ] `mmap.resize()` on anonymous maps under CPython 3.13 unverified — probe step (AC-3 red on CI if it raises a non-ENOMEM error).
- [ ] Native-kernel exposure via `object.__subclasses__()` -> `CDLL` -> `mmap(MAP_SHARED)`: findings row "open — fix in 300" in `services/xstockstrat-indicators/docs/context-constitution-findings.md`, closed by AC-11 (docs step).
- [ ] CI covers the same-UID read path only; root→65534 validated by the staging probe line (checklist).
- [ ] Homelab: `memswap_limit` honoured without swap accounting, homelab-edge `app-deploy` gate acceptance of `mem_limit`, VM free RAM (checklist item 6).
- [ ] Startup budget vs homelab `start_period` and DO default health check; update the `compose.yml:24` comment (homelab step).
- [ ] Soft overlap with draft 304 on `sandbox.py` / `watcher.py`: add a soft `merge-order.md` row; whichever lands second rebases (docs step).
- [ ] Doc drift: `docs/setup/digitalocean.md:34,223,252,262`, `docs/runbooks/infra-cost-reduction.md:18` list indicators as `basic-xs`; the specs say `basic-s` (docs step).
- [ ] Owned advisory post-deploy checklist (operator, non-gating) — see design.md § Open Risks; record results in this file.

## Session 2026-11-09 — sdd-spec

- Generated implementation-spec.md with 11 steps. Status → implementation-ready. Tree: feature/fix-sandbox-memory-cap@1f7ccb1 ≡ origin (main-dev merged).
- Key codebase findings:
  - recon.md line anchors still hold at 1f7ccb1 (`sandbox.py` wrapper `:205-312`, `communicate` `:380`, `_killpg` `:315-324`, `main.py` `init_telemetry` `:43` / config wait `:48`); `mmap.resize` on an anonymous map verified on CPython 3.12.3 (service venv) and 3.13.18, so the design's "unverified" risk is retired for the call itself. The service venv is 3.12.3 while prod is 3.13 (fails.md 2026-11-04): Step 8 re-runs the sandbox suites with `UV_PYTHON=3.13`.
  - Break radius for the tick loop is exactly `tests/test_sandbox.py:19-43` (first-timeout assertion, `FakeProc` without `returncode`) and `_fake_popen` `tests/test_sandbox_isolation.py:65-74`; hence Steps 5+6 are one atomic unit. `app/telemetry.py` and `app/main.py` are coverage-omitted, so coverage comes from `sandbox.py` / `sandbox_probe.py`.
  - `docker compose config --format json` (v5.6.1) renders `mem_limit: 2g` as the string "2147483648" and an absent key projects to "null" via `tostring`; indicators is already `basic-s` in both DO specs (`:197`).
- Open spec questions raised for `/sdd-review impl-spec` (P-03, not silently guessed):
  - G-1: design says the `_HANDOFF` snippet "catches nothing", so a runtime without `RssAnon`/`RssShmem` would crash every child (fail-closed outage) instead of the accepted per-run fail-open. Spec default: only `VmData` mandatory, missing `Rss*` reports `r0 = 0`. Needs operator confirmation.
  - G-2: design says `_killpg` kills only while `returncode is None` and also that this makes the post-reap `finally` sweep real; those contradict. Spec default: keep the guard, findings row `:44` is only partially closed.
- Soft overlap with 304 recorded in Step Dependencies; the `merge-order.md` row is Step 11's, conditional on impl-spec review confirmation.

## Session 2026-11-09 — sdd-review impl-spec (advisory)

- Result: 0 failures, 14 warnings, 0 Floor breaches (advisory — did not block). Tree: feature/fix-sandbox-memory-cap@aefcaaab ≡ origin (merged origin/main-dev@93bb2307). All anchors checked resolve; AC-1..AC-9 and AC-11..AC-14 each map to a test step (AC-10 retired); 1↔2, 3↔4, 5↔6, 7↔8, 9↔10 pairs correct; Step 5/6 `Lands with` justified.
- Unresolved ✗ / ⚠ carried into execution:
  - Step 1/5/6 (G-1, P-03): child-side `_HANDOFF` tolerates a missing RssAnon/RssShmem (r0 = 0, H1 line still written, parent skips R2 silently); departs from design.md § 1 ("catches nothing") but design is internally inconsistent without it (it already says parent skips R2 when RssAnon is missing). VmData stays mandatory. Needs recorded operator confirmation AND a missing child-side test (run the formatted snippet against a fake /proc/self/status: exit 0 + well-formed H1 line with Rss* absent; missing VmData still crashes) — [ ] unaddressed
  - Step 5/11 (G-2, P-03): design.md claims both `_killpg` guard `returncode is None` and a "real" post-reap sweep; they contradict. Keep the guard (no regression vs today, closes pid-reuse); findings row `context-constitution-findings.md:44` stays OPEN with corrected text, not "partly closed"; indicators CLAUDE.md "killpg on timeout and every exit" bullet must be corrected; a real post-reap sweep is a separate design decision. Needs operator confirmation of the narrowing — [ ] unaddressed
  - Step 7/8 (F-08, C-08): second once-per-process flag (oom_score_adj WARN) has no test and no conftest reset; `tests/conftest.py` is not in Step 7/8 **Files**. Fold both flags into one `_reset_once_flags` covered by Step 2, or drop the WARN — [ ] unaddressed
  - Step 11 (F-08): conditional `merge-order.md` file is ambiguous for staging; resolve unconditionally (add the soft row, or drop the file from **Files**) — [ ] unaddressed
  - Step 11: digitalocean.md lines :33,:34,:223,:262 are generic "basic-xs" statements — rewrite to say indicators is `basic-s`, not "fix drift" blindly; six files (>5) — split is advisable, not required — [ ] unaddressed
  - Step 2/4 (C-13): helpers imported from `tests/conftest.py` (`from tests.conftest import`) are fragile — prefer fixtures or a helpers module — [ ] unaddressed
  - Step 8: imports constants from `test_sandbox_isolation.py` (import, never copy); AC-4 false-kill margin recorded not asserted (matches design open risk) — note only
  - Spec line 44 calls feature 304 a "draft"; it is `code-completed` — correct the text — [ ] unaddressed
- Overlap findings: no FAIL-level collision (no migration/proto/config-key writes). File-level rebase-class overlap with 304 (`code-completed`, not launched): `sandbox.py` (304 edits only the docstring key list :6-9 per its own file list; 300's line 44 says 304 also respells the RLIMIT_DATA block — conflicting claim), `tests/conftest.py` (304 Step 12 `snapshot_watcher`), `tests/test_sandbox_isolation.py`, `tests/test_sandbox.py`, indicators CLAUDE.md (disjoint sections), `watcher.py` (300 does not edit; 304 edits :86,90,94-96,100,103 so 300's line anchors for `sandbox_memory_bytes` drift if 304 lands first). Merge-order: overlap scan recommends no entry (textual, rebase-only; table lists hard constraints only); spec-reviewer recommends a soft row. Operator to decide.

## Session 2026-11-09 — impl-spec corrections after advisory review (operator decisions)

- Operator decisions: **G-1 = keep design, "catch nothing"** (no try/except in the child handoff snippet). **G-2 = keep the `_killpg` guard; findings row `:44` stays open.** **Merge-order = add an unconditional soft note.** **Next = fix the spec, then another review round (no execute yet).** No code has been written.
- G-1 resolution: design.md's snippet reads `VmData`/`RssAnon`/`RssShmem` with `.get(key, 0)`, so a missing `Rss*` line never raises; "catch nothing" and a tolerant child are the same design. The earlier "departure" in the spec was an overreading and is withdrawn. Step 1 now specifies the snippet verbatim without handlers; Step 2 adds the proving tests (all fields, `Rss*` absent, `open` raising propagates). A missing `VmData` stays fail-closed by `_VMDATA_PROBE` (228 `@AC-5`).
- G-2 resolution: guard kept; Step 5 states it does not close row `:44`; Step 11 rewrites row `:44` (stays open) and corrects the indicators `CLAUDE.md` "killpg ... every exit" bullet (`:148-149`).
- Merge-order: the operator asked for a "soft row". `merge-order.md`'s table gates a feature's final integration PR until the other is `launched` (file header), so a row would block 300 behind 304 (304 is `code-completed`, not launched). Implemented the intent (deterministic, non-blocking) as a **prose note**, the file's existing form for non-gating relationships (precedent: "Launch gate: 215 ↔ 283"). Flagged to the operator.
- Review items addressed in the spec: one `_first_time`/`_reset_once_flags` registry (Step 1) covers both once-flags, with an `oom_score_adj` test in Step 8 and no extra conftest scope (F-08); `h1_line` and `proc_status_text` are now conftest fixtures consumed by argument (C-13); Step 11 `**Files**` made deterministic; DO doc edits narrowed to the indicators mapping (`digitalocean.md:252,262`, `infra-cost-reduction.md:18`); "304 is a draft" corrected to `code-completed`; `_PROC` module constant added so group sampling and `oom_score_adj` are testable against a synthetic tree.
- Not changed (acceptable, noted): Step 11 still touches six files (advisory >5, not a rule); the AC-4 false-kill margin is recorded not asserted (design open risk).

## Session 2026-11-09 — second impl-spec review pass and corrections

- Second advisory pass: 0 failures, 8 warnings, 0 Floor breaches; every first-review warning verified resolved in the step bodies; reviewer: ready for `/sdd-execute` once seven quick FOLD items land. Operator instruction (2026-11-09): do not ask, if the spec is ready execute, otherwise loop on the warnings.
- FOLD items applied: (1) G-1 provenance reworded: design.md § 1 carries no snippet code; the `.get(key, 0)` shape is from the approved round-5 proposal, no try/except kept per the operator's decision (design.md Errata added); (2) Step 2 wrapper-parity test imports the existing `_fake_popen` and lists `test_sandbox_isolation.py` read-only; (3) named the pure arming function `_arm_from_handoff`, the group sampler `_sample_group`, and the constant `_OOM_EVENTS_PATH`; (4) Step 6 AC-12(b) scans fds 3..63; (5) Step 2 snippet tests supply `os`/`resource` and use an `ast` walk for "no try"; (6) merge-order prose note carries the date, the CLAUDE.md overlap and the precedent footer; (7) design.md Errata appended for the withdrawn post-reap-sweep claim, the prose-note form and the narrowed DO doc edits.
- Residual: Step 11 touches six files (advisory >5, accepted); open risks unchanged (DO `/proc` fidelity, R2 near-cap margin, one-tick burst, same-UID CI, homelab `memswap_limit`, `oom_kill` mislabel).
- Proceeding to `/sdd-execute fix-sandbox-memory-cap sequential` per the operator's instruction.
