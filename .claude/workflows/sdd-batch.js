export const meta = {
  name: 'sdd-batch',
  description: 'SDD doc phases for many features in parallel: sdd-review → sdd-design (full debate) → sdd-spec → impl-spec review, each on its feature branch',
  whenToUse: 'Several storied/triaged features need product-spec review, design, spec and impl-spec review. args: {date, trailer, features:[{slug, decisions?}], designGate?, authorizationRef?, approvals?, baseBranch?}. Docs: docs/patterns/context-engineering.md §4.',
  phases: [
    { title: 'Preflight', detail: 'resolve each slug, lifecycle, branch, NNN/slug uniqueness' },
    { title: 'Review', detail: 'spec-reviewer + feature-overlap; writer flips draft → spec-ready' },
    { title: 'Recon', detail: 'codebase-discovery per service + scenario-recon; writer writes recon.md' },
    { title: 'Design', detail: 'full debate (proposer → adversary → synthesis), gate per designGate' },
    { title: 'Spec', detail: 'writer writes implementation-spec.md → implementation-ready' },
    { title: 'ImplReview', detail: 'impl-spec review (advisory); writer addresses findings' },
  ],
}

// Contract and gate semantics: docs/patterns/context-engineering.md §4 (Workflows).
const A = args || {}
if (!A.date || !A.trailer || !Array.isArray(A.features) || A.features.length === 0) {
  throw new Error('sdd-batch: args.date (ISO date), args.trailer (commit attribution lines) and args.features[{slug}] are required')
}
const GATE = A.designGate || 'halt'
if (GATE !== 'halt' && GATE !== 'auto') throw new Error("sdd-batch: designGate must be 'halt' or 'auto'")
if (GATE === 'auto' && !A.authorizationRef) {
  throw new Error("sdd-batch: designGate 'auto' needs args.authorizationRef — where the operator's standing authorization is recorded")
}
const BASE = A.baseBranch || 'main-dev'
const APPROVALS = A.approvals || {}
const BATCH = A.features.map((f) => f.slug)
const MAX_ROUNDS = 5
const MIN_ROUNDS = 2 // full mode only: quick designs are not offered by batch runs

const PREFLIGHT = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    problems: { type: 'array', items: { type: 'string' } },
    dir: { type: 'string' },
    nnn: { type: 'string' },
    devBranch: { type: 'string' },
    branchExists: { type: 'boolean' },
    status: { type: 'string' },
    severity: { type: 'string' },
    report: { type: 'string' },
    services: { type: 'array', items: { type: 'string' } },
    subject: { type: 'string' },
    demotedSimilar: { type: 'array', items: { type: 'string' } },
    implReviewDone: { type: 'boolean' },
    priorDesignState: { type: 'string' },
    productSpec: { type: 'string' },
    acceptance: { type: 'string' },
    reconMd: { type: 'string' },
    implSpecMd: { type: 'string' },
  },
  required: ['ok', 'problems', 'dir', 'nnn', 'devBranch', 'branchExists', 'status', 'severity', 'report', 'services', 'subject', 'demotedSimilar', 'implReviewDone', 'priorDesignState', 'productSpec', 'acceptance', 'reconMd', 'implSpecMd'],
}
const REVIEW = {
  type: 'object',
  properties: {
    overall: { type: 'string', enum: ['PASS', 'PASS WITH WARNINGS', 'FAIL'] },
    fails: { type: 'array', items: { type: 'string' } },
    warnings: { type: 'array', items: { type: 'string' } },
    floor_breaches: { type: 'array', items: { type: 'string' } },
  },
  required: ['overall', 'fails', 'warnings', 'floor_breaches'],
}
const OVERLAP = {
  type: 'object',
  properties: { level: { type: 'string', enum: ['PASS', 'WARN', 'FAIL'] }, collisions: { type: 'array', items: { type: 'string' } } },
  required: ['level', 'collisions'],
}
const WRITER_A = {
  type: 'object',
  properties: {
    spec_ready: { type: 'boolean' },
    commits: { type: 'array', items: { type: 'string' } },
    product_spec_md: { type: 'string' },
    acceptance_feature: { type: 'string' },
  },
  required: ['spec_ready', 'commits', 'product_spec_md', 'acceptance_feature'],
}
const WRITER_DOC = {
  type: 'object',
  properties: { commits: { type: 'array', items: { type: 'string' } }, content: { type: 'string' } },
  required: ['commits', 'content'],
}
const SYNTH = {
  type: 'object',
  properties: {
    approach: { type: 'string' },
    open_objections: {
      type: 'array',
      items: { type: 'object', properties: { text: { type: 'string' }, blocking: { type: 'boolean' } }, required: ['text', 'blocking'] },
    },
    floor_breaches: { type: 'array', items: { type: 'string' } },
    business_rule_changes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ac_id: { type: 'string' },
          kind: { type: 'string', enum: ['PRESERVE', 'EXTEND', 'CHANGE'] },
          covered_by_operator_decision: { type: 'boolean' },
        },
        required: ['ac_id', 'kind', 'covered_by_operator_decision'],
      },
    },
    rejected_alternatives: { type: 'array', items: { type: 'string' } },
    open_risks: { type: 'array', items: { type: 'string' } },
    constitution_rules_touched: { type: 'array', items: { type: 'string' } },
    rationale: { type: 'string' },
  },
  required: ['approach', 'open_objections', 'floor_breaches', 'business_rule_changes', 'rejected_alternatives', 'open_risks', 'constitution_rules_touched', 'rationale'],
}
const WRITER_SPEC = {
  type: 'object',
  properties: { commits: { type: 'array', items: { type: 'string' } }, content: { type: 'string' }, steps: { type: 'number' }, step_titles: { type: 'array', items: { type: 'string' } } },
  required: ['commits', 'content', 'steps', 'step_titles'],
}
const WRITER_FINAL = {
  type: 'object',
  properties: { commits: { type: 'array', items: { type: 'string' } }, addressed: { type: 'array', items: { type: 'string' } }, still_open: { type: 'array', items: { type: 'string' } } },
  required: ['commits', 'addressed', 'still_open'],
}

function approval(slug, gate) {
  const a = [].concat(APPROVALS[slug] || []).find((x) => x && x.gate === gate)
  return a ? a.decision : null
}

function decisions(f) {
  const lines = (f.decisions || []).map((d) => '- ' + d)
  if (GATE === 'auto') {
    lines.unshift(`- Standing authorization (${A.authorizationRef}): the orchestrator auto-approves the design gate once rounds >= ${MIN_ROUNDS}, no unresolved Floor (F-*) breach and no blocking objection remain, and every CHANGE to an existing @AC business rule is covered by an operator decision below.`)
  }
  return lines.length ? `OPERATOR DECISIONS (binding, recorded ${A.date}):\n${lines.join('\n')}` : 'OPERATOR DECISIONS: none recorded.'
}

function writerRules(f, p) {
  return `You are the single writer (Constitution P-01) for SDD feature ${p.dir} (slug \`${f.slug}\`, dir docs/roadmap/features/${p.dir}/). You run in your own git worktree. Mandatory git protocol:
1. \`git fetch origin\`. If \`git ls-remote --exit-code --heads origin ${p.devBranch}\` succeeds run \`git checkout --detach origin/${p.devBranch}\`, else \`git checkout --detach origin/${BASE}\`. Never check out a named local branch (another worktree may hold it).
2. If \`node_modules\` is missing at the worktree root, symlink it from the main worktree (first entry of \`git worktree list --porcelain\`) so the husky pre-commit hook runs. Never use --no-verify.
3. Edit ONLY files under docs/roadmap/features/${p.dir}/ (plus docs/roadmap/ledger/insights.md or fails.md only when the skill step explicitly calls for a ledger line).
4. Push after EACH artifact edit: the moment one file is created or changed, stage only that file, commit it (subject = this task's commit message + " — <file name>"; body ends with the lines below, verbatim) and push (rule 5) before touching the next file. Never batch several files into one commit and never leave an edit uncommitted, so an interrupted run loses at most the file in progress.
${A.trailer}
5. \`git push origin HEAD:refs/heads/${p.devBranch}\`; retry up to 4 times (2s/4s/8s/16s) on network errors only. Never push to any other ref, never force-push.
6. Return every commit sha you created, in order, as \`commits\`.
Use ${A.date} for every Status History row and session header. Severity tokens: only ${p.severity} may appear (never another SEV level).`
}

async function runFeature(f) {
  const out = { slug: f.slug, stage: 'Preflight', halted: null, blocked: null, commits: [] }

  // ── Preflight (read-only) ────────────────────────────────────────────────
  const p = await agent(`Read-only preflight for SDD feature slug \`${f.slug}\` (batch: ${BATCH.join(', ')}). Never write, commit or push. Run \`git fetch origin\` first, then:
1. On origin/${BASE} list \`git ls-tree --name-only origin/${BASE} docs/roadmap/features/\` and resolve dirs ending in \`-${f.slug}\`. Exactly one is required; if 0 or >1 add a problem ("slug not unique" lists every match — skills resolve features by \`*-<slug>\`).
2. From that dir's feature.md: Development Branch (default \`feature/${f.slug}\`), Severity (or "n/a"), source report/issue (or "none"), a one-line subject from ## Summary. From product-spec.md ## Affected Services: the service names (xstockstrat-* or packages/*).
3. branchExists = \`git ls-remote --exit-code --heads origin <devBranch>\`. status = status.md from origin/<devBranch> when it exists, else from origin/${BASE} (plain string).
4. NNN uniqueness: the dir's NNN prefix must not be used by a different slug on origin/main-dev or on any remote branch (\`git ls-remote --heads origin\`, then \`git ls-tree\` per branch). A clash is a problem.
5. demotedSimilar: slugs of features whose status.md is \`demoted/canceled\` sharing >= 2 hyphen tokens with \`${f.slug}\` (sdd-review A1b duplicate check).
6. implReviewDone: true when context.md (on the branch you read status from) has a session entry for "sdd-review impl-spec".
7. priorDesignState: the JSON inside the LAST fenced block tagged \`sdd-batch-design-state\` in context.md, or "" if none.
8. Return the full current text (from the same branch as status) of product-spec.md, acceptance.feature, recon.md and implementation-spec.md ("" for any that does not exist). Downstream read-only agents cannot run git, so these copies are what they review.
ok = no problems.`, { phase: 'Preflight', schema: PREFLIGHT, label: `preflight:${f.slug}` })
  if (!p) { out.blocked = 'preflight agent died'; return out }
  Object.assign(out, { nnn: p.nnn, dir: p.dir, devBranch: p.devBranch, status: p.status })
  if (!p.ok) { out.blocked = `preflight: ${p.problems.join('; ')}`; return out }
  if (p.demotedSimilar.length && approval(f.slug, 'demoted-duplicate') !== 'not-a-duplicate') {
    out.halted = { gate: 'demoted-duplicate', question: `Is ${f.slug} a re-attempt of demoted/canceled ${p.demotedSimilar.join(', ')}? Approve with {gate:'demoted-duplicate', decision:'not-a-duplicate'} or route through /sdd-review A1b interactively.` }
    return out
  }

  const ctx = `Feature ${p.dir} (${p.severity}). Source: ${p.report}. Affected services: ${p.services.join(', ')}. Peer features in this batch: ${BATCH.join(', ')}.`
  const WR = writerRules(f, p)
  let status = p.status
  let specText = p.productSpec, accText = p.acceptance

  // ── Review: /sdd-review product-spec ─────────────────────────────────────
  if (status === 'draft') {
    out.stage = 'Review'
    let verdict = null, overlap = null, wa = null
    for (let attempt = 1; attempt <= 2; attempt++) {
      const inline = `\n\nReview THESE contents (current on ${p.branchExists || attempt > 1 ? p.devBranch : BASE}; the working-tree copies may differ):\n--- product-spec.md ---\n${specText}\n--- acceptance.feature ---\n${accText}\n`
      const res = await parallel([
        () => agent(`${ctx}\nReview docs/roadmap/features/${p.dir}/product-spec.md in mode product-spec, with the sibling acceptance scenarios at docs/roadmap/features/${p.dir}/acceptance.feature. Apply every criterion in .claude/skills/sdd-review/reference/product-spec-criteria.md (core + trading-domain table); criterion 8 checks acceptance.feature exists, every FR-N has a covering @AC-* scenario, and scenarios are well-formed. Verify code-checkable claims. Tag findings with Constitution IDs (docs/sdd/constitution.md); a Floor (F-*) breach is a blocking FAIL.${inline}`, { agentType: 'spec-reviewer', phase: 'Review', schema: REVIEW, label: `review-spec:${f.slug}#${attempt}` }),
        () => agent(`${ctx}\nRun the Mode A (product-spec) overlap scan in .claude/skills/sdd-review/reference/overlap-check.md for docs/roadmap/features/${p.dir}. Return the collision report.${inline}`, { agentType: 'feature-overlap', phase: 'Review', schema: OVERLAP, label: `overlap:${f.slug}#${attempt}` }),
      ])
      verdict = res[0]
      overlap = res[1]
      if (!verdict || !overlap) { out.blocked = 'review agent died'; return out }
      wa = await agent(`${WR}\n\n${ctx}\nYou are /sdd-review ${f.slug} product-spec step A4 (outcome); read .claude/skills/sdd-review/SKILL.md §MODE A A4 for the exact edits.\n\nCriteria verdict:\n${JSON.stringify(verdict, null, 2)}\n\nOverlap verdict:\n${JSON.stringify(overlap, null, 2)}\n\n${decisions(f)}\n\n- Any FAIL (criteria fails, floor breach, or overlap FAIL): minimally edit product-spec.md / acceptance.feature to resolve each item without weakening a requirement or dropping a regression scenario; leave status.md/feature.md history alone; commit "docs(${f.slug}): address product-spec review findings (${p.nnn})"; push; spec_ready=false.\n- Otherwise apply the A4 PASS edits (status.md → spec-ready, feature.md history row + Next Action \`/sdd-design ${f.slug}\`, context.md session entry with warnings + overlap findings, and the OPERATOR DECISIONS block verbatim); resolve clearly-correct cheap warnings; commit "docs(${f.slug}): product spec approved — draft → spec-ready (${p.nnn})"; push; spec_ready=true.\nReturn the CURRENT full product-spec.md and acceptance.feature.`, { phase: 'Review', schema: WRITER_A, isolation: 'worktree', label: `write-review:${f.slug}#${attempt}` })
      if (!wa) { out.blocked = 'review writer died'; return out }
      out.commits.push(...wa.commits)
      specText = wa.product_spec_md
      accText = wa.acceptance_feature
      if (wa.spec_ready) break
    }
    if (!wa.spec_ready) { out.blocked = `product-spec review still FAIL after 2 attempts: ${JSON.stringify(verdict.fails)}`; return out }
    status = 'spec-ready'
  }

  const specBlock = `--- product-spec.md ---\n${specText}\n--- acceptance.feature ---\n${accText}`

  // ── Recon + Design: /sdd-design (full) ───────────────────────────────────
  if (status === 'spec-ready') {
    let recon = p.reconMd || null
    let state = null
    if (p.priorDesignState) {
      try { state = JSON.parse(p.priorDesignState) } catch (e) { out.blocked = 'unparseable sdd-batch-design-state block in context.md'; return out }
    }
    if (!recon) {
      out.stage = 'Recon'
      const digests = (await parallel([
        ...p.services.map((svc) => () => agent(`${ctx}\nPhase 0 recon for /sdd-design ${f.slug}. Service under discovery: ${svc}. Follow .claude/skills/sdd-design/reference/recon-checklist.md tailored to this feature's symbols, config keys, env vars, ports, migrations, proto messages and tests. Return a CONDENSED path:line digest, patterns to reuse, next free migration NNN when relevant, existing test harness, and '## Not found'. Never invent.\n\n${specBlock}`, { agentType: 'codebase-discovery', phase: 'Recon', label: `discover:${f.slug}:${svc}` })),
        () => agent(`${ctx}\nFeature subject: ${p.subject}. Read the affected services' acceptance/*.feature suites and docs/sdd/business-rules/platform.feature; return the 'Existing Business Rules' digest of @AC-* guarantees this feature could touch, classified PRESERVE / EXTEND / CHANGE.\n\n${specBlock}`, { agentType: 'scenario-recon', phase: 'Recon', label: `scenario-recon:${f.slug}` }),
      ])).filter(Boolean)
      if (digests.length === 0) { out.blocked = 'recon agents died'; return out }
      const wb = await agent(`${WR}\n\n${ctx}\nYou are /sdd-design ${f.slug} Phase 0 step 3. Read docs/sdd/constitution.md, docs/roadmap/ledger/{fails,insights}.md (entries relevant to the affected services), the feature's context.md and .claude/skills/sdd-design/templates/recon.md, then write docs/roadmap/features/${p.dir}/recon.md from the template using the digests below (re-grep anything you cite). Do NOT change status.md. Commit "docs(${f.slug}): sdd-design Phase 0 recon (${p.nnn})", push. Return recon.md's full content.\n\n${decisions(f)}\n\nDIGESTS:\n${digests.map((d, i) => `### digest ${i + 1}\n${d}`).join('\n\n')}`, { phase: 'Recon', schema: WRITER_DOC, isolation: 'worktree', label: `write-recon:${f.slug}` })
      if (!wb) { out.blocked = 'recon writer died'; return out }
      out.commits.push(...wb.commits)
      recon = wb.content
    }
    const reconBlock = `--- recon.md ---\n${recon}`

    out.stage = 'Design'
    const decision = approval(f.slug, 'design')
    let approved = false
    let steer = decision && decision.indexOf('steer:') === 0 ? decision.slice(6).trim() : null
    let prop = state ? state.final_proposal || '' : null
    let adv = state ? state.final_adversary || '' : null
    let r = state ? state.round : 0
    if (decision === 'approve' && state && state.round >= MIN_ROUNDS && state.floor_breaches.length === 0) approved = true
    while (!approved && r < MAX_ROUNDS) {
      r += 1
      prop = await agent(`${ctx}\nDesign proposer, round ${r} of the /sdd-design ${f.slug} full debate. Propose ONE concrete design with path:line evidence and an explicit assumptions list. Operator decisions are fixed constraints.\n\n${decisions(f)}${steer ? `\n\nOPERATOR STEER for this round: ${steer}` : ''}\n\n${reconBlock}\n\n${specBlock}${state ? `\n\n--- orchestrator synthesized state after round ${r - 1} (address the open objections) ---\n${JSON.stringify(state.synth, null, 2)}` : ''}`, { agentType: 'design-proposer', phase: 'Design', label: `propose:${f.slug}:r${r}` })
      if (!prop) { out.blocked = `proposer died r${r}`; return out }
      adv = await agent(`${ctx}\nDesign adversary, round ${r} of the /sdd-design ${f.slug} full debate. Attack the approach: architectural flaws, security/data gaps, simpler alternatives, design quality (C-18), and every C-*/P-*/F-* it would violate cited by ID (read docs/sdd/constitution.md and relevant docs/roadmap/ledger/fails.md). C-16: any break of an existing @AC-* guarantee in recon's Existing Business Rules is an objection cited by @AC id. Name trade-offs of alternatives you reject. Mark each objection blocking or non-blocking. Operator decisions are fixed unless they breach a Floor rule.\n\n${decisions(f)}\n\n${reconBlock}\n\n${specBlock}\n\n--- PROPOSED APPROACH (verbatim) ---\n${prop}`, { agentType: 'design-adversary', phase: 'Design', label: `attack:${f.slug}:r${r}` })
      if (!adv) { out.blocked = `adversary died r${r}`; return out }
      const synth = await agent(`${ctx}\nYou are the /sdd-design orchestrator's synthesis step for round ${r} (P-02 mediator — only your synthesis reaches the next proposer). Produce: current best approach (concrete, path:line), open objections (blocking only if they must be resolved before approval), unresolved Floor breaches, business-rule impact per @AC id (covered_by_operator_decision only when an operator decision explicitly sanctions the change), rejected alternatives (option + why it lost), open risks, constitution rules touched. An objection the proposal does not concretely answer stays open.\n\n${decisions(f)}\n\n--- PROPOSAL r${r} ---\n${prop}\n\n--- ADVERSARY r${r} ---\n${adv}${state ? `\n\n--- PRIOR STATE ---\n${JSON.stringify(state.synth, null, 2)}` : ''}`, { phase: 'Design', schema: SYNTH, label: `synth:${f.slug}:r${r}` })
      if (!synth) { out.blocked = `synthesis died r${r}`; return out }
      state = { round: r, synth, floor_breaches: synth.floor_breaches, final_proposal: prop, final_adversary: adv }
      steer = null
      const uncovered = synth.business_rule_changes.some((c) => c.kind === 'CHANGE' && !c.covered_by_operator_decision)
      const blocking = synth.open_objections.some((o) => o.blocking)
      log(`${f.slug} r${r}: floor=${synth.floor_breaches.length} blocking=${blocking} uncoveredChange=${uncovered}`)
      if (r < MIN_ROUNDS) continue
      if (GATE === 'auto' && synth.floor_breaches.length === 0 && !blocking && !uncovered) { approved = true; break }
      if (GATE === 'halt' || synth.floor_breaches.length || uncovered || r === MAX_ROUNDS) break
    }
    out.rounds = state ? state.round : 0
    if (!approved) {
      const persisted = JSON.stringify({ round: state.round, synth: state.synth, floor_breaches: state.floor_breaches }, null, 2)
      const wh = await agent(`${WR}\n\n${ctx}\nThe /sdd-design ${f.slug} full debate is at its approval gate after round ${state.round} (gate policy: ${GATE}). Per the grilling protocol do NOT write design.md and do NOT change status.md. Append a context.md session entry "sdd-batch design gate (round ${state.round})": a tight synthesis (approach, strongest open objection, Floor status, uncovered @AC changes) under '## Open Threads' wording, followed by a fenced block tagged \`sdd-batch-design-state\` containing exactly this JSON (so the next /sdd-batch run resumes the debate):\n\n${persisted}\n\nCommit "docs(${f.slug}): sdd-design at gate after round ${state.round} (${p.nnn})", push. Return content = the synthesis text you wrote.`, { phase: 'Design', schema: WRITER_DOC, isolation: 'worktree', label: `write-gate:${f.slug}` })
      if (wh) out.commits.push(...wh.commits)
      out.halted = {
        gate: 'design',
        round: state.round,
        floor_breaches: state.synth.floor_breaches,
        blocking: state.synth.open_objections.filter((o) => o.blocking).map((o) => o.text),
        uncovered_changes: state.synth.business_rule_changes.filter((c) => c.kind === 'CHANGE' && !c.covered_by_operator_decision).map((c) => c.ac_id),
        approach: state.synth.approach,
        question: `Approve with {gate:'design', decision:'approve'} (needs round >= ${MIN_ROUNDS} and no Floor breach), 'another-round', or 'steer: <note>'.`,
      }
      return out
    }
    const wc = await agent(`${WR}\n\n${ctx}\nYou are /sdd-design ${f.slug} Phase 1 'Approved' + COMPLETION (read .claude/skills/sdd-design/SKILL.md §COMPLETION and templates/design.md). Approved after ${state.round} full-mode rounds — ${decision === 'approve' ? 'operator approval at the gate' : `auto-approved under ${A.authorizationRef}`} (Floor clear). Write docs/roadmap/features/${p.dir}/design.md: Chosen Approach (cite recon.md path:line), Rejected Alternatives, Open Risks, Constitution Rules Touched, Business Rules Touched (C-16, with the operator-decision reference for each CHANGE), Rounds + termination reason. COMPLETION edits: status.md spec-ready → design-approved; feature.md history row + Next Action \`/sdd-spec ${f.slug}\` + Artifacts; context.md session entry (Open Risks into Open Threads). Ledger line only for a genuinely reusable pattern/trap. Commit "docs(${f.slug}): design approved — spec-ready → design-approved (${p.nnn})", push. Return design.md's content.\n\n${decisions(f)}\n\n--- FINAL SYNTHESIZED STATE ---\n${JSON.stringify(state.synth, null, 2)}\n\n--- FINAL PROPOSAL ---\n${prop}\n\n--- FINAL ADVERSARY ---\n${adv}`, { phase: 'Design', schema: WRITER_DOC, isolation: 'worktree', label: `write-design:${f.slug}` })
    if (!wc) { out.blocked = 'design writer died'; return out }
    out.commits.push(...wc.commits)
    out.open_risks = state.synth.open_risks
    status = 'design-approved'
  }

  // ── Spec: /sdd-spec ──────────────────────────────────────────────────────
  let implText = null
  const implExisting = p.implSpecMd
  if (status === 'design-approved') {
    out.stage = 'Spec'
    const wd = await agent(`${WR}\n\n${ctx}\nYou are /sdd-spec ${f.slug} end to end (read .claude/skills/sdd-spec/SKILL.md + reference/spec-template.md, step-constraints.md, discovery-checklist.md). design.md's Chosen Approach is mandatory, Rejected Alternatives are off the table, recon.md's Patterns to REUSE are mandatory reuse targets. Do the Step 2 governance reads, then any discovery recon.md lacks yourself — no invented paths/functions/lines (unfound → **Not found**). Every @AC-* scenario is covered by a step's **Covers** line (C-15); every code step has a paired red-before-green test step. Proto steps verify with \`buf lint && buf breaking --against '<repo-root>/.git#branch=${p.devBranch},subdir=packages/proto'\` from packages/proto (PLAT-10: subdir= is mandatory). Migrations: next free NNN, up+down pair. Write implementation-spec.md, then Step 7/8 edits (status.md → implementation-ready, feature.md history + Reviewers + Next Action, context.md). Commit "docs(${f.slug}): implementation spec — design-approved → implementation-ready (${p.nnn})", push. Return the spec content, step count, titles and commits.\n\n${decisions(f)}`, { phase: 'Spec', schema: WRITER_SPEC, isolation: 'worktree', label: `write-spec:${f.slug}` })
    if (!wd) { out.blocked = 'spec writer died'; return out }
    out.commits.push(...wd.commits)
    out.steps = wd.steps
    implText = wd.content
    status = 'implementation-ready'
  }

  // ── ImplReview: /sdd-review impl-spec (advisory) ─────────────────────────
  if (status === 'implementation-ready' && (implText || !p.implReviewDone)) {
    out.stage = 'ImplReview'
    const implBlock = `--- implementation-spec.md ---\n${implText || implExisting}`
    const ir = await parallel([
      () => agent(`${ctx}\nReview the implementation spec in mode impl-spec: apply every criterion in .claude/skills/sdd-review/reference/impl-spec-criteria.md and verify code-checkable claims (paths, symbols, line hints, migration NNN, proto field numbers, config keys). Tag findings with Constitution IDs; a Floor breach is a blocking FAIL.\n\n${implBlock}\n\n${specBlock}`, { agentType: 'spec-reviewer', phase: 'ImplReview', schema: REVIEW, label: `review-impl:${f.slug}` }),
      () => agent(`${ctx}\nRun the Mode B (impl-spec) overlap scan in .claude/skills/sdd-review/reference/overlap-check.md for docs/roadmap/features/${p.dir}. Report migration NNN, proto field, config key and shared-file collisions with in-flight features (including this batch's peers on their feature branches).\n\n${implBlock}`, { agentType: 'feature-overlap', phase: 'ImplReview', schema: OVERLAP, label: `overlap-impl:${f.slug}` }),
    ])
    const we = await agent(`${WR}\n\n${ctx}\nYou are /sdd-review ${f.slug} impl-spec (MODE B, advisory — lifecycle unchanged; read .claude/skills/sdd-review/SKILL.md §MODE B). Address every FAIL and clearly-correct WARN by editing implementation-spec.md (re-verify each claim; never invent). Record anything left unaddressed in context.md as an Open Thread so it surfaces at the /sdd-execute checkpoint. Append a context.md session entry "sdd-review impl-spec" with addressed / still-open lists. Commit "docs(${f.slug}): address impl-spec review findings (${p.nnn})", push.\n\nCriteria verdict:\n${JSON.stringify(ir[0], null, 2)}\n\nOverlap verdict:\n${JSON.stringify(ir[1], null, 2)}`, { phase: 'ImplReview', schema: WRITER_FINAL, isolation: 'worktree', label: `write-implreview:${f.slug}` })
    if (!we) { out.blocked = 'impl-review writer died'; return out }
    out.commits.push(...we.commits)
    out.still_open = we.still_open
  }
  out.stage = 'done'
  out.status = status
  return out
}

return await pipeline(A.features, (f) => runFeature(f))
