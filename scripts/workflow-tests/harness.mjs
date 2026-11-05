// Mock harness for .claude/workflows/*.js: runs the real script with scripted agent() replies keyed by label prefix.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
export async function run(file, args, replies) {
  const src = fs.readFileSync(file, 'utf8').replace(/^export const meta =/m, 'const meta =')
  const calls = []
  const agent = async (prompt, opts = {}) => {
    calls.push({ label: opts.label, opts, prompt })
    const key = Object.keys(replies).find((k) => (opts.label || '').startsWith(k))
    if (!key) throw new Error('no mock for ' + opts.label)
    const r = replies[key]
    return typeof r === 'function' ? r(prompt, opts, calls) : r
  }
  const parallel = async (thunks) => Promise.all(thunks.map((t) => t().catch(() => null)))
  const pipeline = async (items, ...stages) => Promise.all(items.map(async (it, i) => {
    let v = it
    for (const s of stages) { try { v = await s(v, it, i) } catch (e) { return { __error: e.message } } }
    return v
  }))
  const fn = new AsyncFunction('args', 'agent', 'parallel', 'pipeline', 'log', 'phase', 'budget', src)
  let result, error
  try { result = await fn(args, agent, parallel, pipeline, () => {}, () => {}, { total: null }) } catch (e) { error = e.message }
  return { result, error, calls }
}
