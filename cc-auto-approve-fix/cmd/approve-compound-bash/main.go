package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"mvdan.cc/sh/v3/syntax"
)

var version = "dev"
var commit = "unknown"
var buildDate = "unknown"

const allowJSON = `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}`

type hookInput struct {
	ToolInput struct {
		Command string `json:"command"`
	} `json:"tool_input"`
}

type denyOutput struct {
	HookSpecificOutput struct {
		HookEventName      string `json:"hookEventName"`
		PermissionDecision string `json:"permissionDecision"`
	} `json:"hookSpecificOutput"`
	SystemMessage string `json:"systemMessage"`
}

type settingsFile struct {
	Permissions struct {
		Allow []string `json:"allow"`
		Deny  []string `json:"deny"`
	} `json:"permissions"`
}

type app struct {
	debug bool
}

type mode string

const (
	modeHook     mode = "hook"
	modeParse    mode = "parse"
	modeSimulate mode = "simulate"
	modeDoctor   mode = "doctor"
)

type decision string

const (
	decisionAllow       decision = "allow"
	decisionDeny        decision = "deny"
	decisionFallthrough decision = "fallthrough"
)

type evaluation struct {
	Decision decision `json:"decision"`
	Reason   string   `json:"reason"`
	Segments []string `json:"segments,omitempty"`
}

type settingsLoadResult struct {
	Allow          []string               `json:"allow"`
	Deny           []string               `json:"deny"`
	Files          []settingsFileStatus   `json:"files"`
	EffectiveFiles []string               `json:"effectiveFiles"`
	Mode           string                 `json:"mode"`
	Metadata       map[string]interface{} `json:"metadata,omitempty"`
}

type settingsFileStatus struct {
	Path       string `json:"path"`
	Exists     bool   `json:"exists"`
	Loaded     bool   `json:"loaded"`
	AllowCount int    `json:"allowCount"`
	DenyCount  int    `json:"denyCount"`
	Error      string `json:"error,omitempty"`
}

var envAssignRE = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*=[^\s]*\s+(.*)$`)
var shellCRe = regexp.MustCompile(`^(?:env\s+)?(?:/[^\s]*/)?(?:ba?sh|sh|zsh)\s+-(?:[a-zA-Z]*c[a-zA-Z]*|c)\s+`)

func main() {
	os.Exit(run())
}

func run() int {
	rawArgs := os.Args[1:]
	selectedMode := resolveMode(rawArgs)
	parseArgs := removeModeArgs(rawArgs)

	var (
		debugFlag       bool
		explainFlag     bool
		permissionsJSON string
		denyJSON        string
		simCommand      string
	)

	fs := flag.NewFlagSet(os.Args[0], flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	fs.BoolVar(&debugFlag, "debug", false, "enable debug logging")
	fs.BoolVar(&explainFlag, "explain", false, "print non-allow reasons to stderr")
	fs.StringVar(&permissionsJSON, "permissions", "", "allow list JSON array")
	fs.StringVar(&denyJSON, "deny", "", "deny list JSON array")
	fs.StringVar(&simCommand, "command", "", "command for simulate mode")
	if err := fs.Parse(parseArgs); err != nil {
		return 0
	}

	application := &app{debug: debugFlag}

	switch selectedMode {
	case modeParse:
		return application.runParseMode()
	case modeSimulate:
		return application.runSimulateMode(simCommand, permissionsJSON, denyJSON)
	case modeDoctor:
		return application.runDoctorMode()
	}

	input, err := io.ReadAll(os.Stdin)
	if err != nil {
		application.debugf("failed reading stdin: %v", err)
		return 0
	}

	command := getCommand(input)
	if command == "" {
		return 0
	}
	application.debugf("command: %s", command)

	loadResult := application.loadPrefixes(permissionsJSON, denyJSON)
	allowed := loadResult.Allow
	denied := loadResult.Deny
	if len(allowed) == 0 {
		if explainFlag {
			_, _ = fmt.Fprintln(os.Stderr, "[approve-compound] fallthrough: no allow rules loaded")
		}
		return 0
	}

	eval := evaluateCommand(command, allowed, denied)
	if eval.Decision == decisionAllow {
		_, _ = fmt.Fprintln(os.Stdout, allowJSON)
		return 0
	}

	if explainFlag && eval.Reason != "" {
		_, _ = fmt.Fprintf(os.Stderr, "[approve-compound] %s\n", eval.Reason)
	}

	if eval.Decision == decisionDeny {
		return deny(eval.Reason)
	}

	return 0
}

func (a *app) runParseMode() int {
	input, err := io.ReadAll(os.Stdin)
	if err != nil {
		return 0
	}
	cmd := string(input)
	if cmd == "" {
		return 0
	}

	if !needsCompoundParse(cmd) {
		_, _ = fmt.Fprintln(os.Stdout, cmd)
		return 0
	}

	commands, ok := parseCompound(cmd)
	if !ok {
		return 0
	}
	for _, c := range commands {
		if c == "" {
			continue
		}
		_, _ = fmt.Fprintln(os.Stdout, c)
	}
	return 0
}

func resolveMode(args []string) mode {
	for _, arg := range args {
		switch arg {
		case string(modeParse):
			return modeParse
		case string(modeSimulate):
			return modeSimulate
		case string(modeDoctor):
			return modeDoctor
		}
	}
	return modeHook
}

func removeModeArgs(args []string) []string {
	out := make([]string, 0, len(args))
	for _, arg := range args {
		switch arg {
		case string(modeParse), string(modeSimulate), string(modeDoctor):
			continue
		default:
			out = append(out, arg)
		}
	}
	return out
}

func evaluateCommand(command string, allow, deny []string) evaluation {
	if len(allow) == 0 {
		return evaluation{Decision: decisionFallthrough, Reason: "fallthrough: no allow rules loaded"}
	}

	if !needsCompoundParse(command) {
		if hit, prefix, candidate := firstPrefixMatch(command, deny); hit {
			return evaluation{
				Decision: decisionFallthrough,
				Reason:   fmt.Sprintf("fallthrough: simple command candidate %q matches deny prefix %q", candidate, prefix),
				Segments: []string{command},
			}
		}
		if hit, prefix, candidate := firstPrefixMatch(command, allow); hit {
			return evaluation{
				Decision: decisionAllow,
				Reason:   fmt.Sprintf("allow: simple command candidate %q matches allow prefix %q", candidate, prefix),
				Segments: []string{command},
			}
		}
		return evaluation{
			Decision: decisionFallthrough,
			Reason:   "fallthrough: simple command is not in allow list",
			Segments: []string{command},
		}
	}

	commands, ok := parseCompound(command)
	if !ok || len(commands) == 0 {
		return evaluation{Decision: decisionFallthrough, Reason: "fallthrough: command parse failed or extracted no segments"}
	}

	for _, segment := range commands {
		if segment == "" {
			continue
		}
		if hit, prefix, candidate := firstPrefixMatch(segment, deny); hit {
			return evaluation{
				Decision: decisionDeny,
				Reason:   fmt.Sprintf("Compound command contains denied segment %q (candidate %q matched deny prefix %q)", segment, candidate, prefix),
				Segments: commands,
			}
		}
	}

	for _, segment := range commands {
		if segment == "" {
			continue
		}
		if hit, _, _ := firstPrefixMatch(segment, allow); !hit {
			return evaluation{
				Decision: decisionFallthrough,
				Reason:   fmt.Sprintf("fallthrough: compound segment %q is not in allow list", segment),
				Segments: commands,
			}
		}
	}

	return evaluation{
		Decision: decisionAllow,
		Reason:   "allow: all compound segments matched allow list and none matched deny list",
		Segments: commands,
	}
}

func (a *app) runSimulateMode(simCommand, allowJSON, denyJSON string) int {
	command := strings.TrimSpace(simCommand)
	if command == "" {
		input, err := io.ReadAll(os.Stdin)
		if err == nil {
			command = strings.TrimSpace(string(input))
		}
	}
	if command == "" {
		return 0
	}

	loadResult := a.loadPrefixes(allowJSON, denyJSON)
	eval := evaluateCommand(command, loadResult.Allow, loadResult.Deny)

	out := map[string]interface{}{
		"command":  command,
		"decision": eval.Decision,
		"reason":   eval.Reason,
		"segments": eval.Segments,
		"allow":    loadResult.Allow,
		"deny":     loadResult.Deny,
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	_ = enc.Encode(out)
	return 0
}

func (a *app) runDoctorMode() int {
	loadResult := a.loadPrefixes("", "")
	loadResult.Mode = string(modeDoctor)
	loadResult.Metadata = map[string]interface{}{
		"version":   version,
		"commit":    commit,
		"buildDate": buildDate,
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	_ = enc.Encode(loadResult)
	return 0
}

func (a *app) loadPrefixes(allowJSON, denyJSON string) settingsLoadResult {
	result := settingsLoadResult{Mode: string(modeHook)}
	if allowJSON != "" {
		result.Allow = parseRuleArray(allowJSON)
		result.Deny = parseRuleArray(denyJSON)
		result.EffectiveFiles = []string{"inline --permissions/--deny"}
		return result
	}

	files := []string{
		filepath.Join(os.Getenv("HOME"), ".claude", "settings.json"),
		filepath.Join(os.Getenv("HOME"), ".claude", "settings.local.json"),
	}
	gitRoot := findGitRoot()
	if gitRoot != "" {
		files = append(files,
			filepath.Join(gitRoot, ".claude", "settings.json"),
			filepath.Join(gitRoot, ".claude", "settings.local.json"),
		)
	} else {
		files = append(files, ".claude/settings.json", ".claude/settings.local.json")
	}

	allowSet := map[string]bool{}
	denySet := map[string]bool{}
	for _, file := range files {
		status := settingsFileStatus{Path: file}
		raw, err := os.ReadFile(file)
		if err != nil {
			if !errors.Is(err, os.ErrNotExist) {
				status.Error = err.Error()
			}
			result.Files = append(result.Files, status)
			continue
		}
		status.Exists = true
		var cfg settingsFile
		if err := json.Unmarshal(raw, &cfg); err != nil {
			status.Error = err.Error()
			result.Files = append(result.Files, status)
			continue
		}
		status.Loaded = true
		status.AllowCount = len(cfg.Permissions.Allow)
		status.DenyCount = len(cfg.Permissions.Deny)
		result.EffectiveFiles = append(result.EffectiveFiles, file)
		for _, rule := range cfg.Permissions.Allow {
			if p, ok := extractBashPrefix(rule); ok && p != "" {
				allowSet[p] = true
			}
		}
		for _, rule := range cfg.Permissions.Deny {
			if p, ok := extractBashPrefix(rule); ok && p != "" {
				denySet[p] = true
			}
		}
		result.Files = append(result.Files, status)
	}

	result.Allow = sortedKeys(allowSet)
	result.Deny = sortedKeys(denySet)
	a.debugf("loaded %d allow, %d deny prefixes", len(result.Allow), len(result.Deny))
	return result
}

func sortedKeys(set map[string]bool) []string {
	keys := make([]string, 0, len(set))
	for key := range set {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func parseRuleArray(raw string) []string {
	if raw == "" {
		return nil
	}
	var rules []string
	if err := json.Unmarshal([]byte(raw), &rules); err != nil {
		return nil
	}
	set := map[string]bool{}
	for _, rule := range rules {
		if p, ok := extractBashPrefix(rule); ok && p != "" {
			set[p] = true
		}
	}
	return sortedKeys(set)
}

func extractBashPrefix(rule string) (string, bool) {
	if !strings.HasPrefix(rule, "Bash(") || !strings.HasSuffix(rule, ")") {
		return "", false
	}
	inner := strings.TrimSuffix(strings.TrimPrefix(rule, "Bash("), ")")
	switch {
	case strings.HasSuffix(inner, ":*"):
		inner = strings.TrimSuffix(inner, ":*")
	case strings.HasSuffix(inner, " *"):
		inner = strings.TrimSuffix(inner, " *")
	case strings.HasSuffix(inner, "*"):
		inner = strings.TrimSuffix(inner, "*")
	}
	return inner, true
}

func getCommand(raw []byte) string {
	var in hookInput
	if err := json.Unmarshal(raw, &in); err != nil {
		return ""
	}
	return in.ToolInput.Command
}

func findGitRoot() string {
	toplevel, err := runGit("rev-parse", "--show-toplevel")
	if err != nil || toplevel == "" {
		return ""
	}
	gitDir, err1 := runGit("rev-parse", "--git-dir")
	commonDir, err2 := runGit("rev-parse", "--git-common-dir")
	if err1 == nil && err2 == nil && gitDir != "" && commonDir != "" && gitDir != commonDir {
		return filepath.Dir(commonDir)
	}
	return toplevel
}

func runGit(args ...string) (string, error) {
	out, err := exec.Command("git", args...).Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

func needsCompoundParse(cmd string) bool {
	if strings.ContainsAny(cmd, "|&;`") ||
		strings.Contains(cmd, "$(") ||
		strings.Contains(cmd, "<(") ||
		strings.Contains(cmd, ">(") {
		return true
	}
	return shellCRe.MatchString(strings.TrimSpace(cmd))
}

func parseCompound(cmd string) ([]string, bool) {
	parser := syntax.NewParser(syntax.Variant(syntax.LangBash))
	file, err := parser.Parse(strings.NewReader(cmd), "")
	if err != nil {
		return nil, false
	}

	commands := []string{}
	extractFromStmts(file.Stmts, &commands)
	if len(commands) == 0 {
		return nil, false
	}

	result := make([]string, 0, len(commands))
	for _, c := range commands {
		if c == "" {
			continue
		}
		inner, recursed := maybeRecurseShellC(c)
		if recursed {
			if len(inner) == 0 {
				result = append(result, c)
				continue
			}
			result = append(result, inner...)
			continue
		}
		result = append(result, c)
	}
	if len(result) == 0 {
		return nil, false
	}
	return result, true
}

func maybeRecurseShellC(cmd string) ([]string, bool) {
	parts, err := splitShellWords(cmd)
	if err != nil || len(parts) < 3 {
		return nil, false
	}

	idx := 0
	if parts[0] == "env" {
		idx++
		for idx < len(parts) && strings.Contains(parts[idx], "=") {
			idx++
		}
		if idx >= len(parts) {
			return nil, false
		}
	}

	shell := filepath.Base(parts[idx])
	if shell != "bash" && shell != "sh" && shell != "zsh" {
		return nil, false
	}
	idx++

	cIndex := -1
	for i := idx; i < len(parts); i++ {
		tok := parts[i]
		if tok == "--" {
			idx = i + 1
			continue
		}
		if strings.HasPrefix(tok, "-") {
			if strings.Contains(tok, "c") {
				cIndex = i
				break
			}
			continue
		}
		break
	}
	if cIndex == -1 || cIndex+1 >= len(parts) {
		return nil, false
	}

	inner, ok := parseCompound(parts[cIndex+1])
	if !ok {
		return nil, true
	}
	return inner, true
}

func splitShellWords(s string) ([]string, error) {
	parser := syntax.NewParser(syntax.Variant(syntax.LangBash))
	file, err := parser.Parse(strings.NewReader(s), "")
	if err != nil {
		return nil, err
	}
	if len(file.Stmts) != 1 {
		return nil, errors.New("not a single statement")
	}
	call, ok := file.Stmts[0].Cmd.(*syntax.CallExpr)
	if !ok {
		return nil, errors.New("not a call expression")
	}
	words := make([]string, 0, len(call.Args))
	for _, arg := range call.Args {
		if lit, ok := wordStaticValue(arg); ok {
			words = append(words, lit)
			continue
		}
		if lit := arg.Lit(); lit != "" {
			words = append(words, lit)
			continue
		}
		var buf bytes.Buffer
		printer := syntax.NewPrinter(syntax.Minify(true))
		if err := printer.Print(&buf, arg); err != nil {
			return nil, err
		}
		words = append(words, buf.String())
	}
	return words, nil
}

func wordStaticValue(word *syntax.Word) (string, bool) {
	if word == nil {
		return "", false
	}
	b := strings.Builder{}
	for _, part := range word.Parts {
		switch p := part.(type) {
		case *syntax.Lit:
			b.WriteString(p.Value)
		case *syntax.SglQuoted:
			b.WriteString(p.Value)
		case *syntax.DblQuoted:
			for _, inner := range p.Parts {
				lit, ok := inner.(*syntax.Lit)
				if !ok {
					return "", false
				}
				b.WriteString(lit.Value)
			}
		default:
			return "", false
		}
	}
	return b.String(), true
}

func extractFromStmts(stmts []*syntax.Stmt, out *[]string) {
	for _, stmt := range stmts {
		extractFromStmt(stmt, out)
	}
}

func extractFromStmt(stmt *syntax.Stmt, out *[]string) {
	if stmt == nil {
		return
	}

	switch cmd := stmt.Cmd.(type) {
	case *syntax.CallExpr:
		if s := commandString(cmd); s != "" {
			*out = append(*out, s)
		}
		for _, arg := range cmd.Args {
			extractFromWord(arg, out)
		}
		for _, asn := range cmd.Assigns {
			extractFromAssign(asn, out)
		}
	case *syntax.BinaryCmd:
		extractFromStmt(cmd.X, out)
		extractFromStmt(cmd.Y, out)
	case *syntax.Subshell:
		extractFromStmts(cmd.Stmts, out)
	case *syntax.Block:
		extractFromStmts(cmd.Stmts, out)
	case *syntax.IfClause:
		extractFromStmts(cmd.Cond, out)
		extractFromStmts(cmd.Then, out)
		extractFromIfElse(cmd.Else, out)
	case *syntax.WhileClause:
		extractFromStmts(cmd.Cond, out)
		extractFromStmts(cmd.Do, out)
	case *syntax.ForClause:
		if iter, ok := cmd.Loop.(*syntax.WordIter); ok {
			for _, item := range iter.Items {
				extractFromWord(item, out)
			}
		}
		extractFromStmts(cmd.Do, out)
	case *syntax.CaseClause:
		for _, item := range cmd.Items {
			extractFromStmts(item.Stmts, out)
		}
	case *syntax.DeclClause:
		for _, arg := range cmd.Args {
			extractFromAssign(arg, out)
		}
	case *syntax.FuncDecl:
		extractFromStmt(cmd.Body, out)
	case *syntax.TimeClause:
		extractFromStmt(cmd.Stmt, out)
	case *syntax.CoprocClause:
		extractFromStmt(cmd.Stmt, out)
	}

	for _, redir := range stmt.Redirs {
		if redir != nil {
			extractFromWord(redir.Word, out)
		}
	}
}

func extractFromIfElse(clause *syntax.IfClause, out *[]string) {
	if clause == nil {
		return
	}
	if len(clause.Cond) > 0 || len(clause.Then) > 0 {
		extractFromStmts(clause.Cond, out)
		extractFromStmts(clause.Then, out)
		extractFromIfElse(clause.Else, out)
		return
	}
	extractFromIfElse(clause.Else, out)
}

func extractFromAssign(assign *syntax.Assign, out *[]string) {
	if assign == nil {
		return
	}
	extractFromWord(assign.Value, out)
	if assign.Array != nil {
		for _, elem := range assign.Array.Elems {
			if elem == nil {
				continue
			}
			extractFromWord(elem.Value, out)
		}
	}
}

func extractFromWord(word *syntax.Word, out *[]string) {
	if word == nil {
		return
	}
	for _, part := range word.Parts {
		extractFromPart(part, out)
	}
}

func extractFromPart(part syntax.WordPart, out *[]string) {
	switch p := part.(type) {
	case *syntax.CmdSubst:
		extractFromStmts(p.Stmts, out)
	case *syntax.ProcSubst:
		extractFromStmts(p.Stmts, out)
	case *syntax.DblQuoted:
		for _, inner := range p.Parts {
			extractFromPart(inner, out)
		}
	case *syntax.ParamExp:
		if p.Exp != nil {
			extractFromWord(p.Exp.Word, out)
		}
		if p.Repl != nil {
			extractFromWord(p.Repl.Orig, out)
			extractFromWord(p.Repl.With, out)
		}
	case *syntax.BraceExp:
		for _, elem := range p.Elems {
			extractFromWord(elem, out)
		}
	}
}

func commandString(call *syntax.CallExpr) string {
	if call == nil {
		return ""
	}
	parts := make([]string, 0, len(call.Args))
	for _, arg := range call.Args {
		val := wordToString(arg)
		if val != "" {
			parts = append(parts, val)
		}
	}
	return strings.Join(parts, " ")
}

func wordToString(word *syntax.Word) string {
	if word == nil {
		return ""
	}
	b := strings.Builder{}
	for _, part := range word.Parts {
		b.WriteString(partToString(part))
	}
	return b.String()
}

func partToString(part syntax.WordPart) string {
	switch p := part.(type) {
	case *syntax.Lit:
		return p.Value
	case *syntax.DblQuoted:
		b := strings.Builder{}
		b.WriteByte('"')
		for _, inner := range p.Parts {
			b.WriteString(partToString(inner))
		}
		b.WriteByte('"')
		return b.String()
	case *syntax.SglQuoted:
		return "'" + p.Value + "'"
	case *syntax.ParamExp:
		if p.Param == nil {
			return "$"
		}
		return "$" + p.Param.Value
	case *syntax.CmdSubst:
		return "$(..)"
	default:
		return ""
	}
}

func allAllowed(commands, allow, deny []string) bool {
	for _, cmd := range commands {
		if cmd == "" {
			continue
		}
		if !isAllowed(cmd, allow, deny) {
			return false
		}
	}
	return true
}

func anyDenied(commands, deny []string) bool {
	for _, cmd := range commands {
		if cmd == "" {
			continue
		}
		if matchesPrefixList(cmd, deny) {
			return true
		}
	}
	return false
}

func isAllowed(command string, allow, deny []string) bool {
	if matchesPrefixList(command, deny) {
		return false
	}
	return matchesPrefixList(command, allow)
}

func stripEnvCandidates(command string) []string {
	candidates := []string{command}
	stripped := command
	for {
		match := envAssignRE.FindStringSubmatch(stripped)
		if len(match) != 2 {
			break
		}
		stripped = match[1]
	}
	if stripped != command {
		candidates = append(candidates, stripped)
	}
	return candidates
}

func matchesPrefixList(command string, prefixes []string) bool {
	hit, _, _ := firstPrefixMatch(command, prefixes)
	return hit
}

func firstPrefixMatch(command string, prefixes []string) (bool, string, string) {
	if len(prefixes) == 0 {
		return false, "", ""
	}
	for _, candidate := range stripEnvCandidates(command) {
		for _, prefix := range prefixes {
			if candidate == prefix ||
				strings.HasPrefix(candidate, prefix+" ") ||
				strings.HasPrefix(candidate, prefix+"/") {
				return true, prefix, candidate
			}
		}
	}
	return false, "", ""
}

func deny(msg string) int {
	out := denyOutput{}
	out.HookSpecificOutput.HookEventName = "PreToolUse"
	out.HookSpecificOutput.PermissionDecision = "deny"
	out.SystemMessage = msg
	enc := json.NewEncoder(os.Stderr)
	_ = enc.Encode(out)
	return 2
}

func (a *app) debugf(format string, args ...any) {
	if !a.debug {
		return
	}
	_, _ = fmt.Fprintf(os.Stderr, "[approve-compound] "+format+"\n", args...)
}

func init() {
	if len(os.Args) == 2 && os.Args[1] == "--version" {
		w := bufio.NewWriter(os.Stdout)
		_, _ = fmt.Fprintf(w, "approve-compound-bash %s\n", version)
		_, _ = fmt.Fprintf(w, "commit: %s\n", commit)
		_, _ = fmt.Fprintf(w, "buildDate: %s\n", buildDate)
		_ = w.Flush()
		os.Exit(0)
	}
}
