# claude-marketplace

Install one marketplace, get two practical Claude Code plugins: persistent memory and safer Bash auto-approval.

## Quickstart

Add this marketplace, then install both plugins:

```shell
/plugin marketplace add damusix/ai-tools
/plugin install ai-memory@damusix-ai-tools
/plugin install auto-approve-compound-bash@damusix-ai-tools
```

## What you get

### `ai-memory`

Give Claude long-term project memory across sessions, with local-first storage and tools to organize context.

- Captures observations and synthesizes reusable memories
- Shares one memory service across Claude Code sessions
- Provides MCP tools for saving, searching, and organizing memory
- Includes dashboard UI to browse and manage memories
- Adds `/remember` and `/forget` slash commands

Docs: [`ai-memory/README.md`](./ai-memory/README.md)

### `auto-approve-compound-bash` (`cc-auto-approve-fix` source)

Auto-approve compound Bash commands safely by parsing each command segment against allow/deny rules.

- Uses a native Go shell parser (`mvdan.cc/sh/v3/syntax`) for AST-based checks
- Handles compound operators, substitutions, subshells, and nested `bash/sh/zsh -c`
- Falls through safely when uncertainty is detected
- Supports `--explain`, `simulate`, and `doctor` workflows
- Ships prebuilt binaries for `darwin/linux` and `amd64/arm64`

Docs: [`cc-auto-approve-fix/README.md`](./cc-auto-approve-fix/README.md)

## Why this marketplace

- One setup path gives you both plugins immediately
- Plugin names are stable in the `damusix-ai-tools` marketplace catalog
- Memory stays local and command auto-approval remains rule-driven

## License

MIT
