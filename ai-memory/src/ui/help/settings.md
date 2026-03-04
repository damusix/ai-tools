The Settings modal lets you configure ai-memory's behavior and manage your taxonomy (domains and categories). Open it with the gear icon in the toolbar.

## Config

Adjust how the worker, context injection, server, and API behave. Each field shows its current value and a description of what it controls. Changes are saved to `~/.ai-memory/config.yaml` and take effect after restarting the server.

- **Worker** — poll interval, synthesis threshold, observation retention, backfill settings, extraction limits
- **Context** — memory and tag token budgets for session start injection
- **Server** — port and restart delay
- **API** — default pagination limit and log line count

Use **Save & Restart** to apply changes. The server restarts automatically and the dashboard reconnects.

## Domains

Manage the domains used to categorize memories. Each domain has a name, description, and icon.

- **Add** — click the + button to create a new domain with a custom name, description, and icon
- **Edit** — click any domain row to modify its name, description, or icon
- **Delete** — click the trash icon to remove a domain. If the domain has memories assigned to it, you'll be asked to confirm since those memories will lose their domain association.
- **Generate with AI** — use the AI button to have Claude suggest new domains based on your existing memories. This analyzes your memory content and proposes domains that would help organize your knowledge better.

## Categories

Manage memory categories the same way as domains. Categories define what kind of knowledge a memory represents (decision, pattern, preference, fact, solution).

- **Add / Edit / Delete** — same controls as domains
- **Generate with AI** — suggests new categories based on your existing memories

## Restore Defaults

Each tab has a **Restore Defaults** button in the footer:

- **Config tab** — resets all configuration values back to their built-in defaults
- **Domains tab** — re-creates any deleted built-in domains without affecting custom ones you've added
- **Categories tab** — re-creates any deleted built-in categories without affecting custom ones

Restore is non-destructive — it only adds back missing defaults, it never removes your custom entries.
