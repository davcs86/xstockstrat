export const meta = {
  name: 'merge-train',
  description: 'Progressively merge a queue of PRs: bring each up to date with its base, auto-resolve allowlisted conflicts, wait for green CI, merge by branch policy, retarget stacked PRs, repeat',
  whenToUse: 'Several open PRs must land in order (stacked, or sharing append-only files) and the operator has authorized the merges. args: {date, trailer, repo, mergeAuthorized:true, authorizationRef, prs:[{number, dependsOn?}], allowMain?, ciTimeoutMin?}. Docs: docs/patterns/context-engineering.md §4.',
  phases: [
    { title: 'Inspect', detail: 'state, base/head, mergeability, CI and review signals of every pending PR' },
    { title: 'Update', detail: 'merge the base into the PR head; allowlisted conflicts via scripts/merge-train-resolve.mjs' },
    { title: 'CI', detail: 'poll check runs on the new head up to ciTimeoutMin' },
    { title: 'Merge', detail: 'merge with the branch-policy method, or retarget a stacked PR' },
  ],
}

// Contract and gate semantics: docs/patterns/context-engineering.md §4 (Workflows).
const A = args || {}
if (!A.date || !A.trailer || !A.repo || !Array.isArray(A.prs) || A.prs.length === 0) {
  throw new Error('merge-train: args.date, args.trailer (merge-commit attribution), args.repo ("owner/name") and args.prs[{number}] are required')
}
if (A.mergeAuthorized !== true || !A.authorizationRef) {
  throw new Error('merge-train: merging is an outward action — pass mergeAuthorized:true and args.authorizationRef (where the operator authorized these merges)')
}
const QUEUE = A.prs.map((p) => (typeof p === 'number' ? { number: p, dependsOn: [] } : { number: p.number, dependsOn: p.dependsOn || [] }))
const NUMS = QUEUE.map((p) => p.number)
for (const p of QUEUE) {
  for (const d of p.dependsOn) if (!NUMS.includes(d)) throw new Error(`merge-train: #${p.number} dependsOn #${d}, which is not in args.prs`)
}
const CI_TIMEOUT_MIN = A.ciTimeoutMin || 30
const TRUNKS = ['main-dev', 'main']
const MAX_ROUNDS = QUEUE.length * 4 + 2

const STR = { type: 'string' }
const STRS = { type: 'array', items: STR }
const INSPECT = {
  type: 'object',
  properties: {
    prs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          number: { type: 'number' },
          state: { type: 'string', enum: ['open', 'merged', 'closed'] },
          title: STR,
          base: STR,
          head: STR,
          headSha: STR,
          mergeable: { type: 'string', enum: ['clean', 'behind', 'conflict', 'blocked', 'unknown'] },
          ci: { type: 'string', enum: ['green', 'pending', 'red', 'none'] },
          failing: STRS,
          changesRequested: { type: 'boolean' },
          approvals: { type: 'string', enum: ['pass', 'fail', 'pending', 'absent'] },
        },
        required: ['number', 'state', 'title', 'base', 'head', 'headSha', 'mergeable', 'ci', 'failing', 'changesRequested', 'approvals'],
      },
    },
  },
  required: ['prs'],
}
const UPDATE = {
  type: 'object',
  properties: { result: { type: 'string', enum: ['pushed', 'up-to-date', 'halt'] }, sha: STR, resolved: STRS, unresolvable: STRS, note: STR },
  required: ['result', 'sha', 'resolved', 'unresolvable', 'note'],
}
const WAIT = {
  type: 'object',
  properties: { ci: { type: 'string', enum: ['green', 'red', 'timeout', 'none'] }, headSha: STR, failing: STRS },
  required: ['ci', 'headSha', 'failing'],
}
const MERGE = { type: 'object', properties: { merged: { type: 'boolean' }, sha: STR, error: STR }, required: ['merged', 'sha', 'error'] }
const RETARGET = { type: 'object', properties: { ok: { type: 'boolean' }, error: STR }, required: ['ok', 'error'] }

const GH = `Repository ${A.repo}. Use the GitHub MCP tools (load them with ToolSearch, e.g. "select:mcp__github__pull_request_read,mcp__github__merge_pull_request,mcp__github__update_pull_request"); never the gh CLI.`
const CI_RULE = 'Classify the check runs on a head SHA: red if any completed run concluded failure, cancelled, timed_out or action_required; pending if any run is queued or in_progress; none if there are zero runs; otherwise green (success, skipped and neutral all count). The "Claude Approvals" check run is reported separately as approvals and excluded from ci.'

// Squash into main-dev; merge commit into main, and only from hotfix/* or main-dev (root CLAUDE.md § Merge Strategy).
function mergeMethod(base, head) {
  if (base === 'main-dev') return { method: 'squash' }
  if (base === 'main') {
    if (!A.allowMain) return { halt: 'targets main: pass allowMain:true to merge into main' }
    if (head.startsWith('hotfix/') || head === 'main-dev') return { method: 'merge' }
    return { halt: `head ${head} may not merge into main (only hotfix/* or main-dev)` }
  }
  return { halt: `base ${base} is not a trunk` }
}
const ownSlug = (head) => (head.match(/^feature\/(.+)$/) || [])[1] || ''

const st = {}
for (const p of QUEUE) st[p.number] = { number: p.number, status: 'pending', reason: '', method: '', mergeSha: '', failing: [], resolved: [], unresolvable: [], attempts: 0 }
const heads = {}
const mergedInto = {}
const mergeOrder = []
const halt = (n, reason, extra = {}) => Object.assign(st[n], { status: 'halted', reason }, extra)
const stackParent = (n, base) => NUMS.find((q) => q !== n && heads[q] === base)
const deps = (p, base) => p.dependsOn.concat(stackParent(p.number, base) || [])

function inspectPrompt(nums) {
  return `${GH}
Read-only: change nothing. For each of these pull requests: ${nums.map((n) => '#' + n).join(', ')}
- pull_request_read get → state (merged / closed-unmerged = "closed" / open), title, base.ref, head.ref, head.sha, mergeable_state mapped as clean|unstable|has_hooks → "clean", behind → "behind", dirty → "conflict", blocked → "blocked", anything else → "unknown" (re-read once after ~10 s before settling on "unknown").
- pull_request_read get_check_runs on that head SHA. ${CI_RULE} List the names of red runs in failing.
- pull_request_read get_reviews: changesRequested = true when any reviewer's latest review is CHANGES_REQUESTED.
Return one entry per PR, in the order given.`
}

function updatePrompt(x) {
  return `You bring PR #${x.number} (${x.head} → ${x.base}) up to date with its base. You run in your own git worktree. Protocol:
1. \`git fetch origin\`, then \`git checkout --detach origin/${x.head}\`. If HEAD is not ${x.headSha}, return result "halt", note "head moved".
2. The main worktree is the first entry of \`git worktree list --porcelain\`. Symlink its root \`node_modules\` and every \`services/*/node_modules\` it has into this worktree (where missing) so the husky pre-commit hook can run. Never use --no-verify.
3. \`git merge --no-edit -m "Merge origin/${x.base} into ${x.head}" -m "${A.trailer.replace(/"/g, '\\"')}" origin/${x.base}\`. If git says it is already up to date, return result "up-to-date" with sha = HEAD.
4. On conflicts run \`node <main-worktree>/scripts/merge-train-resolve.mjs --own-slug "${ownSlug(x.head)}"\` here. Exit 2: \`git merge --abort\` and return result "halt" with unresolvable = each "path: reason" it printed. Exit 0: put its resolved "path (rule)" entries in resolved, then \`git commit --no-edit\`. Never edit a file or resolve a conflict yourself.
5. If the commit hook fails, \`git merge --abort\` and return "halt" with the last 20 lines of its output as note.
6. \`git push origin HEAD:refs/heads/${x.head}\`; retry only network errors, up to 4 times (2s/4s/8s/16s). Never force-push, never push anywhere else. A rejected push → "halt" with the error as note.
Return result "pushed" with the pushed sha.`
}

function waitPrompt(n, sha) {
  return `${GH}
Read-only. Wait for CI on PR #${n}, head ${sha}. Loop: re-read the PR (pull_request_read get); if head.sha is no longer ${sha}, return at once with that headSha and ci "none". Otherwise read get_check_runs for ${sha}. ${CI_RULE} Return when nothing is pending: green, or red with the red run names in failing. Between polls wait about 45 s with a shell wait (use the Monitor tool with an until-loop if a foreground sleep is refused); never poll the API in a tight loop. Return ci "none" if there are still zero runs after 5 minutes, and ci "timeout" once ${CI_TIMEOUT_MIN} minutes have passed.`
}

for (let round = 1; round <= MAX_ROUNDS; round++) {
  const pending = QUEUE.filter((p) => st[p.number].status === 'pending')
  if (pending.length === 0) break
  const ins = await agent(inspectPrompt(pending.map((p) => p.number)), { label: `inspect:r${round}`, phase: 'Inspect', schema: INSPECT, effort: 'low' })
  if (!ins) {
    for (const p of pending) halt(p.number, 'inspect agent died')
    break
  }
  const info = {}
  for (const x of ins.prs) { info[x.number] = x; heads[x.number] = x.head }
  for (const p of pending) {
    const x = info[p.number]
    if (!x) halt(p.number, 'missing from the inspection')
    else if (x.state === 'merged') {
      Object.assign(st[p.number], { status: 'merged', reason: 'merged outside the train' })
      mergedInto[p.number] = x.base
      mergeOrder.push(p.number)
    }
    else if (x.state === 'closed') halt(p.number, 'closed without merging')
  }
  let changed = true
  while (changed) {
    changed = false
    for (const p of QUEUE) {
      if (st[p.number].status !== 'pending') continue
      const bad = deps(p, info[p.number].base).find((d) => st[d].status === 'halted')
      if (bad) { halt(p.number, `waits on #${bad}, which halted`); changed = true }
    }
  }
  const c = QUEUE.find((p) => st[p.number].status === 'pending' && deps(p, info[p.number].base).every((d) => st[d].status === 'merged'))
  if (!c) {
    for (const p of QUEUE) if (st[p.number].status === 'pending') halt(p.number, 'dependency cycle: no PR can go first')
    break
  }
  const n = c.number
  const x = info[n]

  if (!TRUNKS.includes(x.base)) {
    const parent = stackParent(n, x.base)
    if (!parent) { halt(n, `base ${x.base} is neither a trunk nor the head of a queued PR`); continue }
    const r = await agent(`${GH}\nRetarget PR #${n}: update_pull_request with base "${mergedInto[parent]}". Change nothing else.`, { label: `retarget:#${n}`, phase: 'Merge', schema: RETARGET, effort: 'low' })
    if (!r || !r.ok) halt(n, `retarget to ${mergedInto[parent]} failed: ${r ? r.error : 'agent died'}`)
    continue
  }
  const pol = mergeMethod(x.base, x.head)
  if (pol.halt) { halt(n, pol.halt); continue }
  if (x.changesRequested) { halt(n, 'a reviewer requested changes'); continue }
  if (x.approvals === 'fail') { halt(n, 'the Claude Approvals check is failing'); continue }

  let head = x.headSha
  let ci = x.ci
  if (x.mergeable === 'behind' || x.mergeable === 'conflict' || x.ci === 'none') {
    const u = await agent(updatePrompt(x), { label: `update:#${n}:r${round}`, phase: 'Update', schema: UPDATE, isolation: 'worktree' })
    if (!u) { halt(n, 'update agent died'); continue }
    st[n].resolved = st[n].resolved.concat(u.resolved)
    if (u.result === 'halt') { halt(n, `update halted: ${u.note}`, { unresolvable: u.unresolvable }); continue }
    if (u.result === 'pushed') { head = u.sha; ci = 'pending' } else if (x.ci === 'none') {
      halt(n, 'no CI ran on the head and the branch is current with its base: it needs a real push (never an empty commit)')
      continue
    }
  }
  if (ci === 'red') { halt(n, 'CI red', { failing: x.failing }); continue }
  if (ci !== 'green' || x.approvals === 'pending') {
    const w = await agent(waitPrompt(n, head), { label: `wait:#${n}:r${round}`, phase: 'CI', schema: WAIT, effort: 'low' })
    if (!w) { halt(n, 'CI wait agent died'); continue }
    if (w.headSha && w.headSha !== head) {
      if (++st[n].attempts > 2) halt(n, 'head keeps moving during the CI wait')
      continue
    }
    if (w.ci === 'red') { halt(n, 'CI red', { failing: w.failing }); continue }
    if (w.ci === 'timeout') { halt(n, `CI still pending after ${CI_TIMEOUT_MIN} min`); continue }
    if (w.ci === 'none') { halt(n, 'no CI runs appeared on the head'); continue }
  }
  const m = await agent(`${GH}\nMerge PR #${n}: merge_pull_request with merge_method "${pol.method}", expectedHeadSha "${head}", commit_title "${x.title.replace(/"/g, '\\"')} (#${n})". Do nothing else. Return merged, the merge sha, or the error text verbatim.`, { label: `merge:#${n}:r${round}`, phase: 'Merge', schema: MERGE, effort: 'low' })
  if (m && m.merged) {
    Object.assign(st[n], { status: 'merged', method: pol.method, mergeSha: m.sha })
    mergedInto[n] = x.base
    mergeOrder.push(n)
  } else if (++st[n].attempts > 2) {
    halt(n, `merge refused: ${m ? m.error : 'agent died'}`)
  }
}
for (const p of QUEUE) if (st[p.number].status === 'pending') halt(p.number, `round cap (${MAX_ROUNDS}) reached`)

const all = QUEUE.map((p) => st[p.number])
return {
  merged: mergeOrder.map((n) => st[n]).map((s) => ({ number: s.number, method: s.method, mergeSha: s.mergeSha, resolved: s.resolved })),
  halted: all.filter((s) => s.status === 'halted').map((s) => ({ number: s.number, reason: s.reason, failing: s.failing, unresolvable: s.unresolvable })),
}
