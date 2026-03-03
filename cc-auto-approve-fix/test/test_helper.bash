#!/usr/bin/env bash
# Shared helpers for BATS tests of approve-compound-bash.sh
#
# Two test layers:
#   run_parse  "cmd"              -> test command extraction (no permissions)
#   run_hook   "cmd" ALLOW [DENY] -> test full hook pipeline (stdin JSON + permissions)

HOOK_SCRIPT="${BATS_TEST_DIRNAME}/../approve-compound-bash.sh"

# ---------------------------------------------------------------------------
# Parsing helpers (plain text stdin -> extracted commands on stdout)
# ---------------------------------------------------------------------------

# Feed a command string to `parse` mode, capture extracted commands.
run_parse() {
  run bash -c 'printf "%s" "$1" | "$2" parse' _ "$1" "$HOOK_SCRIPT"
}

# Assert extracted commands match expected list (order matters).
# Usage: assert_commands "ls" "grep foo" "head -5"
assert_commands() {
  local -a expected=("$@")
  local -a actual=()
  while IFS= read -r line; do
    [[ -n "$line" ]] && actual+=("$line")
  done <<< "$output"

  if [[ ${#actual[@]} -ne ${#expected[@]} ]]; then
    echo "# count: expected ${#expected[@]}, got ${#actual[@]}" >&3
    echo "# expected: $(printf "'%s' " "${expected[@]}")" >&3
    echo "# actual:   $(printf "'%s' " "${actual[@]}")" >&3
    return 1
  fi
  for i in "${!expected[@]}"; do
    if [[ "${actual[$i]}" != "${expected[$i]}" ]]; then
      echo "# command[$i]: expected '${expected[$i]}', got '${actual[$i]}'" >&3
      return 1
    fi
  done
}

assert_no_commands() {
  [[ -z "$output" ]] || {
    echo "# expected no output, got: $output" >&3
    return 1
  }
}

# ---------------------------------------------------------------------------
# Hook helpers (JSON stdin -> permission decision on stdout)
# ---------------------------------------------------------------------------

# Run the full hook with custom permissions.
# $1 = command string
# $2 = allow list as JSON array, e.g. '["Bash(ls *)","Bash(grep *)"]'
# $3 = (optional) deny list as JSON array
run_hook() {
  local command="$1"
  local allow="${2:-[]}"
  local deny="${3:-[]}"
  local json
  json=$(jq -n --arg cmd "$command" '{"tool_input":{"command":$cmd}}')
  if [[ "$deny" == "[]" ]]; then
    run bash -c 'printf "%s" "$1" | "$2" --permissions "$3"' \
      _ "$json" "$HOOK_SCRIPT" "$allow"
  else
    run bash -c 'printf "%s" "$1" | "$2" --permissions "$3" --deny "$4"' \
      _ "$json" "$HOOK_SCRIPT" "$allow" "$deny"
  fi
}

# Assert hook output is an allow decision.
assert_approved() {
  [[ "$output" == *'"permissionDecision":"allow"'* ]] || {
    echo "# expected ALLOW, got: $output" >&3
    return 1
  }
}

# Assert hook did NOT output an allow decision (fell through).
assert_fallthrough() {
  [[ "$status" -eq 0 ]] || {
    echo "# expected FALLTHROUGH (exit 0), got exit $status" >&3
    return 1
  }
  [[ "$output" != *'"permissionDecision":"allow"'* ]] || {
    echo "# expected FALLTHROUGH (no output), got: $output" >&3
    return 1
  }
}

# Assert hook actively denied the command (exit 2).
assert_denied() {
  [[ "$status" -eq 2 ]] || {
    echo "# expected DENY (exit 2), got exit $status with output: $output" >&3
    return 1
  }
}
