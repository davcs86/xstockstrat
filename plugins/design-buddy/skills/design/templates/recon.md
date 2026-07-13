# design-buddy — recon.md template

Write the recon dossier using this exact structure. Every `path:line` must come from a
`repo-scout` or `area-discovery` digest — never invent (**DF-1**). Keep it tight and
evidence-cited: it is a dossier, not a copy of the source.

```markdown
# Recon: <slug>

**Created**: <ISO date>
**Change**: <one-line restatement of the requested change>
**Depth**: <quick|full|deep>
**Affected areas**: <list derived from the change + repo profile>

---

## Repo Profile

<3–5 lines from the repo-scout digest: what this repo is, primary languages, layout style,
test/lint harness (commands + where CI declares them), or "not found" for any of these.>

## Codebase Map

For each affected area:
- **`<area/package/dir>`** (<language>)
  - Entry point / main module: `path:line`
  - Key symbols relevant to the change: `<symbol>` — `path:line`
  - Existing analogous feature (the closest thing to what we're changing): `path:line`
  - Tests covering this area: `path` | not found

## Patterns to REUSE

<The anti-duplication core (DN-2). For each thing the change needs, name the existing
pattern/helper/type to reuse.>
- `<what the change needs>` → reuse `<existing pattern/helper/type>` at `path:line`
- ...

## Host Conventions & Hard Rules

<From the repo-scout digest. Hard rules are floor-equivalent (DF-6) — quote them verbatim.>
- Convention: <what it governs> — `path`
- **Hard rule**: "<verbatim quote>" — `path:line`
- (or "none found — repo states no explicit conventions")

## Dependencies

- Data / schema: <tables, migrations, persisted formats touched> | none
- External contracts: <public APIs, RPC/message schemas, wire formats> | none
- Config / environment: <keys, env vars, feature flags> | none
- Cross-area edges: <caller → callee dependencies this change crosses> | none

## Risks / Not-found

- <every `## Not found` item from the digests — carried forward, never guessed (DF-1)>
- <design unknowns; applicable ledger traps if a ledger.md exists>

## Recommended Scope

<Advisory proposed boundaries for the change — input to the debate and the plan skill;
not binding.>
```
