#!/bin/bash
set -euo pipefail

cat << 'EOF'
╔══════════════════════════════════════════════════════════════════════╗
║              SDD (Spec-Driven Development) Skills                   ║
╠══════════════════════════════════════════════════════════════════════╣
║  /sdd-story   <slug> [story]   Phase 1 — product spec from story    ║
║  /sdd-review  <slug> [type]    Gate: draft→spec-ready (or advisory) ║
║  /sdd-spec    <slug>           Phase 2 — impl spec w/ code refs      ║
║  /sdd-execute <slug> [step]    Phase 3 — execute steps (next|all)   ║
║  /sdd-status  [slug]           Show lifecycle & step progress        ║
║  /sdd-triage  <issue#>         Triage bug → Track A/B/C             ║
║  /sdd-sync    [slug]           Sync spec files → main-dev PR         ║
║  /promote                      main-dev → main production PR         ║
╠══════════════════════════════════════════════════════════════════════╣
║  Workflow: /sdd-story → /sdd-review product-spec →                  ║
║            /sdd-spec  → /sdd-review impl-spec   →                   ║
║            /sdd-execute (loop)                                       ║
╚══════════════════════════════════════════════════════════════════════╝
EOF
