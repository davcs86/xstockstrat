# design-buddy plan — per-area discovery checklist

This is the discovery recipe for **one affected area** of the host repository. Hand it to an
`area-discovery` subagent (one per area, in parallel), together with the area path, the Repo
Profile excerpt for that area, and the change-specific find list. Every item the agent reports
must carry a `path:line` citation — that is what satisfies the zero-assumption rule (**DF-1**).

Skip any item the recon dossier already covers — only discover below the dossier's altitude or
where the dossier reported `## Not found`.

## Base survey (every affected area)

a. Read the area's own README / CLAUDE.md / docs page if one exists — orient before grepping.
b. Inventory the area's real files (Glob) — enough to know its shape, not an exhaustive listing.
c. Locate the entry point / main module. Per-ecosystem starting hints (verify — never assume):
   - Go: `main.go`, `cmd/*/main.go`; exported types in the package root.
   - Python: `__main__.py`, `main.py`, `app.py`, `src/<pkg>/__init__.py`; `pyproject.toml`
     `[project.scripts]`.
   - Node/TS: `package.json` `"main"`/`"exports"`/`"scripts"`, `src/index.{ts,js}`.
   - JVM: `src/main/java|kotlin/**` application/controller classes; `build.gradle*`/`pom.xml`.
   - Rust: `src/main.rs` / `src/lib.rs`; `Cargo.toml` `[[bin]]`.
   - Other: follow the manifest and the Repo Profile; report what is actually there.
d. Find the **closest existing analogue** to what the change will build — the nearest handler,
   command, component, job, or module of the same kind. This is the caller's primary reuse
   target (**DN-2**) and pattern to match.
e. Grep the specific symbols/keywords from the change description; report `path:line` per hit.
f. Locate how the area reads configuration / environment (config files, env access, flag
   parsing) if the change touches config.
g. Locate schema/persistence artifacts (migrations, model/entity definitions, schema files) if
   the change touches data. Report the last migration identifier if a numbered chain exists.
h. Locate the tests covering this area and note the pattern they follow (fixtures, naming,
   directory layout).

## Domain hotspot survey (guarded)

Only when the change description contains domain nouns (e.g. "order", "invoice", "session",
"webhook"): grep those nouns across the area and report where the domain concept currently
lives — types, state transitions, validation. No match → report "**not found** — concept not yet
present in this area".

## Contract survey (guarded)

Only when the change touches a public/external contract (HTTP API, RPC/message schema, CLI
surface, published types): locate the contract definition and its consumers within the repo, and
report identifiers that must not be reused or broken (field numbers, route paths, exported
names) with citations.
