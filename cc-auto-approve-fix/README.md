# approve-compound-bash

A [Claude Code](https://docs.anthropic.com/en/docs/claude-code) hook that auto-approves compound Bash commands when every sub-command is in your allow list and none are in your deny list.

## The problem

Claude Code matches `Bash(cmd *)` permissions against the **full command string**. `ls | grep foo` doesn't match `Bash(ls *)` or `Bash(grep *)`, so you get prompted even though both commands are individually allowed. Same for `nvm use && yarn test`, `git log | head`, `mkdir -p dir && cd dir`, etc.

This hook parses compound commands into segments and checks each one.

## Install

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

The hook reads permissions from all settings layers (global, global local, project, project local), supports all permission formats (`Bash(cmd *)`, `Bash(cmd:*)`, `Bash(cmd)`), strips env var prefixes (`NODE_ENV=prod npm test` matches `npm`), expands home-based permission prefixes (`~/`, `$HOME/`, `${HOME}/`) to absolute paths for matching, and recursively analyzes shell `-c` forms (`bash -lc`, `bash -euxc`, `sh -c`, `zsh -c`).

## How it decides

**Simple commands** (no `|`, `&`, `;`, `` ` ``, `$(`) are checked directly against your prefix lists. No parsing overhead.

**Compound commands** are parsed with a native Go AST parser (`mvdan.cc/sh/v3/syntax`) that extracts every sub-command (including inside `$(...)`, `<(...)`, subshells, if/for/while/case bodies, and `bash -c` arguments), then each segment is checked.

Three outcomes:

- **Approve** — all segments in allow list, none in deny list. Command runs.
- **Deny** — any segment matches the deny list. Command is blocked.
- **Fall through** — segment is unknown (not in allow or deny), or parse failed. Claude Code shows its normal permission prompt.

On any error the hook falls through. It never approves something it can't fully analyze.

## Debugging

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

Run doctor mode to verify integration and settings loading:

```bash
./approve-compound-bash.sh doctor
```

## Testing

The project includes a full legacy parity suite plus focused Go unit tests.

```bash
go test ./...
```

## Build and release

Before pushing a release, build binaries for all supported targets and commit them under `bin/` so plugin installs work immediately from Claude Code's cache.

On first run, `approve-compound-bash.sh` resolves the current OS/arch and creates a cached symlink at `.approve-compound-bash-current` to the correct binary. Later runs execute that symlink directly.

## Credits

Based on [claude-code-plus](https://github.com/AbdelrahmanHafez/claude-code-plus) (MIT). Key differences: deny list support, active deny for compounds, fast path for simple commands, falls through on empty parse (the original approves), settings layer support, env var stripping, and a test suite.
