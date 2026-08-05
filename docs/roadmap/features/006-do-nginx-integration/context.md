# Context: do-nginx-integration  (archived 2026-08-05)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-05 — /sdd-archiver

**What**: Wired the nginx reverse proxy (built by feature 005) into DO App Platform by adding an `xstockstrat-nginx` service on port 80 in both `.do/app.yaml`/`.do/app.dev.yaml` and stripping `http_port` from the three frontends. Required a mid-execute scope expansion beyond the original single-file step because feature 005's actual shipped Dockerfile didn't match what this feature's spec assumed. (Note: nginx was later removed entirely by feature 045 `ui-consolidation-nextjs` — this whole proxy layer was a transitional architecture, not a lasting one; see `docs/patterns/nginx-routing.md`, deprecated.)
**Why (irrecoverable rationale)**: DO App Platform has no container-name DNS like docker-compose — inter-service addressing only works via `${service.PRIVATE_URL}` env vars injected at deploy time, so nginx's upstream hostnames had to become a runtime-templated value (via `envsubst`) rather than a build-time constant (context.md Session 2026-05-12 sdd-spec, product-spec Open Questions).
**Rejected alternatives**: none recorded — no alternative approaches were debated in context.md (feature predates `/sdd-design`; only sdd-story/review/spec/execute sessions exist).
**Scars & gotchas**:
- Bare `envsubst < template > conf` clobbers nginx's own `$host`/`$remote_addr`/`$scheme` runtime variables (rendered empty), silently breaking the config; must scope to `envsubst '$TRADER_UPSTREAM $INSIGHTS_UPSTREAM $CONFIG_UI_UPSTREAM'` (implementation-spec.md:378-381 Deviation Log).
- `nginx:1.27-alpine` has no `envsubst` — it's in the `gettext` package, not the base image (implementation-spec.md:383-386).
- Host's installed `yq` is the Python jq-wrapper, not mikefarah's `yq eval` syntax the spec assumed; verification had to fall back to `python3 -c "import yaml; ..."` in both Step 1 and Step 2 (context.md Session 2026-05-18 00:00 and 00:01).
**Permanent deviations**: - spec said Step 3 creates only `docker-entrypoint.sh` (assuming feature 005 already wired `ENTRYPOINT` into its Dockerfile) → shipped also rewrote `nginx.conf` (template vars), `services/xstockstrat-nginx/Dockerfile` (ENTRYPOINT + gettext install), and `docker-compose.yml` (PRIVATE_URL envs for local parity) → because feature 005 had actually committed a minimal Dockerfile with `CMD`, not `ENTRYPOINT`, so the entrypoint script would otherwise never run (implementation-spec.md:373-376, context.md Session 2026-05-18 00:02, "Option A scope expansion" — user-approved).
**Cross-feature signal**: An implementation spec written against another in-flight feature's *not-yet-merged* branch artifacts (005) diverged from what actually landed by execute time — the impl-spec's Codebase Evidence cited 005's implementation-spec text, not the real committed Dockerfile. Future specs depending on a sibling feature's in-progress branch should re-verify the actual file state at execute time, not just the sibling's spec claims.
**Deferred follow-ons**: none — the whole nginx layer this feature completed was later replaced (feature 045), mooting further nginx follow-up.
**Ledger entries written**: insights.md (1), fails.md (2) — see the 2026-08-05 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none — this pattern (`nginx.conf` + `docker-entrypoint.sh` + PRIVATE_URL envsubst) is entirely superseded/deleted by feature 045; not a live PLAT-* invariant.
**Pruned artifacts**: product-spec.md, implementation-spec.md — last present at 33ff5dc.
