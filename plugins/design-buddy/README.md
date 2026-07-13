# Design Buddy

A repo-agnostic Claude Code plugin that turns Claude into a **design partner** for any source-code
change — bug fix through large rearchitecture or migration — and then into an **implementation
planner** whose every step is grounded in evidence from the target codebase.

It is a portable export of a spec-driven-development methodology: a read-only recon pass builds a
grounded dossier of the repo, a **mediated proposer-vs-adversary debate** pressure-tests one
design (recording the rejected alternatives), and a zero-assumption planning pass turns the
approved design into numbered, verifiable, statused steps a future session can execute.

## Install

```
/plugin marketplace add davcs86/xstockstrat
/plugin install design-buddy@xstockstrat
```

## Skills

| Skill | What it does |
|---|---|
| `/design-buddy:design <change description or issue ref> [quick\|full\|deep]` | Recon (repo scout + parallel area discovery → `recon.md`) then a depth-scaled adversarial debate → `design.md` with the chosen approach, rejected alternatives, and open risks. |
| `/design-buddy:plan <design.md path \| slug \| change description>` | Consumes the design doc (or warns and discovers from scratch) and writes `plan.md`: numbered steps, each with Files / Evidence / Instructions / Verification / Test, executable step-by-step by a later session. |

### Debate depths

| Depth | For | Rounds (mandated / cap) | Round 1 |
|---|---|---|---|
| `quick` | bug fixes, small localized changes | 1 / 3 | single proposer |
| `full` | typical features, multi-module changes | 2 / 5 | single proposer |
| `deep` | rearchitectures, migrations, framework swaps | 2 / 6 | a **panel** of 2–3 proposers with assigned angles (minimal-delta, target-state, operational-safety), judged and merged before the adversary attacks |

If you omit the depth, the skill recommends one from the change's blast radius, reversibility,
and novelty, and asks you to confirm. At every depth, approval is gated: you approve the design
explicitly, and an unresolved **floor breach** (a `DF-*` principle or a hard rule your own repo
states about itself) blocks approval outright.

## Subagents

Four read-only agents do the heavy lifting so the orchestrating session stays lean:
`repo-scout` (once-per-run repo orientation), `area-discovery` (per-area evidence digests),
`proposer` (one cited design per round), and `adversary` (attacks it, citing rules by ID).
Proposer and adversary never see each other's raw output — the skill mediates every round.

## First run & configuration

On first use in a repo, the skill asks where to store artifacts and writes
`.claude/design-buddy.json`:

```json
{ "version": 1, "artifactsDir": "docs/design", "ledger": true, "created": "2026-07-13" }
```

- Each change gets `<artifactsDir>/<date>-<slug>/` containing `recon.md`, `design.md`, `plan.md`.
- `"artifactsDir": null` = scratch mode — no files at all; artifacts are emitted inline in chat.
- `"ledger": true` seeds an append-only `<artifactsDir>/ledger.md` of one-line lessons that
  future runs feed to the adversary.

The config file is committable, so a team shares one setting; gitignore it if you prefer.

## Governance

`skills/*/reference/principles.md` ships the portable rule seed the adversary cites: **Floor
rules** `DF-1..6` (never invent paths/symbols; no silent deviation; single orchestrator writes;
mediated debate; floor blocks approval; host hard rules are floor-equivalent) and **Norms**
`DN-1..5` (evidence-cited claims; reuse over rebuild; recorded gates; depth scales with the
change; plan steps immutable during execution). Your repo's own absolute rules — "never …",
"must not …" in CLAUDE.md/CONTRIBUTING/docs — are discovered during recon, quoted verbatim, and
enforced like floor rules.

## Development

**Script policy: Python only.** Any executable shipped in this plugin is Python 3, stdlib-only,
invoked as `python3 <script>.py` — never Bash (shell scripts are not portable across the
infrastructures host repos run on). The plugin currently ships exactly one script:

```
python3 plugins/design-buddy/scripts/validate.py              # validate the plugin tree
python3 plugins/design-buddy/scripts/validate.py --self-test  # run its negative-fixture tests
```

`validate.py` checks the manifests parse and carry required fields, every skill/agent has
frontmatter, every `reference/`/`templates/` path named in a SKILL.md resolves, and no
host-repo-specific strings leak into the plugin.
