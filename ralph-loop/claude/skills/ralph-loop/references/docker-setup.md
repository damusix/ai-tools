# Ralph Docker Setup

The ralph-wiggum repository must be available at a known path. Verify:

```
ls <ralph-wiggum-repo>/src/ralph.mjs
ls <ralph-wiggum-repo>/docker-compose.yml
```


## Build and Start

```bash
docker compose up -d --build
```


## Enter the Container

```bash
docker compose exec ralph-wiggum zsh
```


## Verify

```bash
ralph help
```

The container runs Debian Bookworm with Node.js 24, Python 3, Go, Rust, Ruby, and
comprehensive tooling. The entrypoint handles first-run setup automatically
(git identity, PATH, Oh My Zsh).


## Volume Mounts

| Host path | Container path | Purpose |
|-----------|---------------|---------|
| `./home` | `/home/ralph` | Persistent home directory — project folders live here |
| `./src` | `/opt/ralph` | Ralph script and prompt templates |
| `./claude/skills` | `/home/ralph/.claude/skills` | Claude Code skills (live-editable) |
| `./claude/plugins` | `/home/ralph/.claude/plugins` | Claude Code plugins (live-editable) |
