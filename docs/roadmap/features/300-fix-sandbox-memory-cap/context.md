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
