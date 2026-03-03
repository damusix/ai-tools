# claude-marketplace

A collection of plugins, skills, and tools for [Claude Code](https://docs.anthropic.com/en/docs/claude-code).


## Plugins

### [ai-memory](./ai-memory)

Persistent memory for Claude Code. Automatically captures observations from your sessions and synthesizes them into memories that get injected into future sessions — so Claude already knows your project's conventions, decisions, and context.

- Runs entirely locally — your data never leaves your machine
- Single shared server across all Claude Code sessions
- Background worker extracts observations and synthesizes memories
- SolidJS dashboard for browsing and managing memories
- MCP tools for saving, searching, and organizing memories
- Slash commands: `/remember`, `/forget`

See the [ai-memory README](./ai-memory/README.md) for dashboard and CLI screenshots.


### [cc-auto-approve-fix](./cc-auto-approve-fix)

Auto-approves compound Bash commands in Claude Code by parsing command segments and checking each segment against your allow/deny rules.

- Native Go parser (`mvdan.cc/sh/v3/syntax`) for robust shell AST handling
- Supports compound operators, substitutions, subshells, and `bash/sh/zsh -c` recursion
- Keep Claude in control on uncertainty (fallthrough behavior)
- Optional explainability output (`--explain`) for clear non-allow reasons
- Includes `simulate` mode for local decision testing and `doctor` mode for settings diagnostics
- Ships with prebuilt binaries for `darwin/linux` and `amd64/arm64`


## Installation

Each plugin has its own setup. See the plugin's README for instructions.


## License

MIT
