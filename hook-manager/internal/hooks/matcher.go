package hooks

import "regexp"

// MatcherField returns the field name from the JSON input that the matcher
// should be compared against for a given event.
func MatcherField(event string) string {
	switch event {
	case "PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionRequest":
		return "tool_name"
	case "SessionStart":
		return "source"
	case "SessionEnd":
		return "reason"
	case "StopFailure":
		return "error"
	case "SubagentStart", "SubagentStop":
		return "agent_type"
	case "Notification":
		return "notification_type"
	case "InstructionsLoaded":
		return "load_reason"
	case "ConfigChange":
		return "source"
	case "FileChanged":
		return "file_path"
	case "Elicitation", "ElicitationResult":
		return "mcp_server"
	default:
		return ""
	}
}

// Matches returns true if the hook's matcher regex matches the input value.
// Empty matcher matches everything.
func Matches(pattern, value string) bool {
	if pattern == "" {
		return true
	}
	matched, err := regexp.MatchString(pattern, value)
	if err != nil {
		return false
	}
	return matched
}
