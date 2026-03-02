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

#### Dashboard

![Memories and Observations](./ai-memory/docs/images/memories-and-observations.png)

![Domain Categories](./ai-memory/docs/images/domain-categories.png)

![Tags](./ai-memory/docs/images/tags.png)

![Configuration](./ai-memory/docs/images/config.png)

#### CLI

![CLI Output](./ai-memory/docs/images/bash-output.png)


## Installation

Each plugin has its own setup. See the plugin's README for instructions.


## License

MIT
