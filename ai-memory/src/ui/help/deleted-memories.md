# Deleted Memories

Distillation periodically reviews your memories against the current codebase to find entries that are outdated, irrelevant, or contradicted by recent changes.

## How it works

When distillation runs (automatically via the stop hook, or manually via the "Run Now" button), it:

1. Gathers a snapshot of your repository structure and recent git history
2. Batches memories by domain (up to 50 per batch)
3. Uses an LLM to evaluate each memory against the codebase
4. Soft-deletes memories it determines are stale

## What you can do

- **Restore** — If a memory was incorrectly flagged, click it and choose "Restore" to bring it back to active status
- **Permanently Delete** — Remove a flagged memory immediately instead of waiting for the grace period
- **Wait** — Deleted memories are automatically purged after the configured grace period (default: 7 days)

## Configuration

Distillation settings can be adjusted in Settings (Ctrl+,) under the Distillation section.
