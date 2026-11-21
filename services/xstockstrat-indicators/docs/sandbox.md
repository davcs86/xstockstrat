# xstockstrat-indicators — Sandbox memory watchdog

On-demand detail for the formula sandbox's parent-side memory watchdog (feature 300). The binding
invariant is INDICATORS-2 in [`context-constitution.md`](context-constitution.md); the overview is in
[`../CLAUDE.md`](../CLAUDE.md) § Sandbox Security Model.

- **Memory watchdog (feature 300)**: the kernel's `RLIMIT_DATA` is not trusted alone — DigitalOcean App
  Platform was observed to accept it without enforcing it, and a shared mapping never counts against it
  even on a native kernel. When `memory_bytes > 0` the child writes one arming line
  (`H1 <cap> <r0> <stack>`) to an inherited pipe right after `setrlimit` and closes it before the seccomp
  load; the parent then samples the formula's whole process group every 50 ms (`_TICK_S`, a jail
  constant) in the calling thread (`communicate(timeout=tick)` is resumable and the only reaper, so a
  kill always lands before the reap) and kills it on **R1** (group `VmData` growth above the headroom;
  non-leader members count only growth since first seen) or **R2** (group `RssAnon + RssShmem` above
  `base + headroom + max(r0, 0) + stack`, which catches memory outside `VmData`). A kill reports
  `memory_exceeded`. A `-9` child counts as `memory_exceeded` only when the cgroup v2 `oom_kill` counter
  rose during the run; otherwise it stays `runtime_error` with the unchanged text. The parent also
  writes `oom_score_adj = 1000` for each child, so a cgroup OOM kills a sandbox child, not the gRPC
  server (the largest child dies, which may be a legitimate concurrent formula).
  Residuals: (a) a burst that allocates and frees, or exits, within one 50 ms tick is not reported;
  (b) inflate-fork-deflate is bounded by about `NPROC × (base + 2H)`, parity with native per-process
  `RLIMIT_DATA`; (c) when the parent cannot observe the child (positive evidence only) the run is
  fail-open: one ERROR per process and the observable gauge at 0, while the formula still runs under
  `RLIMIT_DATA`, the timeout, the container limit and `oom_score_adj`; (d) fork-bomb runs may now end
  `memory_exceeded` (still a typed error); (e) "R1/R2 cannot fire before `RLIMIT_DATA` on an
  enforcing kernel" is an empirical claim backed by recorded peaks, not a proof.
