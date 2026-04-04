---
name: ralph-loop
description: >-
  Use when the user asks to "write a ralph prompt", "build something with ralph",
  "create a ralph loop", "set up ralph", "initialize ralph", "start a new ralph project",
  "run ralph", "configure ralph", "instantiate a ralph loop", or describes a feature,
  task, or project they want to build autonomously. The primary workflow is an interactive
  prompt-writing guide that helps users craft high-quality task prompts through structured
  clarification. Also covers setup, initialization, and execution.
---

# Ralph Loop

Ralph is a standalone zx script that drives AI coding agents (Claude, Amp, Codex, OpenCode)
through iterative development cycles. Write a task prompt, ralph handles everything else —
environment discovery, context assembly, AI invocation, quality gates, git commits, and
inter-iteration communication via a status report.


## Routing

Determine what the user needs and consult the right reference:

| User wants to... | Reference |
|-------------------|-----------|
| **Write or refine a prompt** (primary use case) | `references/prompt-writing-guide.md` — follow the Interactive Prompt-Writing Guide |
| Set up Docker environment | `references/docker-setup.md` |
| Initialize, run, or reset a loop | `references/loop-lifecycle.md` |
| Configure tool, iterations, or quality checks | `references/config-reference.md` |
| Understand or troubleshoot status reports | `references/status-report-guide.md` |

If the user describes something they want to build (a feature, fix, or task) without
explicitly asking for setup — route to the prompt-writing guide.


## Prompt Writing (Primary Workflow)

Follow the interactive guide in `references/prompt-writing-guide.md`. The short version:

1. **Clarify the Goal** — specific, includes the "why". Ask if vague or ambiguous.
2. **Scope the Tasks** — each ≈ one iteration. Split large, condense small.
3. **Discover Constraints** — tools, off-limits files, conventions, references.
4. **Define "Done"** — concrete commands and expected output.

Stop after each step to collect user input. Use `AskUserQuestion` for disambiguation.
Assemble the final prompt, present for review, then write to `docs/ralph-loop/ralph-prompt.md`.
