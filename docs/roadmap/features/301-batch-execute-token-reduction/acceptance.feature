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
    And sdd-batch-checker's tools list is exactly "Bash, Read, Glob, Grep, mcp__github__list_pull_requests"
    And sdd-batch-writer's tools list is exactly "Bash, Read, Edit, Write, Glob, Grep"

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
    And the first index of "status.md" in it is lower than the first index of "sdd-batch-setup"

  @AC-18 @FR-5 @prompt-contract
  Scenario: The setup prompt makes every item idempotent and pushed before the next
    Given a matching upfront record approval for feature "fix-a"
    When the "setup:fix-a" prompt is rendered
    Then it contains "Skip if" for the merge, the re-spec, the feature.md row and the context.md entry
    And each of numbered items 2, 3, 4, 5 and 6 contains "push"
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
    And the checker calls mcp__github__list_pull_requests without a ToolSearch call
    And the writer's commit runs the husky pre-commit hook
    And CONTEXT_MAX is set from the measured context.md sizes of features 282, 289 and 294
    And "( printf x; exit 3 ) >f 2>&1; echo exit=$?" prints "exit=3" and "wc -c <f | tr -d ' '" prints "1" under macOS bash 3.2

  @AC-20 @FR-9 @manual-spike
  Scenario: The spike falls back to preflight-only scoping when composition fails
    Given the spike shows agentType is ignored when isolation is 'worktree'
    When PR-1 is specified
    Then only the "preflight:" agent call carries agentType "sdd-batch-checker"
    And the "validate:", "setup:" and "step:" agent calls keep the default type

  @AC-21 @FR-4
  Scenario: An unreadable context.md size also halts at distill
    Given feature "fix-a" with pending steps whose preflight reports contextBytes "unknown"
    When /sdd-batch-execute runs it with no approvals
    Then the run halts with gate "distill"
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
