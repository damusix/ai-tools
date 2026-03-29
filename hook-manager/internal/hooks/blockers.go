package hooks

// BlockResult holds the response body and flags for a block action.
type BlockResult struct {
	Body         map[string]any // JSON response body. Nil for non-blockable events.
	UseHTTPError bool           // Return non-2xx status (WorktreeCreate only).
}

// blockableEvents is a set of event names that support blocking.
var blockableEvents = map[string]bool{
	"PreToolUse":       true,
	"PermissionRequest": true,
	"UserPromptSubmit": true,
	"Stop":             true,
	"SubagentStop":     true,
	"TeammateIdle":     true,
	"TaskCompleted":    true,
	"ConfigChange":     true,
	"WorktreeCreate":   true,
	"Elicitation":      true,
	"ElicitationResult": true,
}

// IsBlockable reports whether the given event name supports blocking.
func IsBlockable(event string) bool {
	return blockableEvents[event]
}

// BlockResponse returns the correct BlockResult for blocking the given event
// with the provided reason string. For non-blockable events, Body is nil and
// UseHTTPError is false.
func BlockResponse(event, reason string) BlockResult {
	switch event {
	case "PreToolUse":
		return BlockResult{
			Body: map[string]any{
				"hookSpecificOutput": map[string]any{
					"hookEventName":            "PreToolUse",
					"permissionDecision":       "deny",
					"permissionDecisionReason": reason,
				},
			},
		}

	case "PermissionRequest":
		return BlockResult{
			Body: map[string]any{
				"hookSpecificOutput": map[string]any{
					"hookEventName": "PermissionRequest",
					"decision": map[string]any{
						"behavior": "deny",
						"message":  reason,
					},
				},
			},
		}

	case "UserPromptSubmit", "Stop", "SubagentStop", "ConfigChange":
		return BlockResult{
			Body: map[string]any{
				"decision": "block",
				"reason":   reason,
			},
		}

	case "TeammateIdle", "TaskCompleted":
		return BlockResult{
			Body: map[string]any{
				"continue":   false,
				"stopReason": reason,
			},
		}

	case "WorktreeCreate":
		return BlockResult{
			UseHTTPError: true,
			Body:         nil,
		}

	case "Elicitation", "ElicitationResult":
		return BlockResult{
			Body: map[string]any{
				"hookSpecificOutput": map[string]any{
					"hookEventName": event,
					"action":        "decline",
				},
			},
		}

	default:
		return BlockResult{}
	}
}
