package config

import "time"

// RuntimeInfo describes a detected runtime binary on the user's machine.
type RuntimeInfo struct {
	Name      string    `yaml:"name"       json:"name"`
	Version   string    `yaml:"version"    json:"version"`
	Path      string    `yaml:"path"       json:"path"`
	CheckedAt time.Time `yaml:"checked_at" json:"checked_at"`
}

// ExtMapping maps a file extension to a runtime binary.
type ExtMapping struct {
	Ext     string `yaml:"ext"              json:"ext"`
	Runtime string `yaml:"runtime"          json:"runtime"`
	Custom  bool   `yaml:"custom,omitempty" json:"custom"`
}

// RuntimesConfig holds detected runtimes and extension-to-runtime mappings.
type RuntimesConfig struct {
	Detected    []RuntimeInfo `yaml:"detected"     json:"detected"`
	ExtMappings []ExtMapping  `yaml:"ext_mappings" json:"ext_mappings"`
}

// Config is the top-level config structure for ~/.ai-hooks/config.yaml
type Config struct {
	Server   ServerConfig         `yaml:"server" json:"server"`
	Runtimes RuntimesConfig       `yaml:"runtimes" json:"runtimes"`
	Hooks    map[string][]HookDef `yaml:"hooks" json:"hooks"` // key = event name
}

type ServerConfig struct {
	Port     int    `yaml:"port" json:"port"`
	LogLevel string `yaml:"log_level" json:"log_level"`
}

type HookDef struct {
	Name    string `yaml:"name"`
	Type    string `yaml:"type"`    // "managed" or "command"
	Command string `yaml:"command"` // for type=command
	File    string `yaml:"file"`    // for type=managed
	Runtime string `yaml:"runtime"` // for type=managed
	Matcher string `yaml:"matcher"` // regex, optional
	Enabled *bool  `yaml:"enabled"` // pointer so we can detect omission (default true)
	Timeout int    `yaml:"timeout"` // seconds
}

// IsEnabled returns true if the hook is enabled (default true if omitted)
func (h HookDef) IsEnabled() bool {
	if h.Enabled == nil {
		return true
	}
	return *h.Enabled
}

// DefaultConfig returns a config with sensible defaults
func DefaultConfig() Config {
	return Config{
		Server: ServerConfig{
			Port:     47821,
			LogLevel: "info",
		},
		Hooks: make(map[string][]HookDef),
	}
}
