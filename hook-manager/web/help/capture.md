# Live Capture

Live Capture shows the **raw event payloads** as they arrive from Claude Code, before any hooks process them. It's a real-time stream of everything Claude Code is doing.

## What You See

Each captured event shows:

- **Timestamp** — when the event arrived
- **Event type** — the hook event name (PreToolUse, PostToolUse, etc.)
- **Project** — the working directory, so you can filter by project
- **Payload** — the full JSON payload (click to expand)

## Use Cases

- **Debugging** — see exactly what Claude Code sends so you can write hooks that handle the right fields
- **Learning** — understand the lifecycle of a Claude Code session by watching events flow in real time
- **Payload discovery** — copy a captured payload and paste it into the Test Bench or script console to test your hooks with real data

## Controls

- **Pause / Resume** — freeze the feed to inspect events without new ones pushing them away
- **Project filter** — show only events from a specific project directory
- **Search** — filter events by any text in the payload
- **Copy** — copy a payload to clipboard for use in testing
- **Clear** — discard all captured events

## Tips

- Open Capture in one browser tab and your script editor in another — edit and watch events simultaneously
- Use the Copy button on a captured payload, then paste it into the Test Bench for quick testing
- The buffer holds up to 2000 events before older ones are discarded
