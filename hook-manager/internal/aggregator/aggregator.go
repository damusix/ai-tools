package aggregator

import (
	"encoding/json"
	"strings"
)

// ScriptOutput holds the stdout bytes from a script execution and whether it parsed as JSON.
type ScriptOutput struct {
	Stdout []byte
	IsJSON bool
}

// AggregateResult holds the merged result from multiple script outputs.
type AggregateResult struct {
	JSON map[string]any
	Text string
}

const separator = "\n———\n"

// Aggregate merges multiple ScriptOutputs into a single AggregateResult.
// JSON outputs are deep-merged with last-writer-wins, except systemMessage which concatenates.
// Text outputs are joined with the separator.
func Aggregate(outputs []ScriptOutput) AggregateResult {
	var merged map[string]any
	var textParts []string

	for _, output := range outputs {
		if output.IsJSON {
			var m map[string]any
			if err := json.Unmarshal(output.Stdout, &m); err != nil {
				// Treat malformed JSON as plain text
				textParts = append(textParts, string(output.Stdout))
				continue
			}
			if merged == nil {
				merged = make(map[string]any)
			}
			for k, v := range m {
				if k == "systemMessage" {
					// Concatenate systemMessage values with separator
					existing, ok := merged[k].(string)
					incoming, isStr := v.(string)
					if ok && isStr && existing != "" {
						merged[k] = existing + separator + incoming
					} else {
						merged[k] = v
					}
				} else {
					// Last-writer-wins for all other keys
					merged[k] = v
				}
			}
		} else {
			text := string(output.Stdout)
			if text != "" {
				textParts = append(textParts, text)
			}
		}
	}

	return AggregateResult{
		JSON: merged,
		Text: strings.Join(textParts, separator),
	}
}
