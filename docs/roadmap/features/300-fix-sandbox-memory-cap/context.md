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
