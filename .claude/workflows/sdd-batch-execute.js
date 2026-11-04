export const meta = {
  name: 'sdd-batch-execute',
  description: 'Run /sdd-execute <slug> sequential for many implementation-ready features in parallel worktrees, halting at every operator gate',
  whenToUse: 'Features are implementation-ready and the operator has given the sequential mode-entry confirmation. args: {date, trailer, prFooter, modeEntryConfirmed:true, features:[{slug, directive?}], approvals?, checkpoints?, authorizationRef?}. Docs: docs/patterns/context-engineering.md §4.',
  phases: [
    { title: 'Preflight', detail: 'resolve slug, branch, lifecycle, steps, merge-order, open PR' },
    { title: 'Gate', detail: 're-spec validation + up-front confirm plan' },
    { title: 'Steps', detail: 'per step: discovery → TDD implementation → one commit on the feature branch' },
    { title: 'Land', detail: 'merge-order gate, C-16 promotion plan, integration PR' },
  ],
}

// Contract and gate semantics: docs/patterns/context-engineering.md §4 (Workflows).
const A = args || {}
if (!A.date || !A.trailer || !A.prFooter || !Array.isArray(A.features) || A.features.length === 0) {
  throw new Error('sdd-batch-execute: args.date, args.trailer (commit attribution), args.prFooter (PR-body attribution) and args.features[{slug}] are required')
}
if (A.modeEntryConfirmed !== true) {
  throw new Error('sdd-batch-execute: the operator must give the sequential mode-entry confirmation (sequential-mode.md §5.1b) in the main session first; pass modeEntryConfirmed:true')
}
const CHECKPOINTS = A.checkpoints || 'halt'
if (CHECKPOINTS !== 'halt' && CHECKPOINTS !== 'report') throw new Error("sdd-batch-execute: checkpoints must be 'halt' or 'report'")
if (CHECKPOINTS === 'report' && !A.authorizationRef) {
  throw new Error("sdd-batch-execute: checkpoints 'report' needs args.authorizationRef — where the operator authorized unattended checkpoints")
}
const BASE = A.baseBranch || 'main-dev'
const APPROVALS = A.approvals || {}
const STEP_CAP = 5

const STEP = {
  type: 'object',
  properties: {
    n: { type: 'number' },
    title: { type: 'string' },
    status: { type: 'string' },
    service: { type: 'string' },
    surface: { type: 'string', enum: ['backend', 'ui', 'agent'] },
  },
  required: ['n', 'title', 'status', 'service', 'surface'],
}
const PREFLIGHT = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    problems: { type: 'array', items: { type: 'string' } },
    dir: { type: 'string' },
    nnn: { type: 'string' },
    devBranch: { type: 'string' },
    status: { type: 'string' },
    severity: { type: 'string' },
    steps: { type: 'array', items: STEP },
    mergeOrderBlock: { type: 'string' },
    openPrUrl: { type: 'string' },
    promotionPlan: { type: 'string' },
  },
  required: ['ok', 'problems', 'dir', 'nnn', 'devBranch', 'status', 'severity', 'steps', 'mergeOrderBlock', 'openPrUrl', 'promotionPlan'],
}
const VALIDATE = {
  type: 'object',
  properties: {
    mismatches: { type: 'array', items: { type: 'object', properties: { n: { type: 'number' }, detail: { type: 'string' } }, required: ['n', 'detail'] } },
    tooling_blockers: { type: 'array', items: { type: 'string' } },
  },
  required: ['mismatches', 'tooling_blockers'],
}
const WRITE = {
  type: 'object',
  properties: { commits: { type: 'array', items: { type: 'string' } }, notes: { type: 'array', items: { type: 'string' } } },
  required: ['commits', 'notes'],
}
const IMPL = {
  type: 'object',
  properties: {
    result: { type: 'string', enum: ['done', 'blocker'] },
    commits: { type: 'array', items: { type: 'string' } },
    red: { type: 'string' },
    green: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    deviations: { type: 'array', items: { type: 'string' } },
    out_of_scope: { type: 'array', items: { type: 'string' } },
    open_items: { type: 'array', items: { type: 'string' } },
    unaddressed_warnings: { type: 'array', items: { type: 'string' } },
    blocker: { type: 'string' },
    options: { type: 'array', items: { type: 'string' } },
  },
  required: ['result', 'commits', 'red', 'green', 'files', 'deviations', 'out_of_scope', 'open_items', 'unaddressed_warnings', 'blocker', 'options'],
}
const PLAN = {
  type: 'object',
  properties: { plan: { type: 'string' }, scenarios: { type: 'number' } },
  required: ['plan', 'scenarios'],
}
const PR = {
  type: 'object',
  properties: { url: { type: 'string' }, commits: { type: 'array', items: { type: 'string' } } },
  required: ['url', 'commits'],
}

function approvals(slug) {
  return [].concat(APPROVALS[slug] || []).filter((x) => x && typeof x.gate === 'string')
}

function writerRules(f, p) {
  return `You are executing /sdd-execute ${f.slug} sequential for feature ${p.dir} (docs/roadmap/features/${p.dir}/), dev branch ${p.devBranch}. You run in your own git worktree and are the only writer for this unit of work (P-01). Mandatory git protocol:
1. \`git fetch origin\` then \`git checkout --detach origin/${p.devBranch}\`. Never check out a named local branch.
2. If \`node_modules\` is missing at the worktree root, symlink it from the main worktree (first entry of \`git worktree list --porcelain\`) so the husky pre-commit hook runs. Never use --no-verify.
3. Commit message bodies end with these lines, verbatim:
${A.trailer}
4. \`git push origin HEAD:refs/heads/${p.devBranch}\` after every commit; retry up to 4 times (2s/4s/8s/16s) on network errors only. Never push elsewhere, never force-push.
5. Push after EACH artifact edit: every SDD artifact or doc you create or change (status.md, feature.md, context.md, implementation-spec.md re-spec, the promotion plan, durable acceptance suites) is committed alone — subject = this task's commit message + " — <file name>" — and pushed before the next file is touched. The ONE exception is a step's implementation: its **Files** plus that step's implementation-spec.md status, feature.md and context.md updates form a single commit made only after verification passes (SKILL.md HARD CONSTRAINT: no commit before verification).
6. Return every commit sha you created, in order, as \`commits\`.
Use ${A.date} for history rows and session headers. Severity tokens: only ${p.severity} may appear. Every HARD CONSTRAINT of .claude/skills/sdd-execute/SKILL.md applies (no guessed paths/symbols, no commit before verification passes, migration immutability, never start a database).`
}

async function runFeature(f) {
  const out = { slug: f.slug, stage: 'Preflight', halted: null, blocked: null, commits: [], reports: [] }
  const aps = approvals(f.slug)
  const proceeds = (gate) => aps.some((x) => x.gate === gate && x.decision === 'proceed')
  const ap = aps.find((x) => x.gate.indexOf('checkpoint:') === 0 || x.gate.indexOf('blocker:') === 0) || null

  const p = await agent(`Read-only preflight for /sdd-execute ${f.slug} sequential. Never write, commit or push. \`git fetch origin\`, then:
1. Resolve the feature dir on origin/${BASE} (\`git ls-tree --name-only origin/${BASE} docs/roadmap/features/\`, dirs ending \`-${f.slug}\`): exactly one, else a problem ("slug not unique").
2. Development Branch from feature.md (default \`feature/${f.slug}\`); it must exist on origin (problem otherwise). Severity from feature.md (or "n/a").
3. status = status.md on origin/<devBranch>. It must be implementation-ready, in-progress or code-completed (problem otherwise).
4. steps: parse implementation-spec.md on origin/<devBranch>: for each numbered step its number, title, **Status** (pending/done/blocked), **Service**, and surface (xstockstrat-ui → ui, xstockstrat-agent → agent, else backend).
5. mergeOrderBlock: if docs/roadmap/features/merge-order.md (on origin/main-dev) lists ${f.slug} in its Feature column with Resolved != Yes, the blocking feature + reason; else "".
6. openPrUrl: the URL of an OPEN pull request with head <devBranch> and base main-dev (load mcp__github__list_pull_requests via ToolSearch; repository from \`git remote get-url origin\`), else "".
7. promotionPlan: the text of the LAST fenced block tagged \`sdd-batch-promotion-plan\` in context.md on origin/<devBranch>, else "".
ok = no problems.`, { phase: 'Preflight', schema: PREFLIGHT, label: `preflight:${f.slug}` })
  if (!p) { out.blocked = 'preflight agent died'; return out }
  Object.assign(out, { nnn: p.nnn, devBranch: p.devBranch, status: p.status })
  if (!p.ok) { out.blocked = `preflight: ${p.problems.join('; ')}`; return out }
  if (p.openPrUrl) { out.stage = 'done'; out.prUrl = p.openPrUrl; return out }
  const WR = writerRules(f, p)
  const ctx = `Feature ${p.dir} (${p.severity}), dev branch ${p.devBranch}.`
  let pending = p.steps.filter((s) => s.status !== 'done')
  const blockedStep = pending.find((s) => s.status === 'blocked')

  // ── Gate: re-spec validation + up-front confirm (§5.3/§5.4) ──────────────
  const resuming = !!ap
  if (pending.length && !resuming) {
    out.stage = 'Gate'
    const v = await agent(`${ctx}\n/sdd-execute ${f.slug} sequential §5.3 re-spec gate, READ-ONLY validation (do not commit or push). In your worktree: \`git fetch origin && git checkout --detach origin/${p.devBranch} && git merge --no-edit -X ours origin/main-dev\` (local only). For every pending step of docs/roadmap/features/${p.dir}/implementation-spec.md re-run its **Codebase Evidence** greps/ls and confirm each **Files** path exists; report mismatches per step. Also run .claude/skills/sdd-execute/reference/tooling-setup.md's DETECTION only (no installs) for the toolchains the pending steps need and report any that is unavailable with no documented fallback.`, { phase: 'Gate', schema: VALIDATE, isolation: 'worktree', label: `validate:${f.slug}` })
    if (!v) { out.blocked = 'validation agent died'; return out }
    if (!proceeds('upfront')) {
      out.halted = {
        gate: 'upfront',
        directive: f.directive || 'conditional',
        respec: v.mismatches,
        tooling_blockers: v.tooling_blockers,
        blocked_step: blockedStep ? blockedStep.n : null,
        plan: pending.map((s) => `${s.n}. ${s.title} [${s.surface}]`),
        question: `Proceed with ${pending.length} pending step(s)${v.mismatches.length ? `, re-spec'ing steps ${v.mismatches.map((m) => m.n).join(', ')} per directive ${f.directive || 'conditional'}` : ''}? Approve with {gate:'upfront', decision:'proceed'}.`,
      }
      return out
    }
    if (v.tooling_blockers.length) { out.blocked = `tooling: ${v.tooling_blockers.join('; ')}`; return out }
    const ws = await agent(`${WR}\n\n${ctx}\nOperator approved the up-front plan. Do §5.3 + branch setup: \`git merge --no-edit origin/main-dev\` into the detached checkout — a normal merge, never -X ours/-X theirs. Resolve each conflict by hand keeping both sides' intent: docs/roadmap/ledger/{fails,insights}.md keep BOTH sides (base first) and this feature's own dir keeps the branch side. Then \`python3 scripts/ledger-guard.py --own-slug ${f.slug} --base origin/main-dev --fix\` and include any repair in the merge commit. ${v.mismatches.length ? `Re-spec ONLY these step bodies (Instructions/Codebase Evidence/Files/Verification) to match the current codebase — directive ${f.directive || 'conditional'}: ${JSON.stringify(v.mismatches)}; commit "respec(${f.slug}): align steps ${v.mismatches.map((m) => m.n).join(',')} with current codebase" with a feature.md history row and a context.md note.` : 'No re-spec needed.'} If status.md is implementation-ready, set it to in-progress with a feature.md history row and a context.md session entry "sdd-execute sequential (sdd-batch-execute)" recording the up-front confirmation. Return the commits.`, { phase: 'Gate', schema: WRITE, isolation: 'worktree', label: `setup:${f.slug}` })
    if (!ws) { out.blocked = 'setup writer died'; return out }
    out.commits.push(...ws.commits)
  }

  // ── Steps: one commit per step on the dev branch (§5.5) ──────────────────
  out.stage = 'Steps'
  let sinceCheckpoint = 0
  const adjust = aps.find((x) => typeof x.decision === 'string' && x.decision.indexOf('adjust:') === 0)
  let operatorNote = adjust ? adjust.decision.slice(7).trim() : null
  if (ap && ap.gate.indexOf('blocker:') === 0) operatorNote = `Operator decision for the blocker on step ${ap.gate.slice(8)}: ${ap.decision}`
  if (aps.some((x) => x.decision === 'stop here')) { out.stage = 'stopped'; return out }
  for (let i = 0; i < pending.length; i++) {
    const s = pending[i]
    const disc = await agent(`${ctx}\nPhase 1 discovery (read-only) for step ${s.n} — ${s.title} of docs/roadmap/features/${p.dir}/implementation-spec.md (read it from your working tree; if it differs from origin/${p.devBranch} trust the step text quoted in the spec on that branch). Re-run the step's **Codebase Evidence** commands and read its **Files**; return a confirmed/blocked digest with path:line for each symbol and a '## Not found' section.`, { agentType: 'codebase-discovery', phase: 'Steps', label: `discover:${f.slug}:s${s.n}` })
    const impl = await agent(`${WR}\n\n${ctx}\nExecute step ${s.n} — ${s.title} (sequential mode: no Phase-2 prompt). Read .claude/skills/sdd-execute/SKILL.md §PER-STEP EXECUTION, reference/sequential-mode.md (§5.5, verification fallbacks), reference/tdd-gate.md and reference/tooling-setup.md (install only what this step needs, pinned). If the discovery digest below reports a required symbol/file as not found, or verification would need a spec deviation, or the fix is ambiguous: do NOT commit code — return result 'blocker' with the question and A/B/C options (Option A = fix now by expanding this step's scope). Otherwise: run the TDD gate (capture the RED output before implementing and the GREEN output after; TDD: N/A only for non-code categories), run the step's **Verification**, then commit per §5.5 ("feat(${f.slug}): step ${s.n} — ${s.title}", staging only the step's **Files** + implementation-spec.md (step **Status** → done) + feature.md + context.md, plus lockfiles when a manifest changed), push. Report deviations (also in the spec's ## Deviation Log), out-of-scope changes, open items and still-unaddressed impl-spec review warnings for the checkpoint report.${operatorNote ? `\n\nOPERATOR NOTE (binding): ${operatorNote}` : ''}\n\n--- discovery digest ---\n${disc || '(discovery agent returned nothing — verify inline)'}`, { phase: 'Steps', schema: IMPL, isolation: 'worktree', label: `step:${f.slug}:s${s.n}` })
    operatorNote = null
    if (!impl) { out.blocked = `implementer died on step ${s.n}`; return out }
    if (impl.result === 'blocker') {
      out.halted = { gate: `blocker:${s.n}`, step: s.n, title: s.title, question: impl.blocker, options: impl.options }
      return out
    }
    out.commits.push(...impl.commits)
    sinceCheckpoint += 1
    const next = pending[i + 1]
    const fire = !next || next.surface !== s.surface || sinceCheckpoint === STEP_CAP
    if (!fire) continue
    const report = {
      gate: `checkpoint:${s.n}`,
      steps_done: pending.slice(i + 1 - sinceCheckpoint, i + 1).map((x) => `${x.n}: ${x.title} ✓`),
      surface: s.surface,
      pending: pending.length - i - 1,
      files: impl.files,
      out_of_scope: impl.out_of_scope,
      open_items: impl.open_items,
      unaddressed_warnings: impl.unaddressed_warnings,
      deviations: impl.deviations,
      next: next ? `${next.surface} (step ${next.n})` : 'integration PR',
    }
    sinceCheckpoint = 0
    if (CHECKPOINTS === 'halt') {
      out.halted = Object.assign(report, { question: "Approve with {gate:'checkpoint:<n>', decision:'proceed' | 'stop here' | 'adjust: <note>'}." })
      return out
    }
    out.reports.push(report)
  }

  // ── Land: merge-order gate, C-16 promotion, integration PR (§5.6) ────────
  out.stage = 'Land'
  if (p.mergeOrderBlock && !proceeds('merge-order')) {
    out.halted = { gate: 'merge-order', reason: p.mergeOrderBlock, question: "merge-order.md requires another feature first. Create the integration PR anyway? {gate:'merge-order', decision:'proceed'}" }
    return out
  }
  if (!proceeds('promotion') || !p.promotionPlan) {
    const plan = await agent(`${ctx}\nPlan the C-16 promotion of docs/roadmap/features/${p.dir}/acceptance.feature (read it on origin/${p.devBranch}) into the durable suites per .claude/skills/sdd-execute/SKILL.md ALL-DONE PATH step 2.5: target suite per scenario, @feature-${p.nnn} provenance tags, dedup against existing suites. Return the ready-to-write plan.`, { agentType: 'scenario-promoter', phase: 'Land', schema: PLAN, label: `promotion-plan:${f.slug}` })
    if (!plan) { out.blocked = 'promotion planner died'; return out }
    const wp = await agent(`${WR}\n\n${ctx}\nAppend a context.md session entry "sdd-batch-execute promotion plan (awaiting operator confirm)" containing the plan below inside a fenced block tagged \`sdd-batch-promotion-plan\`. Change nothing else. Commit "docs(${f.slug}): C-16 promotion plan awaiting confirm (${p.nnn})", push.\n\n${plan.plan}`, { phase: 'Land', schema: WRITE, isolation: 'worktree', label: `write-plan:${f.slug}` })
    if (wp) out.commits.push(...wp.commits)
    out.halted = { gate: 'promotion', scenarios: plan.scenarios, plan: plan.plan, question: "Confirm the C-16 promotion plan (P-04): {gate:'promotion', decision:'proceed'}." }
    return out
  }
  const pr = await agent(`${WR}\n\n${ctx}\nALL-DONE PATH (SKILL.md) for ${f.slug}: the operator confirmed the C-16 promotion plan recorded in context.md (block \`sdd-batch-promotion-plan\`). Apply exactly that plan to the durable suite files, make sure status.md is code-completed (history row if it changes), commit "docs(${f.slug}): promote acceptance scenarios (C-16) (${p.nnn})" and push. Then render .claude/skills/sdd-execute/templates/integration-pr-body.md (per-step one-liners from implementation-spec.md, new migrations, new env vars, Deviation Log summary, test plan), ending the body with these lines verbatim:\n${A.prFooter}\nand open the integration PR with mcp__github__create_pull_request (load via ToolSearch): base main-dev, head ${p.devBranch}. Return its URL and the commits.`, { phase: 'Land', schema: PR, isolation: 'worktree', label: `integration-pr:${f.slug}` })
  if (!pr) { out.blocked = 'integration-PR writer died'; return out }
  out.commits.push(...pr.commits)
  out.prUrl = pr.url
  out.stage = 'done'
  return out
}

return await pipeline(A.features, (f) => runFeature(f))
