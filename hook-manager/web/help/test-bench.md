# Test Bench

The Test Bench lets you fire hook events with custom payloads and inspect the full response — without needing a live Claude Code session.

## How It Works

1. **Select an event type** from the dropdown
2. **Edit the JSON payload** — a sample is pre-filled for each event type
3. **Click Fire Event** — sends the payload to Hook Manager as if Claude Code sent it
4. **Inspect the response** — see the HTTP status, response body, and timing

## What Happens When You Fire

The payload goes through the exact same pipeline as a real Claude Code event:

1. Hook Manager looks up all hooks registered for the selected event
2. Hooks are filtered by their matchers
3. Matching hooks execute concurrently
4. Outputs are aggregated (JSON deep-merge)
5. The aggregated response is returned

This means you're testing the **full pipeline** — not just a single script, but all hooks that would fire for that event.

## Tips

- **Start with the sample payload** — it has the correct shape for each event type
- **Add fields** to test how your hooks handle different scenarios
- **Check the response body** for `systemMessage` or other output from your hooks
- **Empty response** `{}` means no hooks matched or none produced output
- **To test a single script**, use the console in the Script Editor instead — it runs just that one script
- **Copy payloads from Live Capture** for realistic test data
