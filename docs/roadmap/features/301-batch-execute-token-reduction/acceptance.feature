Feature: batch-execute-token-reduction
  As the SDD operator running /sdd-batch-execute, I want its subagents to load only what each
  stage needs and to skip work whose result I already approved, so that a batch costs a fraction
  of today's tokens with no SDD gate weakened.

  @AC-1 @FR-1
  Scenario: Each stage runs on its scoped agent type
    Given a feature "fix-a" that is in-progress with a parsed sdd-batch-setup fence and approval {gate:'checkpoint:2', decision:'proceed'}
    When /sdd-batch-execute runs it
    Then the "preflight:fix-a" agent call has agentType "sdd-batch-checker"
    And every "step:fix-a:" agent call has agentType "sdd-batch-writer"
    And the "integration-pr:fix-a" agent call, when reached, has no agentType

  @AC-2 @FR-1
  Scenario: The scoped agents are pinned and fenced to the workflow
    Given the files .claude/agents/sdd-batch-writer.md and .claude/agents/sdd-batch-checker.md
    When their frontmatter and bodies are read
    Then both declare "model: opus"
    And both bodies contain "spawned only by .claude/workflows/sdd-batch-execute.js; never delegate from a skill session"
    And sdd-batch-checker's tools list contains neither "Edit" nor "Write"

  @AC-3 @FR-2
  Scenario: A fresh run validates and halts with a record, writing nothing
    Given an implementation-ready feature "fix-a" with pending steps 1, 2, 3 and no approvals
    When /sdd-batch-execute runs it
    Then exactly 1 "validate:fix-a" agent call is made
    And the run halts with gate "upfront" and a record containing the keys mainDev, dev, specHash, directive, pending, mismatches
    And 0 "setup:", "step:" or "write-plan:" agent calls are made

  @AC-4 @FR-2
  Scenario: A matching upfront record skips the second validate
    Given feature "fix-a" whose preflight reports mainDevSha "aaaa…" (40 hex), devSha "bbbb…" and specHash "cccc…"
    And approval {gate:'upfront', decision:'proceed', record:{mainDev:"aaaa…", dev:"bbbb…", specHash:"cccc…", directive:"conditional", pending:[1,2,3], mismatches:[{n:2, detail:"D"}]}}
    When /sdd-batch-execute runs it
    Then 0 "validate:fix-a" agent calls are made
    And the "setup:fix-a" prompt contains [{"n":2,"detail":"D"}]

  @AC-5 @FR-2
  Scenario: An upfront approval without a matching record re-halts instead of writing
    Given feature "fix-a" whose preflight reports mainDevSha "aaaa…"
    And approval {gate:'upfront', decision:'proceed'} carrying a record whose mainDev is "dddd…"
    When /sdd-batch-execute runs it
    Then exactly 1 "validate:fix-a" agent call is made
    And the run halts with gate "upfront" and a new record whose mainDev is "aaaa…"
    And 0 "setup:fix-a" agent calls are made

  @AC-6 @FR-2
  Scenario: An upfront approval with no record at all re-halts
    Given an implementation-ready feature "fix-a"
    And approval {gate:'upfront', decision:'proceed'} with no record
    When /sdd-batch-execute runs it
    Then the run halts with gate "upfront" and a record
    And 0 "setup:fix-a" agent calls are made

  @AC-7 @FR-3
  Scenario: A checkpoint approval without workflow setup goes through the Gate
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
    Given feature "fix-a" whose status is in-progress and whose last sdd-batch-setup fence has mainDev "aaaa…"
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
    And the setup agent returns stale:true
    When /sdd-batch-execute runs it
    Then the run is blocked with a message matching "start a NEW run"
    And 0 "step:fix-a" agent calls are made

  @AC-13 @FR-5
  Scenario: The setup prompt orders the merge guard and writes the fence last
    Given a matching upfront record approval for feature "fix-a"
    When the "setup:fix-a" prompt is rendered
    Then it contains "merge-train-resolve.mjs --base", "ledger-guard.py", "--amend" and "Approved-record:"
    And it contains "git log --first-parent" and "origin/main-dev..HEAD"
    And the first index of "status.md" in it is lower than the first index of "sdd-batch-setup"

  @AC-14 @FR-6
  Scenario: The step prompt scopes its reads by heading and keeps the full context.md read
    Given an in-progress feature with a pending step 3
    When the "step:<slug>:s3" prompt is rendered
    Then it contains "## PER-STEP EXECUTION", "## HARD CONSTRAINTS", "tooling-setup.md", "repo-conventions.md" and "context.md IN FULL"
    And it contains "## Deviation Log"

  @AC-15 @FR-7
  Scenario: The step prompt runs Verification verbatim and judges as PHASE 3
    Given an in-progress feature with a pending step 3
    When the "step:<slug>:s3" prompt is rendered
    Then it contains ') >"', '2>&1; echo "exit=$?"' and "no `set -o pipefail`"
    And it contains "Read the FULL log" and "red N/A — no behavior change; characterization test added"

  @AC-16 @FR-8
  Scenario: Hard constraints and contract docs stay consistent
    Given the change is applied
    When `.claude/skills/sdd-execute/SKILL.md` section "## HARD CONSTRAINTS" is compared with origin/main-dev
    Then it is byte-identical
    And `./scripts/check-context-map.sh` exits 0
    And `node --test scripts/workflow-tests/*.test.mjs` exits 0

  @AC-17 @FR-9
  Scenario: The spike proves scoped agents before any merge
    Given a throwaway branch running one scoped "sdd-batch-checker" agent and one "sdd-batch-writer" step in a worktree
    When their transcripts are measured
    Then the first-turn input of each is at most 30000 tokens
    And the checker calls mcp__github__list_pull_requests without a ToolSearch call
    And the writer's commit runs the husky pre-commit hook
