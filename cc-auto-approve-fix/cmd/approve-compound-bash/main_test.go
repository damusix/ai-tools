package main

import (
	"reflect"
	"strings"
	"testing"
)

func TestNeedsCompoundParse(t *testing.T) {
	tests := []struct {
		name string
		cmd  string
		want bool
	}{
		{name: "simple", cmd: "ls -la", want: false},
		{name: "chain", cmd: "ls && grep foo", want: true},
		{name: "shell-c", cmd: "bash -c 'echo hi'", want: true},
		{name: "shell-lc", cmd: "bash -lc 'echo hi'", want: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := needsCompoundParse(tt.cmd); got != tt.want {
				t.Fatalf("needsCompoundParse(%q)=%v want %v", tt.cmd, got, tt.want)
			}
		})
	}
}

func TestParseCompound(t *testing.T) {
	tests := []struct {
		name string
		cmd  string
		want []string
	}{
		{name: "pipe", cmd: "ls | grep foo", want: []string{"ls", "grep foo"}},
		{name: "substitution", cmd: "echo $(date)", want: []string{"echo $(..)", "date"}},
		{name: "shell-c simple", cmd: "bash -c 'echo hello'", want: []string{"echo hello"}},
		{name: "shell-c flags", cmd: "bash -euxc 'ls | grep foo'", want: []string{"ls", "grep foo"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := parseCompound(tt.cmd)
			if !ok {
				t.Fatalf("parseCompound(%q) failed", tt.cmd)
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("parseCompound(%q)=%v want %v", tt.cmd, got, tt.want)
			}
		})
	}
}

func TestDenyPrecedence(t *testing.T) {
	if isAllowed("rm -rf /", []string{"rm"}, []string{"rm -rf"}) {
		t.Fatal("expected deny to override allow")
	}
}

func TestResolveMode(t *testing.T) {
	if got := resolveMode([]string{"simulate"}); got != modeSimulate {
		t.Fatalf("resolveMode simulate=%s", got)
	}
	if got := resolveMode([]string{"doctor"}); got != modeDoctor {
		t.Fatalf("resolveMode doctor=%s", got)
	}
	if got := resolveMode([]string{"parse"}); got != modeParse {
		t.Fatalf("resolveMode parse=%s", got)
	}
	if got := resolveMode(nil); got != modeHook {
		t.Fatalf("resolveMode hook=%s", got)
	}
}

func TestRemoveModeArgs(t *testing.T) {
	got := removeModeArgs([]string{"simulate", "--command", "ls | grep foo", "--permissions", "[]"})
	want := []string{"--command", "ls | grep foo", "--permissions", "[]"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("removeModeArgs=%v want %v", got, want)
	}
}

func TestEvaluateCommandIncludesReason(t *testing.T) {
	eval := evaluateCommand("ls; unknown_cmd", []string{"ls"}, nil)
	if eval.Decision != decisionFallthrough {
		t.Fatalf("decision=%s", eval.Decision)
	}
	if strings.TrimSpace(eval.Reason) == "" {
		t.Fatal("expected reason for non-allow decision")
	}
}

func TestRuleHomeExpansion(t *testing.T) {
	t.Setenv("HOME", "/Users/tester")
	allow := parseRuleArray(`["Bash(cat ~/.claude/skills/*)"]`)
	eval := evaluateCommand("cat /Users/tester/.claude/skills/my-skill/SKILL.md", allow, nil)
	if eval.Decision != decisionAllow {
		t.Fatalf("expected allow with expanded home prefix, got %s (%s)", eval.Decision, eval.Reason)
	}
}

func TestRuleHomeExpansionWithEnvSyntax(t *testing.T) {
	t.Setenv("HOME", "/Users/tester")
	allow := parseRuleArray(`["Bash(ls $HOME/.claude/skills/*)","Bash(cat ${HOME}/.claude/skills/*)"]`)

	evalLS := evaluateCommand("ls /Users/tester/.claude/skills/", allow, nil)
	if evalLS.Decision != decisionAllow {
		t.Fatalf("expected allow for $HOME variant, got %s (%s)", evalLS.Decision, evalLS.Reason)
	}

	evalCat := evaluateCommand("cat /Users/tester/.claude/skills/my-skill/SKILL.md", allow, nil)
	if evalCat.Decision != decisionAllow {
		t.Fatalf("expected allow for ${HOME} variant, got %s (%s)", evalCat.Decision, evalCat.Reason)
	}
}

func TestRuleHomeExpansionPreservesOriginalPrefix(t *testing.T) {
	t.Setenv("HOME", "/Users/tester")
	allow := parseRuleArray(`["Bash(cat ~/.claude/skills/*)"]`)

	evalTilde := evaluateCommand("cat ~/.claude/skills/foo.md", allow, nil)
	if evalTilde.Decision != decisionAllow {
		t.Fatalf("expected allow for original tilde prefix, got %s (%s)", evalTilde.Decision, evalTilde.Reason)
	}

	evalAbs := evaluateCommand("cat /Users/tester/.claude/skills/foo.md", allow, nil)
	if evalAbs.Decision != decisionAllow {
		t.Fatalf("expected allow for expanded absolute prefix, got %s (%s)", evalAbs.Decision, evalAbs.Reason)
	}
}
