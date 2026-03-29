package hooks

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestBlockPreToolUse(t *testing.T) {
	resp := BlockResponse("PreToolUse", "dangerous command")
	data, _ := json.Marshal(resp.Body)
	s := string(data)
	if !strings.Contains(s, `"permissionDecision":"deny"`) {
		t.Errorf("PreToolUse block missing permissionDecision:deny in %s", s)
	}
	if !strings.Contains(s, `"permissionDecisionReason":"dangerous command"`) {
		t.Errorf("PreToolUse block missing reason in %s", s)
	}
}

func TestBlockPermissionRequest(t *testing.T) {
	resp := BlockResponse("PermissionRequest", "not allowed")
	data, _ := json.Marshal(resp.Body)
	s := string(data)
	// message must be inside decision object
	if !strings.Contains(s, `"behavior":"deny"`) {
		t.Errorf("PermissionRequest block missing behavior:deny in %s", s)
	}
	if !strings.Contains(s, `"message":"not allowed"`) {
		t.Errorf("PermissionRequest block missing message in %s", s)
	}
}

func TestBlockStop(t *testing.T) {
	resp := BlockResponse("Stop", "keep going")
	data, _ := json.Marshal(resp.Body)
	s := string(data)
	if !strings.Contains(s, `"decision":"block"`) {
		t.Errorf("Stop block missing decision:block in %s", s)
	}
}

func TestBlockNonBlockableEvent(t *testing.T) {
	resp := BlockResponse("PostToolUse", "whatever")
	if resp.Body != nil {
		t.Errorf("non-blockable event should have nil Body, got %v", resp.Body)
	}
	if resp.UseHTTPError {
		t.Error("non-blockable event should not use HTTP error")
	}
}

func TestBlockWorktreeCreate(t *testing.T) {
	resp := BlockResponse("WorktreeCreate", "not allowed")
	if !resp.UseHTTPError {
		t.Error("WorktreeCreate should use HTTP error")
	}
	if resp.Body != nil {
		t.Error("WorktreeCreate should have nil Body")
	}
}

func TestIsBlockable(t *testing.T) {
	blockable := []string{"PreToolUse", "PermissionRequest", "UserPromptSubmit", "Stop", "SubagentStop", "TeammateIdle", "TaskCompleted", "ConfigChange", "WorktreeCreate", "Elicitation", "ElicitationResult"}
	for _, e := range blockable {
		if !IsBlockable(e) {
			t.Errorf("%s should be blockable", e)
		}
	}
	nonBlockable := []string{"PostToolUse", "PostToolUseFailure", "SessionStart", "SessionEnd", "SubagentStart", "Notification", "StopFailure", "InstructionsLoaded", "CwdChanged", "FileChanged", "WorktreeRemove", "PreCompact", "PostCompact"}
	for _, e := range nonBlockable {
		if IsBlockable(e) {
			t.Errorf("%s should NOT be blockable", e)
		}
	}
}
