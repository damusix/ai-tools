# auto-approve-compound-bash

Auto-approves compound Bash commands in [Claude Code](https://docs.anthropic.com/en/docs/claude-code) only when every extracted segment already matches your allow rules.

In Claude Code, the plugin is named `auto-approve-compound-bash`; the hook script file is `approve-compound-bash.sh`.

- Fewer repetitive prompts for pipes, chains, and subshell-heavy commands.
- No security downgrade: denied or unknown segments are never auto-approved.
- Install from GitHub in Claude Code, enable `auto-approve-compound-bash`, and you're done.

## Quick Install

1. In Claude Code, install this plugin from its GitHub repository URL.
2. Open Claude Code plugin settings and enable `auto-approve-compound-bash`.
3. Run a compound command where each segment is already allowed (for example, `ls | grep foo`) and confirm it runs without an extra permission prompt.

## What It Fixes

When each segment is already allowed, this hook auto-approves compound commands like:

- `ls | grep foo`
- `nvm use && yarn test`
- `git log | head`

## Why It Is Safe

Every decision is explicit and conservative:

- **Approve** - every extracted segment matches allow rules, and none match deny rules.
- **Deny** - any extracted segment matches a deny rule.
- **Fall through** - any segment is unknown, parsing fails, or analysis is incomplete, so Claude Code shows the normal prompt.

On any error the hook falls through. It never approves something it can't fully analyze.

## The Problem

Claude Code matches `Bash(cmd *)` permissions against the **full command string**. `ls | grep foo` doesn't match `Bash(ls *)` or `Bash(grep *)`, so you get prompted even though both commands are individually allowed.

Why you ask? Because of this:
- https://github.com/anthropics/claude-code/issues/30006
- https://github.com/anthropics/claude-code/issues/16561
- https://github.com/anthropics/claude-code/issues/13340
- https://github.com/anthropics/claude-code/issues/29421

## How It Works

- For plain commands, it does a fast direct permission check.
- For compound commands, it breaks the command into sub-commands and checks each one.
- If anything is denied, unknown, or cannot be parsed, it does not auto-approve.

**Simple commands** (no `|`, `&`, `;`, `` ` ``, `$(`) are checked directly against your prefix lists. No parsing overhead.

**Compound commands** are parsed with a native Go AST parser (`mvdan.cc/sh/v3/syntax`) that extracts every sub-command (including inside `$(...)`, `<(...)`, subshells, if/for/while/case bodies, and `bash -c` arguments), then each segment is checked.

## Debugging

Start with a quick health check:

```bash
./approve-compound-bash.sh doctor
```

Extract sub-commands from a compound command:

```bash
echo 'nvm use && yarn test' | ./approve-compound-bash.sh parse
# nvm use
# yarn test
```

Verbose mode shows matching decisions on stderr:

```bash
echo '{"tool_input":{"command":"ls | grep foo"}}' | ./approve-compound-bash.sh --debug
```

Explain mode prints clear non-allow reasons during hook execution:

```bash
echo '{"tool_input":{"command":"ls; unknown_cmd"}}' | ./approve-compound-bash.sh --permissions '["Bash(ls *)"]' --explain
```

Simulate a decision locally (without Claude) to inspect extracted segments, effective rules, and final decision:

```bash
./approve-compound-bash.sh simulate --command "bash -lc 'ls | grep foo'" --permissions '["Bash(ls *)","Bash(grep *)"]'
```

## Testing

The project includes a full legacy parity suite plus focused Go unit tests.

```bash
go test ./...
```

## Build and release

Before pushing a release, build binaries for all supported targets and commit them under `bin/` so plugin installs work immediately from Claude Code's cache.

On first run, `approve-compound-bash.sh` resolves the current OS/arch and creates a cached symlink at `.approve-compound-bash-current` to the correct binary. Later runs execute that symlink directly.

## Advanced manual setup

Only use this if you are **not** using Claude Code's GitHub plugin install flow and want to install the hook script manually.

Requires no runtime dependencies beyond the shipped plugin binaries.

```bash
./scripts/build-release-binaries.sh
```

Copy the script somewhere and register it in `~/.claude/settings.json`:

```jsonc
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Bash",
      "hooks": [{
        "type": "command",
        "command": "~/.claude/scripts/approve-compound-bash.sh --explain",
        "timeout": 3
      }]
    }]
  },
  "permissions": {
    "allow": [
      "Bash(ls *)", "Bash(grep *)", "Bash(git *)" // ...
    ],
    "deny": [
      "Bash(git push --force *)", "Bash(rm -rf / *)" // ...
    ]
  }
}
```

The hook also:

- Reads permissions from all settings layers (global, global local, project, project local).
- Supports all permission formats (`Bash(cmd *)`, `Bash(cmd:*)`, `Bash(cmd)`).
- Strips env var prefixes (`NODE_ENV=prod npm test` matches `npm`).
- Expands home-based permission prefixes (`~/`, `$HOME/`, `${HOME}/`) to absolute paths for matching.
- Recursively analyzes shell `-c` forms (`bash -lc`, `bash -euxc`, `sh -c`, `zsh -c`).

## Credits

Based on [claude-code-plus](https://github.com/AbdelrahmanHafez/claude-code-plus) (MIT). Key differences: deny list support, active deny for compounds, fast path for simple commands, falls through on empty parse (the original approves), settings layer support, env var stripping, and a test suite.
