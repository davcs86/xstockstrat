Feature: batch-execute-token-reduction
  As the SDD operator running /sdd-batch-execute, I want its subagents to load only what each
  stage needs and to skip work whose result I already approved, so that a batch costs a fraction
  of today's tokens with no SDD gate weakened.

  # Sha literals used below (40-hex git SHA-1 object names):
  #   MD  = aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  (origin/main-dev)
  #   DV  = bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb  (origin/feature/<slug>)
  #   SH  = cccccccccccccccccccccccccccccccccccccccc  (implementation-spec.md blob)
  #   MD2 = dddddddddddddddddddddddddddddddddddddddd  (a different, older main-dev)

  @AC-1 @FR-1
  Scenario: Each stage runs on its scoped agent type
    Given feature "fix-a" whose status is in-progress, whose last sdd-batch-setup fence has mainDev "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", with approval {gate:'checkpoint:2', decision:'proceed'}
    When /sdd-batch-execute runs it to the integration PR
    Then the "preflight:fix-a" agent call has agentType "sdd-batch-checker"
    And every "step:fix-a:" agent call has agentType "sdd-batch-writer"
    And the "integration-pr:fix-a" agent call has no agentType

  @AC-2 @FR-1
  Scenario: The scoped agents are pinned and fenced to the workflow
    Given the files .claude/agents/sdd-batch-writer.md and .claude/agents/sdd-batch-checker.md
    When their frontmatter and bodies are read
    Then both declare "model: opus"
    And both bodies contain "spawned only by .claude/workflows/sdd-batch-execute.js; never delegate from a skill session"
    And sdd-batch-checker's tools list is exactly "Bash, Read, Glob, Grep, ToolSearch, mcp__github__list_pull_requests"
    And sdd-batch-writer's tools list is exactly "Bash, Read, Edit, Write, Glob, Grep"
    And both descriptions contain "Workflow-internal" and "Never select via Task"

  @AC-3 @FR-2
  Scenario: A fresh run validates and halts with a record, writing nothing
    Given an implementation-ready feature "fix-a" with pending steps 1, 2, 3 and no approvals
    And preflight reports mainDevSha "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", devSha "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", specHash "cccccccccccccccccccccccccccccccccccccccc"
    When /sdd-batch-execute runs it
    Then exactly 1 "validate:fix-a" agent call is made
    And the run halts with gate "upfront" and record {mainDev:"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", dev:"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", specHash:"cccccccccccccccccccccccccccccccccccccccc", directive:"conditional", pending:[1,2,3], mismatches:<validate's mismatches>}
    And 0 "setup:", "step:" or "write-plan:" agent calls are made

  @AC-4 @FR-2
  Scenario: A matching upfront record skips the second validate
    Given feature "fix-a" whose preflight reports mainDevSha "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", devSha "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", specHash "cccccccccccccccccccccccccccccccccccccccc" and pending steps 1, 2, 3
    And approval {gate:'upfront', decision:'proceed', record:{mainDev:"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", dev:"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", specHash:"cccccccccccccccccccccccccccccccccccccccc", directive:"conditional", pending:[1,2,3], mismatches:[{n:2, detail:"D"}]}}
    When /sdd-batch-execute runs it
    Then 0 "validate:fix-a" agent calls are made
    And exactly 1 "setup:fix-a" agent call is made and its prompt contains [{"n":2,"detail":"D"}]

  @AC-5 @FR-2
  Scenario: An upfront approval with a stale record re-halts instead of writing
    Given feature "fix-a" whose preflight reports mainDevSha "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    And approval {gate:'upfront', decision:'proceed'} carrying a record whose mainDev is "dddddddddddddddddddddddddddddddddddddddd"
    When /sdd-batch-execute runs it
    Then exactly 1 "validate:fix-a" agent call is made
    And the run halts with gate "upfront" and a new record whose mainDev is "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    And 0 "setup:fix-a" agent calls are made

  @AC-6 @FR-2
  Scenario: An upfront approval with no record at all re-halts
    Given an implementation-ready feature "fix-a"
    And approval {gate:'upfront', decision:'proceed'} with no record
    When /sdd-batch-execute runs it
    Then exactly 1 "validate:fix-a" agent call is made
    And the run halts with gate "upfront" and a record
    And 0 "setup:fix-a" agent calls are made

  @AC-7 @FR-3
  Scenario: A blocker approval without workflow setup goes through the Gate
    Given an implementation-ready feature "fix-a" with no sdd-batch-setup fence
    And approval {gate:'blocker:1', decision:'Option A'}
    When /sdd-batch-execute runs it
    Then exactly 1 "validate:fix-a" agent call is made
    And the run halts with gate "upfront"
    And 0 "step:fix-a" agent calls are made

  @AC-8 @FR-3
  Scenario: A manually started in-progress feature is not offered resume
    Given feature "fix-a" whose status is in-progress and whose context.md has no sdd-batch-setup fence
    And no approvals
    When /sdd-batch-execute runs it
    Then exactly 1 "validate:fix-a" agent call is made
    And the run halts with gate "upfront", not "resume"

  @AC-9 @FR-3
  Scenario: A workflow-set-up feature halts at resume, then resumes on approval
    Given feature "fix-a" whose status is in-progress and whose last sdd-batch-setup fence has mainDev "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    When /sdd-batch-execute runs it with no approvals
    Then the run halts with gate "resume" and 0 "validate:" or "setup:" agent calls
    When /sdd-batch-execute runs it with approval {gate:'resume', decision:'proceed'}
    Then 0 "validate:" or "setup:" agent calls are made
    And at least 1 "step:fix-a" agent call is made

  @AC-10 @FR-4
  Scenario: An oversized context.md halts at distill until approved
    Given feature "fix-a" with pending steps whose context.md on the dev branch is 70000 bytes
    When /sdd-batch-execute runs it with no approvals
    Then the run halts with gate "distill" and limit 65536
    And 0 "validate:" agent calls are made
    When /sdd-batch-execute runs it with approval {gate:'distill', decision:'proceed'}
    Then the run proceeds to the "upfront" halt

  @AC-11 @FR-5
  Scenario: Setup that did not complete blocks the step loop
    Given a matching upfront record approval for feature "fix-a"
    And the setup agent returns {commits:[], notes:["resolver exit 64"], tooling_blockers:[], stale:false, completed:false}
    When /sdd-batch-execute runs it
    Then the run is blocked with a message matching "setup incomplete"
    And 0 "step:fix-a" agent calls are made

  @AC-12 @FR-5
  Scenario: Setup that finds main-dev moved blocks with no commits
    Given a matching upfront record approval for feature "fix-a"
    And the setup agent returns {commits:[], notes:[], tooling_blockers:[], stale:true, completed:false}
    When /sdd-batch-execute runs it
    Then the run is blocked with a message matching "start a NEW run"
    And 0 "step:fix-a" agent calls are made

  @AC-13 @FR-5 @prompt-contract
  Scenario: The setup prompt pins shas, guards the merge, and writes the fence last
    Given a matching upfront record approval for feature "fix-a" with mainDev "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    When the "setup:fix-a" prompt is rendered
    Then it contains "merge-train-resolve.mjs --base aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "ledger-guard.py", "--amend" and "Approved-record:"
    And it contains "git log --first-parent" and "origin/main-dev..HEAD"
    And in the text after its first "Operator approved the up-front plan", the first index of "status.md" is lower than the first index of "sdd-batch-setup"

  @AC-18 @FR-5 @prompt-contract
  Scenario: The setup prompt makes every item idempotent and pushed before the next
    Given a matching upfront record approval for feature "fix-a"
    When the "setup:fix-a" prompt is rendered
    Then it contains "Skip if" for the merge, the re-spec, the feature.md row and the context.md entry
    And in the text after its first "Operator approved the up-front plan", each of the column-0 numbered items 2, 3, 4, 5 and 6 contains "push"
    And it contains "completed"

  @AC-14 @FR-6 @prompt-contract
  Scenario: The step prompt scopes its reads by heading and keeps the full context.md read
    Given an in-progress feature with a pending step 3
    When the "step:<slug>:s3" prompt is rendered
    Then it contains "## PER-STEP EXECUTION", "## HARD CONSTRAINTS", "## Deviation Log", "sequential-mode.md", "§5.5", "tooling-setup.md", "repo-conventions.md" and "context.md IN FULL"

  @AC-15 @FR-7 @prompt-contract
  Scenario: The step prompt runs Verification verbatim and judges as PHASE 3
    Given an in-progress feature with a pending step 3
    When the "step:<slug>:s3" prompt is rendered
    Then it contains ') >"', '2>&1; echo "exit=$?"', "tail -n 60" and "no `set -o pipefail`"
    And it contains "no `exit=` line" and "FAILED"
    And it contains "Read the FULL log" and "red N/A — no behavior change; characterization test added"

  @AC-19 @FR-7
  Scenario: The skill's report-the-output rule matches log-based verification
    Given the change is applied
    When step 3 of `### PHASE 3: Execution` in .claude/skills/sdd-execute/SKILL.md (today line 301) is read
    Then it contains "Report the cited output lines, the `exit=` line and the log path (full log on request)"
    And it no longer contains "Report the exact output"

  @AC-16 @FR-8
  Scenario: The contract docs describe the new gates and the registry lists the agents
    Given the change is applied
    When docs/patterns/context-engineering.md §4 is read
    Then it contains "record", "{gate:'resume'", "{gate:'distill'", "sdd-batch-setup" and "not resumeFromRunId"
    And the `/sdd-batch-execute` row's `Stops at` cell names "resume", "distill" and the upfront re-halt
    And §4 names the "sdd-batch-writer" and "sdd-batch-checker" roles
    And .claude/context-map.yaml lists "sdd-batch-writer" and "sdd-batch-checker"
    And the `## HARD CONSTRAINTS` section of SKILL.md is byte-identical to origin/main-dev's
    And `./scripts/check-context-map.sh` and `node --test scripts/workflow-tests/*.test.mjs` both exit 0

  @AC-17 @FR-9 @manual-spike
  Scenario: The spike proves scoped agents before any merge
    Given a throwaway branch running one "sdd-batch-checker" preflight and one "sdd-batch-writer" step in a worktree
    When their transcripts are measured
    Then the first-turn input of each is at most 30000 tokens
    And the checker calls mcp__github__list_pull_requests and the transcript records whether a ToolSearch select preceded it
    And the writer's commit in a linked worktree, after the setup hook-liveness remedy, runs the husky pre-commit hook through the symlinked .husky/_ with core.hooksPath ".husky/_"
    And the hook's wall time and output bytes are recorded per commit, including one commit staging a services/xstockstrat-ui/ path and one setup merge commit whose merge brings in services/xstockstrat-ui/ files
    And CONTEXT_MAX is set from the measured context.md sizes of features 282, 289 and 294
    And "( printf x; exit 3 ) >f 2>&1; echo exit=$?" prints "exit=3" and "wc -c <f | tr -d ' '" prints "1" under macOS bash 3.2

  @AC-20 @FR-9 @manual-spike
  Scenario: The spike falls back to preflight-only scoping when composition fails
    Given the spike shows agentType is ignored when isolation is 'worktree'
    When PR-1 is specified
    Then only the "preflight:" agent call carries agentType "sdd-batch-checker"
    And the "validate:", "setup:" and "step:" agent calls keep the default type

  @AC-21 @FR-4
  Scenario: An unreadable context.md size blocks the run
    Given feature "fix-a" with pending steps whose preflight reports contextBytes "unknown"
    When /sdd-batch-execute runs it with no approvals
    Then the run is blocked with a message matching "context.md size unreadable"
    And no gate is halted
    And 0 "validate:" agent calls are made

  @AC-22 @FR-3
  Scenario: A checkpoint approval on a workflow-set-up feature skips the Gate
    Given feature "fix-a" whose status is in-progress and whose last sdd-batch-setup fence has mainDev "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    And approval {gate:'checkpoint:2', decision:'proceed'}
    When /sdd-batch-execute runs it
    Then 0 "validate:" or "setup:" agent calls are made
    And the first "step:fix-a" agent call is for the step after 2

  @AC-23 @FR-7 @prompt-contract
  Scenario: Each verification run gets its own log outside the worktree
    Given an in-progress feature with a pending code-bearing step 3
    When the "step:<slug>:s3" prompt is rendered
    Then it contains "NEW log" for each of the RED run, the GREEN run and every re-run
    And it contains "mktemp" and "git rev-parse --git-dir" as the log location, never a path inside the worktree
    And it contains "Cite ONLY lines from this run's log"

  @AC-24 @FR-5
  Scenario: An inert pre-commit hook blocks setup as a tooling problem
    Given a matching upfront record approval for feature "fix-a"
    And the setup agent returns {commits:[], notes:[], tooling_blockers:["pre-commit hook inert: hook-fail=hooksPath"], stale:false, completed:false}
    When /sdd-batch-execute runs it
    Then the run is blocked with a message matching "tooling: pre-commit hook inert"
    And 0 "step:fix-a" agent calls are made

  @AC-25 @FR-5 @prompt-contract
  Scenario: The setup prompt checks hook liveness and repairs it in the main worktree before merging
    Given a matching upfront record approval for feature "fix-a"
    When the "setup:fix-a" prompt is rendered
    Then it contains "core.hooksPath", "git worktree list --porcelain", "pnpm exec husky", "pnpm install --frozen-lockfile", "sdd-husky.lock" and "pre-commit hook inert"
    And in the text after its first "1. Tooling + hook liveness", the first index of "pre-commit hook inert" is lower than the first index of "merge-train-resolve.mjs"

  @AC-26 @FR-5 @prompt-contract
  Scenario: Every writer prompt links the hook, re-checks it, and keys its remedy on the failing clause
    Given an in-progress feature with a pending step 3
    When the "step:<slug>:s3" prompt is rendered
    Then it contains "services/*/node_modules", ".husky/_", "core.hooksPath", "SDD_MSG_EOF" and "pre-commit hook inert"
    And it contains "hook-fail=", "provision pnpm 9.15.9" and "re-send the resume approval"
    And it contains "info/exclude", "grep -qxF", "/services/*/node_modules" and "/.husky/_"
    And it contains "! git diff --quiet"
    And it does not contain "pnpm install --frozen-lockfile" or "pnpm exec husky"

  @AC-27 @FR-8
  Scenario: Distillation keeps every workflow fence verbatim without pinning its session
    Given the change is applied
    When .claude/agents/context-distiller.md and .claude/skills/sdd-distill/SKILL.md are read
    Then both contain "sdd-batch-" and "byte-for-byte" and "in original order"
    And context-distiller.md contains "Never mark a whole session keep-verbatim only because it holds a fence"

  @AC-28 @FR-5
  Scenario: An unresolvable merge conflict during setup blocks with no step calls
    Given a matching upfront record approval for feature "fix-a"
    And the setup agent returns {commits:[], notes:["unresolvable: docs/x.md: off-allowlist — merge origin/main-dev into feature/fix-a by hand resolving docs/x.md, push, start a NEW run"], tooling_blockers:[], stale:false, completed:false}
    When /sdd-batch-execute runs it
    Then the run is blocked with a message matching "unresolvable"
    And no gate is halted
    And 0 "step:fix-a" agent calls are made

  @AC-29 @FR-3
  Scenario: A setup that re-spec'd ends the run at resume
    Given approval {gate:'upfront', decision:'proceed', record:{mainDev:"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", dev:"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", specHash:"cccccccccccccccccccccccccccccccccccccccc", directive:"conditional", pending:[1,2,3], mismatches:[{n:2, detail:"D"}]}} for feature "fix-a" whose preflight reports those shas and pending steps 1, 2, 3
    And the setup agent returns completed:true
    When /sdd-batch-execute runs it
    Then the run halts with gate "resume"
    And 0 "step:fix-a" agent calls are made

  @AC-30 @FR-2
  Scenario: Directive none with mismatches blocks before setup
    Given feature "fix-a" with directive "none" and a matching upfront record approval whose mismatches are [{n:2, detail:"D"}]
    When /sdd-batch-execute runs it
    Then the run is blocked with a message matching "directive none: steps 2 mismatch"
    And 0 "setup:fix-a" agent calls are made

  @AC-31 @FR-2
  Scenario: A non-hex preflight sha blocks before validation
    Given feature "fix-a" whose preflight reports mainDevSha "origin/main-dev"
    When /sdd-batch-execute runs it
    Then the run is blocked with a message matching "non-hex sha"
    And 0 "validate:" agent calls are made

  @AC-32 @FR-6 @prompt-contract
  Scenario: The step prompt treats discovery as advisory and replaces AskUserQuestion with a blocker
    Given an in-progress feature with a pending step 3
    When the "step:<slug>:s3" prompt is rendered
    Then it contains "the discovery digest is advisory", "re-verify every not-found claim" and "A confirmed miss is a blocker (F-04)"
    And it contains "Wherever the loaded skill text says AskUserQuestion, return result:'blocker'"
    And it contains "§5.7" and "carve-outs"
    And the "discover:<slug>:s3" prompt does not contain "Tree:"

  @AC-33 @FR-7 @prompt-contract
  Scenario: The config-key wiring gate runs log-based at step time and at --final
    Given an in-progress feature with a pending step 3
    When the "step:<slug>:s3" prompt is rendered
    Then it contains "check-config-wiring.mjs", "--final" and "keeps the step not-done"

  @AC-34 @FR-1 @prompt-contract
  Scenario: Preflight falls back to ToolSearch, retries once, and names an unavailable lookup
    Given an implementation-ready feature "fix-a"
    When the "preflight:fix-a" prompt is rendered
    Then it contains "mcp__github__list_pull_requests", "ToolSearch", "retry once" and "PR lookup unavailable"
    And it contains "git cat-file -s" and "docs/roadmap/features/"

  @AC-35 @FR-3
  Scenario: A resume in a container with an inert hook runs hook-setup first
    Given feature "fix-a" whose status is in-progress, whose last sdd-batch-setup fence has mainDev "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", and whose preflight reports hookLive false
    And approval {gate:'resume', decision:'proceed'}
    When /sdd-batch-execute runs it
    Then exactly 1 "hook-setup:fix-a" agent call is made, with agentType "sdd-batch-writer" and isolation "worktree", before the first "step:fix-a" call
    And 0 "validate:" or "setup:" agent calls are made

  @AC-36 @FR-3
  Scenario: A hook-setup that cannot make the hook live blocks
    Given the AC-35 feature and approval
    And the hook-setup agent returns {hookLive:false, tooling_blockers:["pre-commit hook inert: hook-fail=hooksPath"], notes:[]}
    When /sdd-batch-execute runs it
    Then the run is blocked with a message matching "pre-commit hook inert"
    And 0 "step:fix-a" agent calls are made

  @AC-37 @FR-3
  Scenario: hook-setup runs only when the run will commit without setup
    Given feature "fix-a" with a matching upfront record approval and preflight hookLive false
    When /sdd-batch-execute runs it
    Then 0 "hook-setup:" agent calls are made and exactly 1 "setup:fix-a" call is made
    When feature "fix-a" resumes with approval {gate:'resume', decision:'proceed'} and preflight hookLive true
    Then 0 "hook-setup:" agent calls are made
    When feature "fix-a" resumes with approval {gate:'checkpoint:2', decision:'stop here'} and preflight hookLive false
    Then 0 "hook-setup:" agent calls are made
    When feature "fix-a" has all steps done, mergeOrderBlock "230 first", no merge-order approval and preflight hookLive false
    Then the run halts with gate "merge-order" and 0 "hook-setup:" agent calls are made

  @AC-38 @FR-5 @prompt-contract
  Scenario: One shared hook check, and a crash-safe install lock checked before any remedy
    Given a matching upfront record approval for feature "fix-a" for the "setup:fix-a", "preflight:fix-a" and "step:fix-a:s1" prompts
    And, separately, the AC-35 resume fixture (status in-progress, sdd-batch-setup fence mainDev "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", approval {gate:'resume', decision:'proceed'}, preflight hookLive false) for the "hook-setup:fix-a" prompt
    When the "setup:fix-a" prompt, a "hook-setup:fix-a" prompt, the "preflight:fix-a" prompt and a "step:fix-a:s1" prompt are rendered
    Then all four contain '{ [ "${HUSKY-}" != 0 ] || { echo hook-fail=HUSKY; false; }; }', "hook-fail=pnpm", "hook-fail=hooksPath", "hook-fail=h;" and "hook-fail=pre-commit"
    And the preflight prompt contains '(cd "$M" && { [ "${HUSKY-}" != 0 ]'
    And the setup and hook-setup prompts both contain "pnpm exec husky", "pnpm install --frozen-lockfile", "sdd-husky.lock", "trap 'rmdir", "-mmin +30", "2 polls", "run_in_background", ".exit" and "rmdir <L>"
    And in each of those two prompts the first index of "sdd-husky.lock" is lower than the first index of "pnpm exec husky"
    And the "hook-setup:fix-a" prompt contains "no commits", "ignore git-protocol item 6" and "skip item 1's DETECTION sentence"

  @AC-39 @FR-5 @prompt-contract
  Scenario: Every writer commit captures hook output in a git-dir log
    Given any writer prompt (setup, hook-setup, step, write-plan, integration-pr)
    When it is rendered
    Then it contains "git commit -F - >\"$CLOG\" 2>&1 <<'SDD_MSG_EOF'", 'echo "exit=$?"; tail -n 20 "$CLOG"' and "git rev-parse --git-dir"
    And one of its lines is exactly "SDD_MSG_EOF"
    And it contains "Never use --no-verify"

  @AC-40 @FR-2
  Scenario: A record whose pending list is re-ordered still matches
    Given the AC-4 preflight with pending steps 1, 2, 3
    And approval {gate:'upfront', decision:'proceed', record:{mainDev:"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", dev:"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", specHash:"cccccccccccccccccccccccccccccccccccccccc", directive:"conditional", pending:[3,1,2], mismatches:[]}}
    When /sdd-batch-execute runs it
    Then 0 "validate:fix-a" agent calls are made and exactly 1 "setup:fix-a" call is made
    And a fresh upfront halt's record.pending is [1,2,3] when steps are reported in the order 3, 1, 2

  @AC-41 @FR-5 @prompt-contract
  Scenario: The ledger-guard repair is amended only when it touched the ledger alone
    Given a matching upfront record approval for feature "fix-a"
    When the "setup:fix-a" prompt is rendered
    Then in the text after its first "ledger-guard.py", it contains "git add -- docs/roadmap/ledger/"
    And in that text the first index of "git diff --quiet" is lower than the first index of "--amend"
    And in that text it contains "! git diff --cached --quiet" and "nothing to amend"

  @AC-42 @FR-7 @prompt-contract
  Scenario: Background verification runs echo the log path first and poll a sentinel
    Given an in-progress feature with a pending code-bearing step 3
    When the "step:<slug>:s3" prompt is rendered
    Then it contains 'echo "log=$LOG"', "run_in_background", "<LOG>.exit", "exit=PENDING" and "540"
    And it contains "lives only until this worktree is removed"

  @AC-43 @FR-10
  Scenario: A write-plan that made no commit blocks instead of halting at promotion
    Given feature "fix-a" with all steps done and no promotion approval
    And the write-plan agent returns {commits:[], notes:["pre-commit hook inert (hook-fail=hooksPath)"]}
    When /sdd-batch-execute runs it
    Then the run is blocked with a message matching "write-plan made no commit"
    And no gate is halted
    When the write-plan agent returns nothing
    Then the run is blocked with a message matching "write-plan made no commit: writer died"

  @AC-44 @FR-10
  Scenario: An integration PR writer that opened no PR blocks instead of reporting done
    Given feature "fix-a" with all steps done, a recorded promotion plan and approval {gate:'promotion', decision:'proceed'}
    And the integration-pr agent returns {url:"", commits:[], notes:["pre-commit hook inert (hook-fail=h)"]}
    When /sdd-batch-execute runs it
    Then the run is blocked with a message matching "integration-pr incomplete: pre-commit hook inert"
    And the stage is not "done"
    When the integration-pr agent returns {url:"", commits:[], notes:[]}
    Then the run is blocked with a message matching "integration-pr incomplete: no PR url"
    When the integration-pr agent returns {url:"https://github.com/o/r/pull/1", commits:[], notes:["plan already applied at the dev-branch tip"]}
    Then the stage is "done" and prUrl is "https://github.com/o/r/pull/1"
    And the "integration-pr:fix-a" prompt contains "Open the PR only if the promotion commit is pushed now"
