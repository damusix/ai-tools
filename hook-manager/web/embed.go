package web

import "embed"

//go:embed all:templates
var TemplateFS embed.FS

//go:embed all:static
var StaticFS embed.FS

//go:embed all:help
var HelpFS embed.FS
